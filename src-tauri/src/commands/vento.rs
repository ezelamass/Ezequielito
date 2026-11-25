//! The Vento account inside the app: where it is stored, what happens at
//! startup, profile sync, and the commands the UI calls.

use crate::settings::{get_settings, write_settings, AppSettings};
use crate::vento::{
    AccountStatus, AccountStore, StoredAccount, VentoAccount, VentoError, VENTO_PUBLISHABLE_KEY,
    VENTO_URL,
};
use crate::vento_sync::{plan_sync, Profile, SyncPlan, SyncState, SyncedSnippet};
use log::{debug, warn};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;

const ACCOUNT_STORE_PATH: &str = "vento_account.json";
const ACCOUNT_KEY: &str = "account";

/// Emitted after the synced settings were replaced from the account, so
/// open windows reload them.
const PROFILE_SYNCED_EVENT: &str = "vento-profile-synced";

/// Emitted when the account's state changed outside the account screen
/// (the session ended, today's allowance ran out), so the screen re-reads it.
pub const ACCOUNT_CHANGED_EVENT: &str = "vento-account-changed";

/// Keeps the account in its own store file, next to the settings.
struct TauriAccountStore(AppHandle);

impl AccountStore for TauriAccountStore {
    fn load(&self) -> StoredAccount {
        self.0
            .store(crate::portable::store_path(ACCOUNT_STORE_PATH))
            .ok()
            .and_then(|store| store.get(ACCOUNT_KEY))
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default()
    }

    fn save(&self, account: &StoredAccount) {
        match self
            .0
            .store(crate::portable::store_path(ACCOUNT_STORE_PATH))
        {
            Ok(store) => match serde_json::to_value(account) {
                Ok(value) => store.set(ACCOUNT_KEY, value),
                Err(e) => warn!("Vento: could not serialise the account: {}", e),
            },
            Err(e) => warn!("Vento: could not open the account store: {}", e),
        }
    }
}

pub fn account(app: &AppHandle) -> Option<Arc<VentoAccount>> {
    app.try_state::<Arc<VentoAccount>>()
        .map(|state| Arc::clone(&state))
}

/// Registers the account and, when a session was saved, checks the feature
/// and syncs the profile in the background.
pub fn init(app: &AppHandle) {
    let account = Arc::new(VentoAccount::new(
        VENTO_URL,
        VENTO_PUBLISHABLE_KEY,
        Box::new(TauriAccountStore(app.clone())),
    ));
    app.manage(Arc::clone(&account));

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if !account.status().await.signed_in {
            return;
        }
        account.refresh_voice_enabled().await;
        if let Err(e) = sync_profile(&app).await {
            debug!("Vento: startup profile sync skipped: {:?}", e);
        }
    });
}

fn local_profile(settings: &AppSettings) -> Profile {
    Profile {
        dictionary: settings.custom_words.clone(),
        snippets: settings.snippets.iter().map(SyncedSnippet::from).collect(),
        app_styles: settings.app_prompt_map.clone(),
    }
}

fn apply_profile(app: &AppHandle, profile: &Profile) {
    let mut settings = get_settings(app);
    settings.custom_words = profile.dictionary.clone();
    settings.snippets = profile.snippets.iter().map(Into::into).collect();
    settings.app_prompt_map = profile.app_styles.clone();
    write_settings(app, settings);
    let _ = app.emit(PROFILE_SYNCED_EVENT, ());
}

/// How many times a sync starts over when the settings change under it.
const MAX_SYNC_ROUNDS: usize = 3;

/// Reconciles dictionary, snippets and per-app styles with the account.
///
/// One sync runs at a time. If the person edits the synced settings while
/// one is in flight, that round's result is not trusted: nothing stale is
/// written over the edit, the state stays "changed locally", and the sync
/// starts over.
pub async fn sync_profile(app: &AppHandle) -> Result<(), VentoError> {
    let account = account(app).ok_or(VentoError::NotSignedIn)?;
    let _one_at_a_time = account.lock_sync().await;

    for _ in 0..MAX_SYNC_ROUNDS {
        let seq_before = account.dirty_seq();
        let local = local_profile(&get_settings(app));
        let state = account.sync_state().await;
        let remote = account.fetch_profile().await?;

        let unchanged_since_read =
            || account.dirty_seq() == seq_before && local_profile(&get_settings(app)) == local;

        let synced_at = match plan_sync(&local, remote.as_ref(), &state) {
            SyncPlan::Nothing => remote.map(|r| r.updated_at),
            SyncPlan::Push(profile) => Some(account.push_profile(&profile).await?),
            SyncPlan::TakeRemote(profile) => {
                if !unchanged_since_read() {
                    continue;
                }
                apply_profile(app, &profile);
                remote.map(|r| r.updated_at)
            }
            SyncPlan::MergeAndPush(profile) => {
                if !unchanged_since_read() {
                    continue;
                }
                let updated_at = account.push_profile(&profile).await?;
                apply_profile(app, &profile);
                Some(updated_at)
            }
        };

        if account.dirty_seq() != seq_before {
            // Edited while syncing: what was pushed is already out of date.
            account
                .set_sync_state(SyncState {
                    synced_at,
                    dirty: true,
                })
                .await;
            continue;
        }

        account
            .set_sync_state(SyncState {
                synced_at,
                dirty: false,
            })
            .await;
        return Ok(());
    }

    debug!("Vento: profile kept changing during sync; it stays marked for the next one");
    Ok(())
}

/// Call after the dictionary, the snippets or the per-app styles changed
/// on this computer: marks them for upload and syncs when signed in.
pub fn profile_changed(app: &AppHandle) {
    let Some(account) = account(app) else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        account.mark_dirty().await;
        if !account.status().await.signed_in {
            return;
        }
        if let Err(e) = sync_profile(&app).await {
            debug!("Vento: profile sync after a local change failed: {:?}", e);
        }
    });
}

#[tauri::command]
#[specta::specta]
pub async fn vento_status(app: AppHandle) -> Result<AccountStatus, String> {
    match account(&app) {
        Some(account) => Ok(account.status().await),
        None => Err("unavailable".to_string()),
    }
}

/// Signs in with a Vento account. The password goes straight to Vento's
/// auth endpoint and is never stored. Errors are stable codes
/// (`invalid_credentials`, `network`, `server`).
#[tauri::command]
#[specta::specta]
pub async fn vento_sign_in(
    app: AppHandle,
    email: String,
    password: String,
) -> Result<AccountStatus, String> {
    let account = account(&app).ok_or_else(|| "unavailable".to_string())?;
    let status = account
        .sign_in(&email, &password)
        .await
        .map_err(|e| e.code().to_string())?;

    // Bring the dictionary and snippets over without making sign-in wait.
    let app_for_sync = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = sync_profile(&app_for_sync).await {
            debug!("Vento: profile sync after sign-in failed: {:?}", e);
        }
    });

    Ok(status)
}

#[tauri::command]
#[specta::specta]
pub async fn vento_sign_out(app: AppHandle) -> Result<AccountStatus, String> {
    let account = account(&app).ok_or_else(|| "unavailable".to_string())?;
    account.sign_out().await;
    Ok(account.status().await)
}

/// Re-checks the account (feature flag) and syncs the profile now.
#[tauri::command]
#[specta::specta]
pub async fn vento_refresh(app: AppHandle) -> Result<AccountStatus, String> {
    let account = account(&app).ok_or_else(|| "unavailable".to_string())?;
    if !account.status().await.signed_in {
        return Err(VentoError::NotSignedIn.code().to_string());
    }
    account.refresh_voice_enabled().await;
    let sync_result = sync_profile(&app).await;
    let status = account.status().await;
    if !status.signed_in {
        // The session turned out to be over.
        return Err(VentoError::NotSignedIn.code().to_string());
    }
    sync_result.map_err(|e| e.code().to_string())?;
    Ok(account.status().await)
}
