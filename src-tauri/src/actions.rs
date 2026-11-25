use crate::active_window::ActiveApp;
use crate::app_launcher;
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::assist::{self, AssistError, AssistRequest};
use crate::audio_feedback::{play_feedback_sound, play_feedback_sound_blocking, SoundType};
use crate::audio_toolkit::constants::WHISPER_SAMPLE_RATE;
use crate::audio_toolkit::{is_microphone_access_denied, is_no_input_device_error};
use crate::learn;
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::{DictationMeta, HistoryManager};
use crate::managers::transcription::TranscriptionManager;
use crate::overlay::OverlayError;
use crate::selection::{self, Selection};
use crate::settings::{get_settings, AppSettings, Snippet, APPLE_INTELLIGENCE_PROVIDER_ID};
use crate::shortcut;
use crate::tray::{change_tray_icon, TrayIconState};
use crate::utils::{
    self, show_processing_overlay, show_recording_overlay, show_transcribing_overlay,
};
use crate::vento::{VentoAccount, VentoError, VoiceRequest};
use crate::vento_sync::style_for_prompt;
use crate::TranscriptionCoordinator;
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{debug, error, warn};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tauri::Manager;
use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
struct RecordingErrorEvent {
    error_type: String,
    detail: Option<String>,
}

/// Drop guard that notifies the [`TranscriptionCoordinator`] when the
/// transcription pipeline finishes — whether it completes normally or panics.
struct FinishGuard(AppHandle);
impl Drop for FinishGuard {
    fn drop(&mut self) {
        if let Some(c) = self.0.try_state::<TranscriptionCoordinator>() {
            c.notify_processing_finished();
        }
    }
}

// Shortcut Action Trait
pub trait ShortcutAction: Send + Sync {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
}

// Transcribe Action
struct TranscribeAction {
    post_process: bool,
    /// When true, the transcription is matched against `voice_commands`
    /// and used to launch an app via `app_launcher` instead of being pasted.
    voice_command: bool,
    /// Phase 5: When set, overrides `post_process_selected_prompt_id` for
    /// this action only. Lets each transcribe-mode binding (casual /
    /// formal / code) target a specific LLM prompt regardless of the
    /// globally selected one.
    prompt_id_override: Option<&'static str>,
    /// Phase 8: Edit Mode. When true, the transcription is treated as an
    /// instruction. The current clipboard contents are read as "selection"
    /// and the LLM rewrites them per the instruction; result is pasted.
    edit_mode: bool,
    /// Phase 11 (rescue): Auto-mode. When true, the foreground process
    /// name is inspected and the prompt id is looked up in
    /// `settings.app_prompt_map` at runtime. Overrides any static
    /// `prompt_id_override` set on this action.
    auto_context: bool,
    /// Phase 16 (Bundle 4): Scratchpad mode. When true, the transcription
    /// is NOT pasted into the active app — instead, a `scratchpad-append`
    /// event is emitted so the in-app Scratchpad view appends the text.
    scratchpad: bool,
}

/// Apply snippet substitutions to a transcription. Case-insensitive
/// whole-word match on `trigger`; first match wins (snippets are applied
/// in the order they appear in settings). Runs after `apply_custom_words`
/// (which executes inside `transcription.rs`) and after optional LLM
/// cleanup, but before paste.
fn apply_snippets(text: &str, snippets: &[Snippet]) -> String {
    if snippets.is_empty() {
        return text.to_string();
    }
    let mut result = text.to_string();
    for snippet in snippets {
        let trigger = snippet.trigger.trim();
        if trigger.is_empty() {
            continue;
        }
        // Whole-word case-insensitive replace using regex
        let pattern = format!(r"(?i)\b{}\b", regex::escape(trigger));
        if let Ok(re) = regex::Regex::new(&pattern) {
            result = re
                .replace_all(&result, snippet.expansion.as_str())
                .into_owned();
        }
    }
    result
}

/// Field name for structured output JSON schema
const TRANSCRIPTION_FIELD: &str = "transcription";

/// Strip invisible Unicode characters that some LLMs may insert
fn strip_invisible_chars(s: &str) -> String {
    s.replace(['\u{200B}', '\u{200C}', '\u{200D}', '\u{FEFF}'], "")
}

/// Build a system prompt from the user's prompt template.
/// Removes `${output}` placeholder since the transcription is sent as the user message.
fn build_system_prompt(prompt_template: &str) -> String {
    prompt_template.replace("${output}", "").trim().to_string()
}

async fn post_process_transcription(
    settings: &AppSettings,
    transcription: &str,
    prompt_id_override: Option<&str>,
    context: Option<&ActiveApp>,
) -> Option<String> {
    let provider = match settings.active_post_process_provider().cloned() {
        Some(provider) => provider,
        None => {
            debug!("Post-processing enabled but no provider is selected");
            return None;
        }
    };

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.trim().is_empty() {
        debug!(
            "Post-processing skipped because provider '{}' has no model configured",
            provider.id
        );
        return None;
    }

    // Phase 5: if a per-action prompt override is provided (casual/formal/code),
    // it takes precedence over the globally selected prompt.
    let selected_prompt_id = match prompt_id_override
        .map(|s| s.to_string())
        .or_else(|| settings.post_process_selected_prompt_id.clone())
    {
        Some(id) => id,
        None => {
            debug!("Post-processing skipped because no prompt is selected");
            return None;
        }
    };

    let prompt = match settings
        .post_process_prompts
        .iter()
        .find(|prompt| prompt.id == selected_prompt_id)
    {
        Some(prompt) => prompt.prompt.clone(),
        None => {
            debug!(
                "Post-processing skipped because prompt '{}' was not found",
                selected_prompt_id
            );
            return None;
        }
    };

    if prompt.trim().is_empty() {
        debug!("Post-processing skipped because the selected prompt is empty");
        return None;
    }

    // Tell the model where the text is going. It goes in front of the
    // prompt so `${output}` stays last in legacy mode.
    let prompt = match context.filter(|_| settings.context_awareness) {
        Some(app) => format!("{}\n\n{}", app.context_note(), prompt),
        None => prompt,
    };

    debug!(
        "Starting LLM post-processing with provider '{}' (model: {})",
        provider.id, model
    );

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    // Disable reasoning for providers where post-processing rarely benefits from it.
    // - custom: top-level reasoning_effort (works for local OpenAI-compat servers)
    // - openrouter: nested reasoning object; exclude:true also keeps reasoning text
    //   out of the response so it can't pollute structured-output JSON parsing
    let (reasoning_effort, reasoning) = match provider.id.as_str() {
        "custom" => (Some("none".to_string()), None),
        "openrouter" => (
            None,
            Some(crate::llm_client::ReasoningConfig {
                effort: Some("none".to_string()),
                exclude: Some(true),
            }),
        ),
        _ => (None, None),
    };

    if provider.supports_structured_output {
        debug!("Using structured outputs for provider '{}'", provider.id);

        let system_prompt = build_system_prompt(&prompt);
        let user_content = transcription.to_string();

        // Handle Apple Intelligence separately since it uses native Swift APIs
        if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
            #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
            {
                if !apple_intelligence::check_apple_intelligence_availability() {
                    debug!(
                        "Apple Intelligence selected but not currently available on this device"
                    );
                    return None;
                }

                let token_limit = model.trim().parse::<i32>().unwrap_or(0);
                return match apple_intelligence::process_text_with_system_prompt(
                    &system_prompt,
                    &user_content,
                    token_limit,
                ) {
                    Ok(result) => {
                        if result.trim().is_empty() {
                            debug!("Apple Intelligence returned an empty response");
                            None
                        } else {
                            let result = strip_invisible_chars(&result);
                            debug!(
                                "Apple Intelligence post-processing succeeded. Output length: {} chars",
                                result.len()
                            );
                            Some(result)
                        }
                    }
                    Err(err) => {
                        error!("Apple Intelligence post-processing failed: {}", err);
                        None
                    }
                };
            }

            #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
            {
                debug!("Apple Intelligence provider selected on unsupported platform");
                return None;
            }
        }

        // Define JSON schema for transcription output
        let json_schema = serde_json::json!({
            "type": "object",
            "properties": {
                (TRANSCRIPTION_FIELD): {
                    "type": "string",
                    "description": "The cleaned and processed transcription text"
                }
            },
            "required": [TRANSCRIPTION_FIELD],
            "additionalProperties": false
        });

        match crate::llm_client::send_chat_completion_with_schema(
            &provider,
            api_key.clone(),
            &model,
            user_content,
            Some(system_prompt),
            Some(json_schema),
            reasoning_effort.clone(),
            reasoning.clone(),
        )
        .await
        {
            Ok(Some(content)) => {
                // Parse the JSON response to extract the transcription field
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(json) => {
                        if let Some(transcription_value) =
                            json.get(TRANSCRIPTION_FIELD).and_then(|t| t.as_str())
                        {
                            let result = strip_invisible_chars(transcription_value);
                            debug!(
                                "Structured output post-processing succeeded for provider '{}'. Output length: {} chars",
                                provider.id,
                                result.len()
                            );
                            return Some(result);
                        } else {
                            error!("Structured output response missing 'transcription' field");
                            return Some(strip_invisible_chars(&content));
                        }
                    }
                    Err(e) => {
                        error!(
                            "Failed to parse structured output JSON: {}. Returning raw content.",
                            e
                        );
                        return Some(strip_invisible_chars(&content));
                    }
                }
            }
            Ok(None) => {
                error!("LLM API response has no content");
                return None;
            }
            Err(e) => {
                warn!(
                    "Structured output failed for provider '{}': {}. Falling back to legacy mode.",
                    provider.id, e
                );
                // Fall through to legacy mode below
            }
        }
    }

    // Legacy mode: Replace ${output} variable in the prompt with the actual text
    let processed_prompt = prompt.replace("${output}", transcription);
    debug!("Processed prompt length: {} chars", processed_prompt.len());

    match crate::llm_client::send_chat_completion(
        &provider,
        api_key,
        &model,
        processed_prompt,
        reasoning_effort,
        reasoning,
    )
    .await
    {
        Ok(Some(content)) => {
            let content = strip_invisible_chars(&content);
            debug!(
                "LLM post-processing succeeded for provider '{}'. Output length: {} chars",
                provider.id,
                content.len()
            );
            Some(content)
        }
        Ok(None) => {
            error!("LLM API response has no content");
            None
        }
        Err(e) => {
            error!(
                "LLM post-processing failed for provider '{}': {}. Falling back to original transcription.",
                provider.id,
                e
            );
            None
        }
    }
}

async fn maybe_convert_chinese_variant(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    // Check if language is set to Simplified or Traditional Chinese
    let is_simplified = settings.selected_language == "zh-Hans";
    let is_traditional = settings.selected_language == "zh-Hant";

    if !is_simplified && !is_traditional {
        debug!("selected_language is not Simplified or Traditional Chinese; skipping translation");
        return None;
    }

    debug!(
        "Starting Chinese translation using OpenCC for language: {}",
        settings.selected_language
    );

    // Use OpenCC to convert based on selected language
    let config = if is_simplified {
        // Convert Traditional Chinese to Simplified Chinese
        BuiltinConfig::Tw2sp
    } else {
        // Convert Simplified Chinese to Traditional Chinese
        BuiltinConfig::S2tw
    };

    match OpenCC::from_config(config) {
        Ok(converter) => {
            let converted = converter.convert(transcription);
            debug!(
                "OpenCC translation completed. Input length: {}, Output length: {}",
                transcription.len(),
                converted.len()
            );
            Some(converted)
        }
        Err(e) => {
            error!("Failed to initialize OpenCC converter: {}. Falling back to original transcription.", e);
            None
        }
    }
}

pub(crate) struct ProcessedTranscription {
    pub final_text: String,
    pub post_processed_text: Option<String>,
    pub post_process_prompt: Option<String>,
    /// A cleanup was asked for, whether or not it produced text. Stored
    /// with the entry so a retry from History tries again.
    pub cleanup_requested: bool,
}

/// Longest a dictation waits for the Vento cleanup, token refresh
/// included, before it is pasted as transcribed.
const VENTO_CLEANUP_DEADLINE: std::time::Duration = std::time::Duration::from_secs(6);

/// Style prompts that ship with the app. A prompt outside this list is the
/// person's own, and only the local provider can run it.
fn is_builtin_prompt(prompt_id: &str) -> bool {
    matches!(
        prompt_id,
        "default_improve_transcriptions" | "ez_casual" | "ez_very_casual" | "ez_formal" | "ez_code"
    )
}

/// Whether a provider and a model are configured for local post-processing.
fn local_provider_ready(settings: &AppSettings) -> bool {
    settings
        .active_post_process_provider()
        .is_some_and(|provider| {
            settings
                .post_process_models
                .get(&provider.id)
                .is_some_and(|model| !model.trim().is_empty())
        })
}

pub(crate) async fn process_transcription_output(
    app: &AppHandle,
    transcription: &str,
    post_process: bool,
    prompt_id_override: Option<&str>,
    context: Option<&ActiveApp>,
    allow_vento: bool,
) -> ProcessedTranscription {
    let settings = get_settings(app);
    let mut final_text = transcription.to_string();
    let mut post_processed_text: Option<String> = None;
    let mut post_process_prompt: Option<String> = None;

    if let Some(converted_text) = maybe_convert_chinese_variant(&settings, transcription).await {
        final_text = converted_text;
    }

    // Signed in to Vento: every dictation is cleaned there, in the style of
    // the binding or, without one, of the app it is going to. If Vento
    // cannot answer in time, the text falls through to the local path below
    // (and, with no provider configured, is pasted as transcribed): a
    // dictation is never lost to a failed cleanup.
    //
    // Exception: the binding asked for post-processing with a prompt the
    // person wrote themselves (a translation, a house style). Vento only
    // knows the built-in styles, so that one stays with the local provider.
    let requested_prompt = prompt_id_override.map(str::to_string).or_else(|| {
        post_process
            .then(|| settings.post_process_selected_prompt_id.clone())
            .flatten()
    });
    let own_prompt = post_process
        && requested_prompt
            .as_deref()
            .is_some_and(|id| !is_builtin_prompt(id))
        && local_provider_ready(&settings);

    let mut cleaned_by_vento = false;
    let mut vento_tried = false;
    if let Some(account) =
        vento_cleanup_account(app, &settings, allow_vento).filter(|_| !own_prompt)
    {
        vento_tried = true;
        let style_prompt = prompt_id_override
            .map(str::to_string)
            .or_else(|| context.and_then(|app| settings.app_prompt_map.get(&app.process).cloned()));
        let style = style_for_prompt(style_prompt.as_deref());
        let shared_context = context.filter(|_| settings.context_awareness);
        let request = VoiceRequest::Clean {
            text: &final_text,
            style,
            app: shared_context.map(|app| app.process.as_str()),
            window_title: shared_context.and_then(|app| app.title.as_deref()),
            dictionary: &settings.custom_words,
        };
        match tokio::time::timeout(VENTO_CLEANUP_DEADLINE, account.voice(request)).await {
            Ok(Ok(response)) if !response.truncated => {
                post_processed_text = Some(response.text.clone());
                post_process_prompt = Some(format!("Vento · {}", style));
                final_text = response.text;
                cleaned_by_vento = true;
            }
            Ok(Ok(_)) => warn!("Vento cleanup came back cut short; keeping the transcription"),
            Ok(Err(e)) => {
                warn!("Vento cleanup failed: {:?}", e);
                if matches!(e, VentoError::NotSignedIn | VentoError::DailyLimit) {
                    // The account screen should show why cleanups stopped.
                    let _ = app.emit(crate::commands::vento::ACCOUNT_CHANGED_EVENT, ());
                }
            }
            Err(_) => warn!(
                "Vento cleanup did not answer in {:?}; keeping the transcription",
                VENTO_CLEANUP_DEADLINE
            ),
        }
    }

    if cleaned_by_vento {
        // Nothing else to do.
    } else if post_process {
        if let Some(processed_text) =
            post_process_transcription(&settings, &final_text, prompt_id_override, context).await
        {
            post_processed_text = Some(processed_text.clone());
            final_text = processed_text;

            // Resolve effective prompt id (override > global selection) for history record
            let effective_prompt_id = prompt_id_override
                .map(|s| s.to_string())
                .or_else(|| settings.post_process_selected_prompt_id.clone());
            if let Some(prompt_id) = effective_prompt_id.as_ref() {
                if let Some(prompt) = settings
                    .post_process_prompts
                    .iter()
                    .find(|prompt| &prompt.id == prompt_id)
                {
                    post_process_prompt = Some(prompt.prompt.clone());
                }
            }
        }
    } else if final_text != transcription {
        post_processed_text = Some(final_text.clone());
    }

    ProcessedTranscription {
        final_text,
        post_processed_text,
        post_process_prompt,
        cleanup_requested: post_process || vento_tried,
    }
}

/// The Vento account to clean a dictation with, when that applies: the
/// caller allows it, the setting is on and the account is usable.
fn vento_cleanup_account(
    app: &AppHandle,
    settings: &AppSettings,
    allow_vento: bool,
) -> Option<Arc<VentoAccount>> {
    if !allow_vento || !settings.vento_cleanup {
        return None;
    }
    crate::commands::vento::account(app).filter(|account| account.is_ready())
}

impl ShortcutAction for TranscribeAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        let start_time = Instant::now();
        debug!("TranscribeAction::start called for binding: {}", binding_id);

        // Load model in the background
        let tm = app.state::<Arc<TranscriptionManager>>();
        let rm = app.state::<Arc<AudioRecordingManager>>();

        // Load ASR model and VAD model in parallel
        tm.initiate_model_load();
        let rm_clone = Arc::clone(&rm);
        std::thread::spawn(move || {
            if let Err(e) = rm_clone.preload_vad() {
                debug!("VAD pre-load failed: {}", e);
            }
        });

        let binding_id = binding_id.to_string();
        change_tray_icon(app, TrayIconState::Recording);
        show_recording_overlay(app);

        // Get the microphone mode to determine audio feedback timing
        let settings = get_settings(app);
        let is_always_on = settings.always_on_microphone;
        debug!("Microphone mode - always_on: {}", is_always_on);

        let mut recording_error: Option<String> = None;
        if is_always_on {
            // Always-on mode: Play audio feedback immediately, then apply mute after sound finishes
            debug!("Always-on mode: Playing audio feedback immediately");
            let rm_clone = Arc::clone(&rm);
            let app_clone = app.clone();
            // The blocking helper exits immediately if audio feedback is disabled,
            // so we can always reuse this thread to ensure mute happens right after playback.
            std::thread::spawn(move || {
                play_feedback_sound_blocking(&app_clone, SoundType::Start);
                rm_clone.apply_mute();
            });

            if let Err(e) = rm.try_start_recording(&binding_id) {
                debug!("Recording failed: {}", e);
                recording_error = Some(e);
            }
        } else {
            // On-demand mode: Start recording first, then play audio feedback, then apply mute
            // This allows the microphone to be activated before playing the sound
            debug!("On-demand mode: Starting recording first, then audio feedback");
            let recording_start_time = Instant::now();
            match rm.try_start_recording(&binding_id) {
                Ok(()) => {
                    debug!("Recording started in {:?}", recording_start_time.elapsed());
                    // Small delay to ensure microphone stream is active
                    let app_clone = app.clone();
                    let rm_clone = Arc::clone(&rm);
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        debug!("Handling delayed audio feedback/mute sequence");
                        // Helper handles disabled audio feedback by returning early, so we reuse it
                        // to keep mute sequencing consistent in every mode.
                        play_feedback_sound_blocking(&app_clone, SoundType::Start);
                        rm_clone.apply_mute();
                    });
                }
                Err(e) => {
                    debug!("Failed to start recording: {}", e);
                    recording_error = Some(e);
                }
            }
        }

        if recording_error.is_none() {
            // Dynamically register the cancel shortcut in a separate task to avoid deadlock
            shortcut::register_cancel_shortcut(app);
            // Phase 6: dynamically register the hands-free toggle (Space)
            // so it only hijacks Space while recording is active.
            shortcut::register_hands_free_shortcut(app);

            // While the person talks, get the Vento connection and token
            // ready so the cleanup does not pay for them afterwards.
            if let Some(account) =
                crate::commands::vento::account(app).filter(|account| account.is_ready())
            {
                tauri::async_runtime::spawn(async move { account.prewarm().await });
            }
        } else {
            // Starting failed (for example due to blocked microphone permissions).
            // Revert UI state so we don't stay stuck in the recording overlay.
            change_tray_icon(app, TrayIconState::Idle);
            if let Some(err) = recording_error {
                let (error_type, overlay_error) = if is_microphone_access_denied(&err) {
                    ("microphone_permission_denied", OverlayError::MicDenied)
                } else if is_no_input_device_error(&err) {
                    ("no_input_device", OverlayError::NoMic)
                } else {
                    ("unknown", OverlayError::Generic)
                };
                utils::show_error_overlay(app, overlay_error);
                let _ = app.emit(
                    "recording-error",
                    RecordingErrorEvent {
                        error_type: error_type.to_string(),
                        detail: Some(err),
                    },
                );
            }
        }

        debug!(
            "TranscribeAction::start completed in {:?}",
            start_time.elapsed()
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        // Unregister the cancel shortcut when transcription stops
        shortcut::unregister_cancel_shortcut(app);
        // Phase 6: also unregister hands-free toggle (Space frees up).
        shortcut::unregister_hands_free_shortcut(app);

        let stop_time = Instant::now();
        debug!("TranscribeAction::stop called for binding: {}", binding_id);

        let ah = app.clone();
        let rm = Arc::clone(&app.state::<Arc<AudioRecordingManager>>());
        let tm = Arc::clone(&app.state::<Arc<TranscriptionManager>>());
        let hm = Arc::clone(&app.state::<Arc<HistoryManager>>());

        change_tray_icon(app, TrayIconState::Transcribing);
        show_transcribing_overlay(app);

        // Unmute before playing audio feedback so the stop sound is audible
        rm.remove_mute();

        // Play audio feedback for recording stop
        play_feedback_sound(app, SoundType::Stop);

        let binding_id = binding_id.to_string(); // Clone binding_id for the async task
        let post_process = self.post_process;
        let voice_command = self.voice_command;
        let prompt_id_override = self.prompt_id_override;
        let edit_mode = self.edit_mode;
        let auto_context = self.auto_context;
        let scratchpad = self.scratchpad;

        // The app the text is going to. Read here, synchronously, while the
        // user's target window is still in front: it picks the style in
        // auto mode, gives the cleanup model its context, tells selection
        // capture whether copying is safe, and is stored for Insights.
        let target_app = crate::active_window::active_app();

        // Phase 11 (rescue): resolve auto-mode prompt id synchronously here
        // (before the spawn) so we capture the foreground app while the
        // user's target window is still focused. Stored as String to keep
        // ownership through the .await boundary.
        let auto_resolved_prompt_id: Option<String> = if auto_context {
            let settings = get_settings(app);
            let resolved = target_app
                .as_ref()
                .and_then(|app| settings.app_prompt_map.get(&app.process).cloned())
                .unwrap_or_else(|| "ez_casual".to_string());
            debug!(
                "Auto-mode: foreground app={:?} → prompt='{}'",
                target_app.as_ref().map(|app| app.process.as_str()),
                resolved
            );
            Some(resolved)
        } else {
            None
        };

        tauri::async_runtime::spawn(async move {
            let _guard = FinishGuard(ah.clone());
            debug!(
                "Starting async transcription task for binding: {}",
                binding_id
            );

            let stop_recording_time = Instant::now();
            let stopped = rm.stop_recording(&binding_id);

            if let Some(samples) = stopped {
                debug!(
                    "Recording stopped and samples retrieved in {:?}, sample count: {}",
                    stop_recording_time.elapsed(),
                    samples.len()
                );

                if samples.is_empty() {
                    debug!("Recording produced no audio samples; skipping persistence");
                    utils::show_error_overlay(&ah, OverlayError::NoSpeech);
                    change_tray_icon(&ah, TrayIconState::Idle);
                } else {
                    // Edit Mode: read what the user has selected in the
                    // foreground app (see `selection.rs`). It starts once
                    // the microphone is closed and there is audio to act
                    // on, and runs while that audio is transcribed. `None`
                    // means nothing is selected and the instruction becomes
                    // a writing request.
                    let mut selection_task = if edit_mode {
                        let ah = ah.clone();
                        let target_app = target_app.clone();
                        Some(tauri::async_runtime::spawn_blocking(move || {
                            selected_text(&ah, target_app.as_ref())
                        }))
                    } else {
                        None
                    };

                    // Save WAV concurrently with transcription
                    let sample_count = samples.len();
                    let dictation_meta = DictationMeta {
                        duration_ms: Some(samples_to_ms(sample_count)),
                        app_name: target_app.as_ref().map(|app| app.process.clone()),
                    };
                    let file_name = format!("handy-{}.wav", chrono::Utc::now().timestamp());
                    let wav_path = hm.recordings_dir().join(&file_name);
                    let wav_path_for_verify = wav_path.clone();
                    let samples_for_wav = samples.clone();
                    let wav_handle = tauri::async_runtime::spawn_blocking(move || {
                        crate::audio_toolkit::save_wav_file(&wav_path, &samples_for_wav)
                    });

                    // Transcribe concurrently with WAV save
                    let transcription_time = Instant::now();
                    let transcription_result = tm.transcribe(samples);

                    // Await WAV save and verify
                    let wav_saved = match wav_handle.await {
                        Ok(Ok(())) => {
                            match crate::audio_toolkit::verify_wav_file(
                                &wav_path_for_verify,
                                sample_count,
                            ) {
                                Ok(()) => true,
                                Err(e) => {
                                    error!("WAV verification failed: {}", e);
                                    false
                                }
                            }
                        }
                        Ok(Err(e)) => {
                            error!("Failed to save WAV file: {}", e);
                            false
                        }
                        Err(e) => {
                            error!("WAV save task panicked: {}", e);
                            false
                        }
                    };

                    match transcription_result {
                        Ok(transcription) => {
                            debug!(
                                "Transcription completed in {:?}: {} chars",
                                transcription_time.elapsed(),
                                transcription.chars().count()
                            );

                            // Voice commands and Edit Mode instructions are
                            // used as spoken, never cleaned.
                            let allow_vento = !voice_command && !edit_mode;
                            if post_process
                                || vento_cleanup_account(&ah, &get_settings(&ah), allow_vento)
                                    .is_some()
                            {
                                show_processing_overlay(&ah);
                            }
                            // Phase 11 (rescue): auto-context wins over static override.
                            let effective_prompt_id: Option<&str> =
                                match (auto_resolved_prompt_id.as_deref(), prompt_id_override) {
                                    (Some(s), _) => Some(s),
                                    (None, Some(s)) => Some(s),
                                    _ => None,
                                };
                            let processed = process_transcription_output(
                                &ah,
                                &transcription,
                                post_process,
                                effective_prompt_id,
                                target_app.as_ref(),
                                allow_vento,
                            )
                            .await;

                            // Save to history if WAV was saved
                            if wav_saved {
                                if let Err(err) = hm.save_entry(
                                    file_name,
                                    transcription,
                                    // Also true when Vento was tried,
                                    // so a retry from History cleans it.
                                    processed.cleanup_requested,
                                    processed.post_processed_text.clone(),
                                    processed.post_process_prompt.clone(),
                                    dictation_meta.clone(),
                                ) {
                                    error!("Failed to save history entry: {}", err);
                                }
                            }

                            // Apply user snippets (voice-trigger → text expansion)
                            // between LLM cleanup and paste. Custom-words substitution
                            // already ran inside `transcription.rs`.
                            let snippets = get_settings(&ah).snippets;
                            let mut final_text = apply_snippets(&processed.final_text, &snippets);

                            // Edit Mode: `final_text` is the spoken instruction.
                            // Apply it to the selection (or, with nothing
                            // selected, write what it asks for) and paste the
                            // result through the standard flow. On failure
                            // nothing is pasted: pasting the instruction would
                            // overwrite the user's selection with it.
                            // Always collect the selection read, so the
                            // clipboard is back in place before any paste.
                            let edit_selection: Option<String> = match selection_task.take() {
                                Some(task) => task.await.ok().flatten(),
                                None => None,
                            };
                            let mut edit_error: Option<OverlayError> = None;
                            if edit_mode && !final_text.trim().is_empty() {
                                show_processing_overlay(&ah);
                                let request = AssistRequest::Edit {
                                    selection: edit_selection.as_deref(),
                                    instruction: &final_text,
                                };
                                match assist::run(&ah, request).await {
                                    Ok(rewritten) => final_text = rewritten,
                                    Err(e) => {
                                        warn!("Edit Mode: {:?}", e);
                                        edit_error = Some(overlay_error_for(&e));
                                    }
                                }
                            }

                            if let Some(edit_error) = edit_error {
                                utils::show_error_overlay(&ah, edit_error);
                                change_tray_icon(&ah, TrayIconState::Idle);
                            } else if final_text.is_empty() {
                                utils::show_error_overlay(&ah, OverlayError::NoSpeech);
                                change_tray_icon(&ah, TrayIconState::Idle);
                            } else if scratchpad {
                                // Phase 16: send to in-app Scratchpad view
                                // instead of pasting into the active app.
                                let _ = ah.emit("scratchpad-append", final_text.clone());
                                utils::hide_recording_overlay(&ah);
                                change_tray_icon(&ah, TrayIconState::Idle);
                            } else if voice_command {
                                // Voice-command mode: don't paste; instead, look
                                // the phrase up in `voice_commands` and launch.
                                let commands = get_settings(&ah).voice_commands;
                                match app_launcher::match_and_launch(&final_text, &commands) {
                                    Ok(phrase) => {
                                        debug!("Voice command launched: '{}'", phrase);
                                        utils::hide_recording_overlay(&ah);
                                    }
                                    Err(e) => {
                                        warn!("{}", e);
                                        // Emit an event so the frontend can show a toast/notification
                                        let _ = ah.emit("voice-command-miss", final_text.clone());
                                        utils::show_error_overlay(
                                            &ah,
                                            OverlayError::CommandNotFound,
                                        );
                                    }
                                }
                                change_tray_icon(&ah, TrayIconState::Idle);
                            } else {
                                let ah_clone = ah.clone();
                                let paste_time = Instant::now();
                                let final_text_clone = final_text.clone();
                                ah.run_on_main_thread(move || {
                                    match utils::paste(final_text_clone, ah_clone.clone()) {
                                        Ok(()) => {
                                            debug!(
                                                "Text pasted successfully in {:?}",
                                                paste_time.elapsed()
                                            );
                                            utils::hide_recording_overlay(&ah_clone);
                                        }
                                        Err(e) => {
                                            error!("Failed to paste transcription: {}", e);
                                            let _ = ah_clone.emit("paste-error", ());
                                            utils::show_error_overlay(
                                                &ah_clone,
                                                OverlayError::PasteFailed,
                                            );
                                        }
                                    }
                                    change_tray_icon(&ah_clone, TrayIconState::Idle);
                                })
                                .unwrap_or_else(|e| {
                                    error!("Failed to run paste on main thread: {:?}", e);
                                    utils::hide_recording_overlay(&ah);
                                    change_tray_icon(&ah, TrayIconState::Idle);
                                });
                            }
                        }
                        Err(err) => {
                            debug!("Global Shortcut Transcription error: {}", err);
                            // Save entry with empty text so user can retry
                            if wav_saved {
                                if let Err(save_err) = hm.save_entry(
                                    file_name,
                                    String::new(),
                                    post_process,
                                    None,
                                    None,
                                    dictation_meta.clone(),
                                ) {
                                    error!("Failed to save failed history entry: {}", save_err);
                                }
                            }
                            utils::show_error_overlay(&ah, OverlayError::TranscriptionFailed);
                            change_tray_icon(&ah, TrayIconState::Idle);
                        }
                    }
                }
            } else {
                debug!("No samples retrieved from recording stop");
                utils::hide_recording_overlay(&ah);
                change_tray_icon(&ah, TrayIconState::Idle);
            }
        });

        debug!(
            "TranscribeAction::stop completed in {:?}",
            stop_time.elapsed()
        );
    }
}

// Cancel Action
struct CancelAction;

impl ShortcutAction for CancelAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        utils::cancel_current_operation(app);
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // Nothing to do on stop for cancel
    }
}

/// Length in milliseconds of `sample_count` samples of recorded speech.
fn samples_to_ms(sample_count: usize) -> i64 {
    (sample_count as i64) * 1000 / i64::from(WHISPER_SAMPLE_RATE)
}

/// Text selected in the foreground app, or `None` when nothing is.
///
/// Where copy cannot be simulated safely (Wayland, a terminal) it falls back
/// to what the user copied by hand, which is how this worked before.
///
/// Blocks for up to about a second; never call it from the main thread.
fn selected_text(app: &AppHandle, target: Option<&ActiveApp>) -> Option<String> {
    match selection::capture_selection(app, target) {
        Selection::Text(text) => Some(text),
        Selection::Empty => None,
        Selection::Unsupported => {
            use tauri_plugin_clipboard_manager::ClipboardExt;
            app.clipboard()
                .read_text()
                .ok()
                .filter(|text| !text.trim().is_empty())
        }
    }
}

/// The pill message for a failed model request.
fn overlay_error_for(error: &AssistError) -> OverlayError {
    match error {
        AssistError::NotConfigured => OverlayError::AiNotConfigured,
        AssistError::Empty | AssistError::Failed(_) => OverlayError::AiFailed,
    }
}

// Transform Action — a pre-bound rewrite of the selected text. Pattern: user
// selects text → presses and releases the transform hotkey → the model
// rewrites it with this transform's prompt → the result is pasted over the
// selection.
struct TransformAction {
    name: &'static str,
    /// The name Vento knows this transform by.
    kind: &'static str,
    system_prompt: &'static str,
}

impl ShortcutAction for TransformAction {
    fn start(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // Nothing on press: the work happens on release. The release event
        // fires when the main key goes up, possibly with modifiers still
        // held; `selection.rs` waits for those before simulating the copy.
    }

    fn stop(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        let name = self.name;
        let kind = self.kind;
        let system_prompt = self.system_prompt;
        let ah = app.clone();

        // Reserving the pipeline and reading the selection both block, so
        // they get their own thread rather than the shortcut handler's.
        std::thread::spawn(move || {
            // A Transform uses the clipboard, the paste and the pill, the
            // same things a dictation uses: one at a time. The guard hands
            // the pipeline back when this work ends, however it ends.
            let Some(coordinator) = ah.try_state::<TranscriptionCoordinator>() else {
                return;
            };
            if !coordinator.try_begin_external() {
                debug!("Transform '{}' ignored: the pipeline is busy", name);
                return;
            }
            let guard = FinishGuard(ah.clone());

            let target_app = crate::active_window::active_app();
            let Some(selection) = selected_text(&ah, target_app.as_ref()) else {
                debug!("Transform '{}': nothing selected", name);
                utils::show_error_overlay(&ah, OverlayError::NoSelection);
                return;
            };

            debug!(
                "Transform '{}' invoked on {} selected chars",
                name,
                selection.len()
            );
            change_tray_icon(&ah, TrayIconState::Transcribing);
            show_processing_overlay(&ah);

            tauri::async_runtime::spawn(async move {
                let request = AssistRequest::Transform {
                    kind,
                    system_prompt,
                    text: &selection,
                };
                match assist::run(&ah, request).await {
                    Ok(new_text) => {
                        let ah_clone = ah.clone();
                        ah.run_on_main_thread(move || {
                            // Released only after the paste (and its
                            // clipboard restore) has actually run.
                            let _guard = guard;
                            match utils::paste(new_text, ah_clone.clone()) {
                                Ok(()) => {
                                    debug!("Transform '{}': pasted result", name);
                                    utils::hide_recording_overlay(&ah_clone);
                                }
                                Err(e) => {
                                    error!("Transform '{}' paste failed: {}", name, e);
                                    utils::show_error_overlay(&ah_clone, OverlayError::PasteFailed);
                                }
                            }
                            change_tray_icon(&ah_clone, TrayIconState::Idle);
                        })
                        .unwrap_or_else(|e| {
                            error!("Transform '{}': main thread unavailable: {:?}", name, e);
                            utils::hide_recording_overlay(&ah);
                            change_tray_icon(&ah, TrayIconState::Idle);
                        });
                    }
                    Err(e) => {
                        warn!("Transform '{}': {:?}", name, e);
                        utils::show_error_overlay(&ah, overlay_error_for(&e));
                        change_tray_icon(&ah, TrayIconState::Idle);
                        drop(guard);
                    }
                }
            });
        });
    }
}

// Adds the word (or short name) selected in the foreground app to the
// dictionary. Same release-then-copy pattern as a Transform.
struct AddToDictionaryAction;

impl ShortcutAction for AddToDictionaryAction {
    fn start(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // Nothing on press: see `TransformAction::start`.
    }

    fn stop(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        let ah = app.clone();
        std::thread::spawn(move || {
            let Some(coordinator) = ah.try_state::<TranscriptionCoordinator>() else {
                return;
            };
            if !coordinator.try_begin_external() {
                debug!("Add to dictionary ignored: the pipeline is busy");
                return;
            }
            let _guard = FinishGuard(ah.clone());

            let target_app = crate::active_window::active_app();
            let word = selected_text(&ah, target_app.as_ref())
                .as_deref()
                .and_then(learn::word_from_selection);
            let Some(word) = word else {
                utils::show_error_overlay(&ah, OverlayError::NoSelection);
                return;
            };

            let mut settings = get_settings(&ah);
            if learn::add_word(&mut settings.custom_words, &word) {
                crate::settings::write_settings(&ah, settings);
                crate::commands::vento::profile_changed(&ah);
                let _ = ah.emit("dictionary-changed", ());
                utils::show_error_overlay(&ah, OverlayError::WordAdded);
            } else {
                utils::show_error_overlay(&ah, OverlayError::WordKnown);
            }
        });
    }
}

// Phase 6: Hands-free Toggle Action
// Fires on Space tap mid-recording. Delegates the decision (lock the
// recording vs. stop it) to TranscriptionCoordinator, which owns the
// hands_free_locked state.
struct HandsFreeToggleAction;

impl ShortcutAction for HandsFreeToggleAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
            coordinator.toggle_hands_free();
        } else {
            warn!("Hands-free toggle fired but coordinator not initialized");
        }
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // No-op — toggle fires on press only.
    }
}

// Test Action
struct TestAction;

impl ShortcutAction for TestAction {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Started - {} (App: {})", // Changed "Pressed" to "Started" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Stopped - {} (App: {})", // Changed "Released" to "Stopped" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }
}

// Static Action Map
pub static ACTION_MAP: Lazy<HashMap<String, Arc<dyn ShortcutAction>>> = Lazy::new(|| {
    let mut map = HashMap::new();
    map.insert(
        "transcribe".to_string(),
        Arc::new(TranscribeAction {
            post_process: false,
            voice_command: false,
            prompt_id_override: None,
            edit_mode: false,
            auto_context: false,
            scratchpad: false,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "transcribe_with_post_process".to_string(),
        Arc::new(TranscribeAction {
            post_process: true,
            voice_command: false,
            prompt_id_override: None,
            edit_mode: false,
            auto_context: false,
            scratchpad: false,
        }) as Arc<dyn ShortcutAction>,
    );
    // Phase 5: three transcribe modes, each forcing a specific LLM prompt
    map.insert(
        "transcribe_casual".to_string(),
        Arc::new(TranscribeAction {
            post_process: true,
            voice_command: false,
            prompt_id_override: Some("ez_casual"),
            edit_mode: false,
            auto_context: false,
            scratchpad: false,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "transcribe_formal".to_string(),
        Arc::new(TranscribeAction {
            post_process: true,
            voice_command: false,
            prompt_id_override: Some("ez_formal"),
            edit_mode: false,
            auto_context: false,
            scratchpad: false,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "transcribe_code".to_string(),
        Arc::new(TranscribeAction {
            post_process: true,
            voice_command: false,
            prompt_id_override: Some("ez_code"),
            edit_mode: false,
            auto_context: false,
            scratchpad: false,
        }) as Arc<dyn ShortcutAction>,
    );
    // Phase 11 (rescue): context-aware auto-mode
    map.insert(
        "transcribe_auto".to_string(),
        Arc::new(TranscribeAction {
            post_process: true,
            voice_command: false,
            prompt_id_override: None,
            edit_mode: false,
            auto_context: true,
            scratchpad: false,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "voice_command".to_string(),
        Arc::new(TranscribeAction {
            post_process: false,
            voice_command: true,
            prompt_id_override: None,
            edit_mode: false,
            auto_context: false,
            scratchpad: false,
        }) as Arc<dyn ShortcutAction>,
    );
    // Phase 16 (Bundle 4): Scratchpad — emit `scratchpad-append` event
    // instead of pasting into the active app.
    map.insert(
        "transcribe_to_scratchpad".to_string(),
        Arc::new(TranscribeAction {
            post_process: false,
            voice_command: false,
            prompt_id_override: None,
            edit_mode: false,
            auto_context: false,
            scratchpad: true,
        }) as Arc<dyn ShortcutAction>,
    );
    // Phase 6: hands-free toggle (Space tap during recording)
    map.insert(
        "hands_free_toggle".to_string(),
        Arc::new(HandsFreeToggleAction) as Arc<dyn ShortcutAction>,
    );
    // Phase 8: Edit Mode — clipboard selection + spoken instruction → LLM rewrite
    map.insert(
        "transcribe_edit".to_string(),
        Arc::new(TranscribeAction {
            post_process: false,
            voice_command: false,
            prompt_id_override: None,
            edit_mode: true,
            auto_context: false,
            scratchpad: false,
        }) as Arc<dyn ShortcutAction>,
    );
    // Phase 15 (Bundle 3): Transforms — three pre-bound LLM transforms
    // on the clipboard.
    map.insert(
        "transform_polish".to_string(),
        Arc::new(TransformAction {
            name: "Polish",
            kind: "polish",
            system_prompt: "You are a writing assistant. Rewrite the user's text to improve clarity, conciseness, and grammar while preserving the original meaning, voice, and language. Return ONLY the rewritten text, with no preamble, quotes, or markdown.",
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "transform_prompt_engineer".to_string(),
        Arc::new(TransformAction {
            name: "Prompt Engineer",
            kind: "prompt_engineer",
            system_prompt: "You are a prompt engineer. Rewrite the user's text as a well-structured LLM prompt: clear role, explicit task, constraints, expected output format. Keep the user's original intent. Return ONLY the new prompt, no preamble or commentary.",
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "transform_summarize".to_string(),
        Arc::new(TransformAction {
            name: "Summarize",
            kind: "summarize",
            system_prompt: "Summarize the user's text in 3-5 concise sentences. Keep the original language. Preserve the key facts and the speaker's tone. Return ONLY the summary, no preamble, no bullet points unless the original used them.",
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "add_selection_to_dictionary".to_string(),
        Arc::new(AddToDictionaryAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "cancel".to_string(),
        Arc::new(CancelAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "test".to_string(),
        Arc::new(TestAction) as Arc<dyn ShortcutAction>,
    );
    map
});
