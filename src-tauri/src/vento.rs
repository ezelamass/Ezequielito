//! The Vento account: sign-in, keeping the session alive, and the calls the
//! app makes to Vento (text cleanup and profile sync).
//!
//! Transcription stays on this computer. What goes to Vento is the text of
//! a dictation, to be cleaned up, and only while signed in.

use crate::vento_sync::{Profile, RemoteProfile, SyncState};
use log::{debug, warn};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specta::Type;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

/// Vento's backend. Both values are public: they ship in Vento's web app.
pub const VENTO_URL: &str = "https://zsbligbfsmdwbxcvoysu.supabase.co";
pub const VENTO_PUBLISHABLE_KEY: &str = "sb_publishable_DaCT1y6gfYR_FjcTBlDFOA_x_DSXzjl";

/// Feature gate that allows the cleanup endpoint for an account.
const VOICE_FEATURE: &str = "vento_voice";

/// A cleanup the person is waiting on: fail fast and paste the raw text.
const CLEAN_TIMEOUT: Duration = Duration::from_secs(10);
/// Edit / transform requests write longer answers.
const ASSIST_TIMEOUT: Duration = Duration::from_secs(30);
const ACCOUNT_TIMEOUT: Duration = Duration::from_secs(15);
/// A refresh can sit in front of a dictation that is waiting to be pasted.
const REFRESH_TIMEOUT: Duration = Duration::from_secs(6);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// Refresh the access token when it has less than this left.
const REFRESH_MARGIN_SECS: i64 = 90;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds.
    pub expires_at: i64,
    pub user_id: String,
    pub email: String,
}

/// Everything the account keeps on disk.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredAccount {
    #[serde(default)]
    pub session: Option<Session>,
    #[serde(default)]
    pub sync: SyncState,
    /// The user `sync` belongs to. It survives signing out, so signing back
    /// in as the same person does not look like a first sync.
    #[serde(default)]
    pub sync_user_id: Option<String>,
}

/// Where the account is persisted. The app uses a store file; tests use
/// memory.
pub trait AccountStore: Send + Sync {
    fn load(&self) -> StoredAccount;
    fn save(&self, account: &StoredAccount);
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VentoError {
    NotSignedIn,
    InvalidCredentials,
    /// The account does not have Vento Voice enabled.
    FeatureOff,
    /// The account used up today's requests.
    DailyLimit,
    /// Could not reach Vento (offline, timeout).
    Network(String),
    /// Vento answered with an error.
    Server(String),
}

impl VentoError {
    /// Stable code for the frontend.
    pub fn code(&self) -> &'static str {
        match self {
            VentoError::NotSignedIn => "not_signed_in",
            VentoError::InvalidCredentials => "invalid_credentials",
            VentoError::FeatureOff => "feature_off",
            VentoError::DailyLimit => "daily_limit",
            VentoError::Network(_) => "network",
            VentoError::Server(_) => "server",
        }
    }
}

/// What the UI shows about the account.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct AccountStatus {
    pub signed_in: bool,
    pub email: Option<String>,
    /// Whether Vento Voice is enabled for the account. `None`: not known
    /// yet (signed out, or the check has not come back).
    pub voice_enabled: Option<bool>,
    /// Today's cleanup allowance is used up; dictations are pasted as
    /// transcribed until tomorrow (UTC).
    pub limit_reached: bool,
}

/// A request for the cleanup endpoint. The server builds the prompts; this
/// only carries data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VoiceRequest<'a> {
    Clean {
        text: &'a str,
        style: &'a str,
        app: Option<&'a str>,
        window_title: Option<&'a str>,
        dictionary: &'a [String],
    },
    Edit {
        selection: &'a str,
        instruction: &'a str,
    },
    Write {
        instruction: &'a str,
    },
    Transform {
        transform: &'a str,
        text: &'a str,
    },
}

impl VoiceRequest<'_> {
    fn body(&self) -> Value {
        match self {
            VoiceRequest::Clean {
                text,
                style,
                app,
                window_title,
                dictionary,
            } => json!({
                "mode": "clean",
                "text": text,
                "style": style,
                "app": app,
                "window_title": window_title,
                "dictionary": dictionary,
            }),
            VoiceRequest::Edit {
                selection,
                instruction,
            } => json!({ "mode": "edit", "selection": selection, "instruction": instruction }),
            VoiceRequest::Write { instruction } => {
                json!({ "mode": "write", "instruction": instruction })
            }
            VoiceRequest::Transform { transform, text } => {
                json!({ "mode": "transform", "transform": transform, "text": text })
            }
        }
    }

    fn timeout(&self) -> Duration {
        match self {
            VoiceRequest::Clean { .. } => CLEAN_TIMEOUT,
            _ => ASSIST_TIMEOUT,
        }
    }
}

/// Text returned by the cleanup endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceResponse {
    pub text: String,
    /// The model ran out of room: `text` is cut short.
    pub truncated: bool,
}

pub struct VentoAccount {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
    store: Box<dyn AccountStore>,
    /// Held across a token refresh: refresh tokens are single-use, so two
    /// refreshes at once would sign the account out.
    account: tokio::sync::Mutex<StoredAccount>,
    /// Mirror of "a session is stored", readable without the async lock.
    signed_in: AtomicBool,
    voice_enabled: Mutex<Option<bool>>,
    /// UTC day (days since the epoch) on which the daily limit was hit.
    limit_hit_day: AtomicI64,
    /// Bumped on every local change to the synced settings.
    dirty_seq: AtomicU64,
    /// One profile sync at a time.
    sync_lock: tokio::sync::Mutex<()>,
}

impl VentoAccount {
    pub fn new(base_url: &str, api_key: &str, store: Box<dyn AccountStore>) -> Self {
        let http = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .pool_idle_timeout(Duration::from_secs(120))
            .build()
            .unwrap_or_default();
        let account = store.load();
        Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
            store,
            signed_in: AtomicBool::new(account.session.is_some()),
            account: tokio::sync::Mutex::new(account),
            voice_enabled: Mutex::new(None),
            limit_hit_day: AtomicI64::new(NO_DAY),
            dirty_seq: AtomicU64::new(0),
            sync_lock: tokio::sync::Mutex::new(()),
        }
    }

    pub async fn status(&self) -> AccountStatus {
        let account = self.account.lock().await;
        AccountStatus {
            signed_in: account.session.is_some(),
            email: account.session.as_ref().map(|s| s.email.clone()),
            voice_enabled: if account.session.is_some() {
                self.cached_voice_enabled()
            } else {
                None
            },
            limit_reached: account.session.is_some() && self.limit_reached(),
        }
    }

    /// Signed in, not known to be without Vento Voice, and with allowance
    /// left today. Cheap: used on the dictation path to decide whether to
    /// try the cleanup at all.
    pub fn is_ready(&self) -> bool {
        self.signed_in.load(Ordering::SeqCst)
            && self.cached_voice_enabled() != Some(false)
            && !self.limit_reached()
    }

    fn limit_reached(&self) -> bool {
        self.limit_hit_day.load(Ordering::SeqCst) == utc_day(now_secs())
    }

    fn cached_voice_enabled(&self) -> Option<bool> {
        self.voice_enabled.lock().ok().and_then(|guard| *guard)
    }

    fn set_voice_enabled(&self, value: Option<bool>) {
        if let Ok(mut guard) = self.voice_enabled.lock() {
            *guard = value;
        }
    }

    pub async fn sign_in(&self, email: &str, password: &str) -> Result<AccountStatus, VentoError> {
        let response = self
            .http
            .post(format!(
                "{}/auth/v1/token?grant_type=password",
                self.base_url
            ))
            .header("apikey", &self.api_key)
            .timeout(ACCOUNT_TIMEOUT)
            .json(&json!({ "email": email.trim(), "password": password }))
            .send()
            .await
            .map_err(network_error)?;

        let status = response.status();
        let body: Value = response.json().await.map_err(network_error)?;
        if !status.is_success() {
            return Err(sign_in_error(status.as_u16(), &body));
        }
        let session = session_from_token_response(&body, now_secs())
            .ok_or_else(|| VentoError::Server("unexpected sign-in response".to_string()))?;

        {
            let mut account = self.account.lock().await;
            // A different account must not inherit the previous one's sync
            // bookkeeping; the same person signing back in keeps theirs.
            if account.sync_user_id.as_deref() != Some(session.user_id.as_str()) {
                account.sync = SyncState::default();
                account.sync_user_id = Some(session.user_id.clone());
            }
            account.session = Some(session);
            self.store.save(&account);
            self.signed_in.store(true, Ordering::SeqCst);
        }
        self.limit_hit_day.store(NO_DAY, Ordering::SeqCst);

        self.refresh_voice_enabled().await;
        Ok(self.status().await)
    }

    pub async fn sign_out(&self) {
        let token = {
            let mut account = self.account.lock().await;
            let token = account.session.take().map(|s| s.access_token);
            self.store.save(&account);
            self.signed_in.store(false, Ordering::SeqCst);
            token
        };
        self.set_voice_enabled(None);

        // Best effort: revoke the session on the server too.
        if let Some(token) = token {
            let _ = self
                .http
                .post(format!("{}/auth/v1/logout?scope=local", self.base_url))
                .header("apikey", &self.api_key)
                .bearer_auth(token)
                .timeout(ACCOUNT_TIMEOUT)
                .send()
                .await;
        }
    }

    /// A valid access token, refreshing it first when it is about to
    /// expire. Clears the session when the server says it is no longer
    /// valid; keeps it on a network failure.
    async fn access_token(&self) -> Result<String, VentoError> {
        let mut account = self.account.lock().await;
        let session = account.session.clone().ok_or(VentoError::NotSignedIn)?;
        if !needs_refresh(session.expires_at, now_secs()) {
            return Ok(session.access_token);
        }

        debug!("Vento: refreshing the session");
        let response = self
            .http
            .post(format!(
                "{}/auth/v1/token?grant_type=refresh_token",
                self.base_url
            ))
            .header("apikey", &self.api_key)
            .timeout(REFRESH_TIMEOUT)
            .json(&json!({ "refresh_token": session.refresh_token }))
            .send()
            .await
            .map_err(network_error)?;

        let status = response.status();
        if refresh_was_refused(status.as_u16()) {
            warn!("Vento: the session is no longer valid ({})", status);
            account.session = None;
            self.store.save(&account);
            self.signed_in.store(false, Ordering::SeqCst);
            self.set_voice_enabled(None);
            return Err(VentoError::NotSignedIn);
        }
        if !status.is_success() {
            // Rate limit, a proxy in the way, a server error: the session
            // may well still be good. Keep it and report the failure.
            return Err(VentoError::Server(format!("refresh failed: {}", status)));
        }
        let body: Value = response.json().await.map_err(network_error)?;

        let mut refreshed = session_from_token_response(&body, now_secs())
            .ok_or_else(|| VentoError::Server("unexpected refresh response".to_string()))?;
        if refreshed.email.is_empty() {
            refreshed.email = session.email;
        }
        let token = refreshed.access_token.clone();
        account.session = Some(refreshed);
        self.store.save(&account);
        Ok(token)
    }

    /// Asks Vento whether the account has Vento Voice and remembers the
    /// answer. Leaves the previous answer in place when the check fails.
    pub async fn refresh_voice_enabled(&self) -> Option<bool> {
        let token = self.access_token().await.ok()?;
        let response = self
            .http
            .post(format!("{}/rest/v1/rpc/has_feature", self.base_url))
            .header("apikey", &self.api_key)
            .bearer_auth(token)
            .timeout(ACCOUNT_TIMEOUT)
            .json(&json!({ "p_key": VOICE_FEATURE }))
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return self.cached_voice_enabled();
        }
        let enabled = response.json::<Value>().await.ok()?.as_bool()?;
        self.set_voice_enabled(Some(enabled));
        Some(enabled)
    }

    /// Opens the connection and refreshes the token ahead of a request, so
    /// the request itself does not pay for either. Called when a recording
    /// starts.
    pub async fn prewarm(&self) {
        if self.access_token().await.is_err() {
            return;
        }
        let _ = self
            .http
            .get(format!("{}/auth/v1/health", self.base_url))
            .header("apikey", &self.api_key)
            .timeout(CONNECT_TIMEOUT)
            .send()
            .await;
    }

    pub async fn voice(&self, request: VoiceRequest<'_>) -> Result<VoiceResponse, VentoError> {
        let token = self.access_token().await?;
        let response = self
            .http
            .post(format!("{}/functions/v1/voice-clean", self.base_url))
            .header("apikey", &self.api_key)
            .bearer_auth(token)
            .timeout(request.timeout())
            .json(&request.body())
            .send()
            .await
            .map_err(network_error)?;

        let status = response.status().as_u16();
        let body: Value = response.json().await.unwrap_or(Value::Null);
        let result = voice_result(status, &body);
        match &result {
            Err(VentoError::FeatureOff) => self.set_voice_enabled(Some(false)),
            // No point asking again today: every further request would be
            // refused after a full round trip.
            Err(VentoError::DailyLimit) => self
                .limit_hit_day
                .store(utc_day(now_secs()), Ordering::SeqCst),
            Ok(_) => self.set_voice_enabled(Some(true)),
            _ => {}
        }
        result
    }

    /// The profile stored in the account, if there is one.
    pub async fn fetch_profile(&self) -> Result<Option<RemoteProfile>, VentoError> {
        let token = self.access_token().await?;
        let response = self
            .http
            .get(format!(
                "{}/rest/v1/voice_profiles?select=dictionary,snippets,app_styles,updated_at&limit=1",
                self.base_url
            ))
            .header("apikey", &self.api_key)
            .bearer_auth(token)
            .timeout(ACCOUNT_TIMEOUT)
            .send()
            .await
            .map_err(network_error)?;
        let status = response.status();
        let body: Value = response.json().await.map_err(network_error)?;
        if !status.is_success() {
            return Err(VentoError::Server(error_text(&body)));
        }
        Ok(body
            .as_array()
            .and_then(|rows| rows.first())
            .and_then(remote_profile_from_row))
    }

    /// Writes the profile to the account. Returns the `updated_at` the
    /// server stored.
    pub async fn push_profile(&self, profile: &Profile) -> Result<String, VentoError> {
        let token = self.access_token().await?;
        let user_id = {
            let account = self.account.lock().await;
            account
                .session
                .as_ref()
                .map(|s| s.user_id.clone())
                .ok_or(VentoError::NotSignedIn)?
        };
        let response = self
            .http
            .post(format!("{}/rest/v1/voice_profiles", self.base_url))
            .header("apikey", &self.api_key)
            .header(
                "Prefer",
                "resolution=merge-duplicates,return=representation",
            )
            .bearer_auth(token)
            .timeout(ACCOUNT_TIMEOUT)
            .json(&json!({
                "owner_id": user_id,
                "dictionary": profile.dictionary,
                "snippets": profile.snippets,
                "app_styles": profile.app_styles,
                "updated_at": chrono::Utc::now().to_rfc3339(),
            }))
            .send()
            .await
            .map_err(network_error)?;
        let status = response.status();
        let body: Value = response.json().await.map_err(network_error)?;
        if !status.is_success() {
            return Err(VentoError::Server(error_text(&body)));
        }
        body.as_array()
            .and_then(|rows| rows.first())
            .and_then(|row| row.get("updated_at"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| VentoError::Server("unexpected profile response".to_string()))
    }

    pub async fn sync_state(&self) -> SyncState {
        self.account.lock().await.sync.clone()
    }

    pub async fn set_sync_state(&self, state: SyncState) {
        let mut account = self.account.lock().await;
        account.sync = state;
        self.store.save(&account);
    }

    /// Records that the synced settings changed on this computer.
    pub async fn mark_dirty(&self) {
        self.dirty_seq.fetch_add(1, Ordering::SeqCst);
        let mut account = self.account.lock().await;
        if !account.sync.dirty {
            account.sync.dirty = true;
            self.store.save(&account);
        }
    }

    /// Changes whenever the synced settings change locally. A sync reads it
    /// before and after: a different value means an edit happened meanwhile
    /// and the result must not be recorded as "in sync".
    pub fn dirty_seq(&self) -> u64 {
        self.dirty_seq.load(Ordering::SeqCst)
    }

    /// Held for the length of a profile sync, so two never interleave.
    pub async fn lock_sync(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.sync_lock.lock().await
    }
}

/// Sentinel for "the daily limit has not been hit".
const NO_DAY: i64 = -1;

/// Days since the Unix epoch, UTC: the unit the daily allowance resets on.
fn utc_day(now: i64) -> i64 {
    now.div_euclid(86_400)
}

/// Whether the auth server's answer to a refresh means the session is over
/// (as opposed to a rate limit, a proxy or an outage).
fn refresh_was_refused(status: u16) -> bool {
    status == 400 || status == 401
}

/// Maps a failed sign-in to what the person should be told.
fn sign_in_error(status: u16, body: &Value) -> VentoError {
    match status {
        400 | 401 => VentoError::InvalidCredentials,
        _ => VentoError::Server(format!("{} {}", status, error_text(body))),
    }
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

fn network_error(error: reqwest::Error) -> VentoError {
    VentoError::Network(error.to_string())
}

fn error_text(body: &Value) -> String {
    ["error", "msg", "message", "error_description"]
        .iter()
        .find_map(|key| body.get(key).and_then(Value::as_str))
        .unwrap_or("unknown error")
        .to_string()
}

/// Whether a token expiring at `expires_at` should be refreshed at `now`.
fn needs_refresh(expires_at: i64, now: i64) -> bool {
    expires_at - now < REFRESH_MARGIN_SECS
}

/// Reads a session from the auth server's token response.
fn session_from_token_response(body: &Value, now: i64) -> Option<Session> {
    let access_token = body.get("access_token")?.as_str()?.to_string();
    let refresh_token = body.get("refresh_token")?.as_str()?.to_string();
    let expires_at = body.get("expires_at").and_then(Value::as_i64).or_else(|| {
        body.get("expires_in")
            .and_then(Value::as_i64)
            .map(|seconds| now + seconds)
    })?;
    let user = body.get("user");
    let user_id = user?.get("id")?.as_str()?.to_string();
    let email = user
        .and_then(|u| u.get("email"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    Some(Session {
        access_token,
        refresh_token,
        expires_at,
        user_id,
        email,
    })
}

/// Turns the cleanup endpoint's answer into a result.
fn voice_result(status: u16, body: &Value) -> Result<VoiceResponse, VentoError> {
    match status {
        200 => {
            let text = body
                .get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            if text.is_empty() {
                return Err(VentoError::Server("empty response".to_string()));
            }
            Ok(VoiceResponse {
                text: text.to_string(),
                truncated: body
                    .get("truncated")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        }
        401 => Err(VentoError::NotSignedIn),
        403 => Err(VentoError::FeatureOff),
        429 => Err(VentoError::DailyLimit),
        _ => Err(VentoError::Server(format!(
            "{} {}",
            status,
            error_text(body)
        ))),
    }
}

fn remote_profile_from_row(row: &Value) -> Option<RemoteProfile> {
    let updated_at = row.get("updated_at")?.as_str()?.to_string();
    let profile: Profile = serde_json::from_value(json!({
        "dictionary": row.get("dictionary").cloned().unwrap_or(json!([])),
        "snippets": row.get("snippets").cloned().unwrap_or(json!([])),
        "app_styles": row.get("app_styles").cloned().unwrap_or(json!({})),
    }))
    .ok()?;
    Some(RemoteProfile {
        profile,
        updated_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_is_refreshed_shortly_before_it_expires() {
        assert!(!needs_refresh(1_000, 1_000 - REFRESH_MARGIN_SECS - 1));
        assert!(needs_refresh(1_000, 1_000 - REFRESH_MARGIN_SECS + 1));
        assert!(needs_refresh(1_000, 2_000));
    }

    #[test]
    fn a_session_is_read_from_the_sign_in_response() {
        let body = json!({
            "access_token": "a", "refresh_token": "r", "expires_in": 3600, "expires_at": 5000,
            "user": { "id": "u1", "email": "person@example.com" }
        });
        assert_eq!(
            session_from_token_response(&body, 100),
            Some(Session {
                access_token: "a".to_string(),
                refresh_token: "r".to_string(),
                expires_at: 5000,
                user_id: "u1".to_string(),
                email: "person@example.com".to_string(),
            })
        );
    }

    #[test]
    fn expiry_falls_back_to_expires_in_when_expires_at_is_missing() {
        let body = json!({
            "access_token": "a", "refresh_token": "r", "expires_in": 3600,
            "user": { "id": "u1" }
        });
        let session = session_from_token_response(&body, 100).expect("session");
        assert_eq!(session.expires_at, 3700);
        assert_eq!(session.email, "");
    }

    #[test]
    fn an_incomplete_token_response_is_not_a_session() {
        assert_eq!(session_from_token_response(&json!({}), 0), None);
        assert_eq!(
            session_from_token_response(
                &json!({ "access_token": "a", "refresh_token": "r", "expires_in": 1 }),
                0
            ),
            None
        );
    }

    #[test]
    fn a_cleaned_text_comes_back_trimmed() {
        assert_eq!(
            voice_result(200, &json!({ "text": "  Hola.  ", "truncated": false })),
            Ok(VoiceResponse {
                text: "Hola.".to_string(),
                truncated: false
            })
        );
    }

    #[test]
    fn a_truncated_answer_is_flagged() {
        let response = voice_result(200, &json!({ "text": "Hola", "truncated": true }));
        assert!(response.expect("response").truncated);
    }

    #[test]
    fn an_empty_text_is_an_error_not_an_empty_paste() {
        assert!(matches!(
            voice_result(200, &json!({ "text": "   " })),
            Err(VentoError::Server(_))
        ));
        assert!(matches!(
            voice_result(200, &Value::Null),
            Err(VentoError::Server(_))
        ));
    }

    #[test]
    fn each_refusal_maps_to_its_own_error() {
        assert_eq!(
            voice_result(401, &Value::Null),
            Err(VentoError::NotSignedIn)
        );
        assert_eq!(
            voice_result(403, &json!({ "error": "feature_desactivada" })),
            Err(VentoError::FeatureOff)
        );
        assert_eq!(
            voice_result(429, &json!({ "error": "tope_diario" })),
            Err(VentoError::DailyLimit)
        );
        assert_eq!(
            voice_result(503, &json!({ "error": "ia_no_configurada" })),
            Err(VentoError::Server("503 ia_no_configurada".to_string()))
        );
    }

    #[test]
    fn only_a_refused_token_ends_the_session() {
        assert!(refresh_was_refused(400));
        assert!(refresh_was_refused(401));
        // Rate limit, a proxy, an outage: the session may still be good.
        for status in [403, 407, 429, 500, 503] {
            assert!(!refresh_was_refused(status), "{status}");
        }
    }

    #[test]
    fn a_failed_sign_in_blames_the_password_only_when_it_is_the_password() {
        assert_eq!(
            sign_in_error(400, &json!({ "error_code": "invalid_credentials" })),
            VentoError::InvalidCredentials
        );
        assert!(matches!(
            sign_in_error(429, &json!({ "msg": "too many requests" })),
            VentoError::Server(_)
        ));
        assert!(matches!(
            sign_in_error(500, &Value::Null),
            VentoError::Server(_)
        ));
    }

    #[test]
    fn the_daily_allowance_resets_at_midnight_utc() {
        assert_eq!(utc_day(0), 0);
        assert_eq!(utc_day(86_399), 0);
        assert_eq!(utc_day(86_400), 1);
    }

    #[test]
    fn the_clean_request_carries_data_and_no_prompt() {
        let dictionary = vec!["Vento".to_string()];
        let body = VoiceRequest::Clean {
            text: "hola",
            style: "casual",
            app: Some("whatsapp"),
            window_title: None,
            dictionary: &dictionary,
        }
        .body();
        assert_eq!(
            body,
            json!({
                "mode": "clean", "text": "hola", "style": "casual",
                "app": "whatsapp", "window_title": null, "dictionary": ["Vento"]
            })
        );
    }

    #[test]
    fn a_profile_row_becomes_a_remote_profile() {
        let row = json!({
            "dictionary": ["Vento"],
            "snippets": [{ "trigger": "mi mail", "expansion": "a@b.c" }],
            "app_styles": { "slack": "ez_casual" },
            "updated_at": "2026-11-25T05:00:00+00:00"
        });
        let remote = remote_profile_from_row(&row).expect("profile");
        assert_eq!(remote.updated_at, "2026-11-25T05:00:00+00:00");
        assert_eq!(remote.profile.dictionary, vec!["Vento"]);
        assert_eq!(remote.profile.snippets.len(), 1);
        assert_eq!(
            remote.profile.app_styles.get("slack").map(String::as_str),
            Some("ez_casual")
        );
    }

    /// In-memory store for the live test below.
    struct MemoryStore(Mutex<StoredAccount>);
    impl AccountStore for MemoryStore {
        fn load(&self) -> StoredAccount {
            self.0.lock().expect("store").clone()
        }
        fn save(&self, account: &StoredAccount) {
            *self.0.lock().expect("store") = account.clone();
        }
    }

    /// Runs against the real Vento backend with a test account:
    ///
    ///   VENTO_TEST_EMAIL=… VENTO_TEST_PASSWORD=… cargo test --lib vento::tests::live -- --ignored
    #[tokio::test]
    #[ignore = "needs network and a Vento test account"]
    async fn live_sign_in_clean_and_profile_round_trip() {
        let email = std::env::var("VENTO_TEST_EMAIL").expect("VENTO_TEST_EMAIL");
        let password = std::env::var("VENTO_TEST_PASSWORD").expect("VENTO_TEST_PASSWORD");
        let account = VentoAccount::new(
            VENTO_URL,
            VENTO_PUBLISHABLE_KEY,
            Box::new(MemoryStore(Mutex::new(StoredAccount::default()))),
        );

        assert_eq!(
            account.sign_in(&email, "definitely-wrong").await,
            Err(VentoError::InvalidCredentials)
        );
        assert!(!account.is_ready());

        let status = account.sign_in(&email, &password).await.expect("sign in");
        assert!(status.signed_in);
        assert_eq!(status.voice_enabled, Some(true));
        assert!(account.is_ready());

        let cleaned = account
            .voice(VoiceRequest::Clean {
                text: "eh bueno nos vemos el martes no perdón el miércoles",
                style: "neutral",
                app: None,
                window_title: None,
                dictionary: &[],
            })
            .await
            .expect("clean");
        assert!(cleaned.text.to_lowercase().contains("miércoles"));
        assert!(!cleaned.text.to_lowercase().contains("martes"));

        let profile = Profile {
            dictionary: vec!["Vento".to_string(), format!("prueba-{}", now_secs())],
            ..Profile::default()
        };
        let updated_at = account.push_profile(&profile).await.expect("push");
        let remote = account
            .fetch_profile()
            .await
            .expect("fetch")
            .expect("profile row");
        assert_eq!(remote.profile, profile);
        assert_eq!(remote.updated_at, updated_at);

        // Force a refresh: pretend the token expired.
        {
            let mut stored = account.account.lock().await;
            if let Some(session) = stored.session.as_mut() {
                session.expires_at = 0;
            }
        }
        assert_eq!(account.refresh_voice_enabled().await, Some(true));

        account.sign_out().await;
        assert!(!account.status().await.signed_in);
        assert_eq!(account.fetch_profile().await, Err(VentoError::NotSignedIn));
    }
}
