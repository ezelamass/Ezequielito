//! One door to the language model for everything that rewrites or writes
//! text on the user's behalf (Edit Mode, Transforms). Callers say what
//! they want; where the request goes (Vento when signed in, otherwise the
//! provider configured in settings) is decided here.

use crate::settings::{get_settings, AppSettings};
use crate::vento::{VentoError, VoiceRequest};
use log::{debug, error};
use tauri::AppHandle;

/// Longest a single request may take before it is abandoned.
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Why a request produced no text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssistError {
    /// No provider or no model is set up.
    NotConfigured,
    /// The model answered with nothing.
    Empty,
    /// The request failed (network, auth, provider error).
    Failed(String),
}

/// What the caller wants written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssistRequest<'a> {
    /// Apply a dictated instruction to the selected text; with nothing
    /// selected, write what the instruction asks for.
    Edit {
        selection: Option<&'a str>,
        instruction: &'a str,
    },
    /// Run a built-in rewrite over the selected text. `kind` is the name
    /// Vento knows it by; `system_prompt` is used with a local provider.
    Transform {
        kind: &'static str,
        system_prompt: &'static str,
        text: &'a str,
    },
}

/// Runs a request and returns the text, trimmed.
///
/// Signed in to Vento, the request goes there (no API key needed). If
/// Vento cannot serve it and a provider is configured in settings, that one
/// is used instead.
pub async fn run(app: &AppHandle, request: AssistRequest<'_>) -> Result<String, AssistError> {
    let mut vento_failure: Option<AssistError> = None;

    if let Some(account) = crate::commands::vento::account(app).filter(|a| a.is_ready()) {
        let voice_request = match request {
            AssistRequest::Edit {
                selection: Some(selection),
                instruction,
            } if !selection.trim().is_empty() => VoiceRequest::Edit {
                selection,
                instruction,
            },
            AssistRequest::Edit { instruction, .. } => VoiceRequest::Write { instruction },
            AssistRequest::Transform { kind, text, .. } => VoiceRequest::Transform {
                transform: kind,
                text,
            },
        };
        match account.voice(voice_request).await {
            Ok(response) if !response.truncated => return Ok(response.text),
            Ok(_) => {
                vento_failure = Some(AssistError::Failed("truncated".to_string()));
            }
            // Not an error of this request: the account simply cannot be
            // used, so fall through to a local provider if there is one.
            Err(VentoError::NotSignedIn) | Err(VentoError::FeatureOff) => {}
            Err(e) => {
                error!("Assist request through Vento failed: {:?}", e);
                vento_failure = Some(AssistError::Failed(e.code().to_string()));
            }
        }
    }

    let (system_prompt, user_content) = match request {
        AssistRequest::Edit {
            selection,
            instruction,
        } => build_edit_request(selection, instruction),
        AssistRequest::Transform {
            system_prompt,
            text,
            ..
        } => (system_prompt, text.to_string()),
    };
    match complete(app, system_prompt, user_content).await {
        // No local provider either: report what went wrong with Vento, if
        // it was tried.
        Err(AssistError::NotConfigured) => Err(vento_failure.unwrap_or(AssistError::NotConfigured)),
        other => other,
    }
}

/// Sends one request to the provider configured in settings.
async fn complete(
    app: &AppHandle,
    system_prompt: &str,
    user_content: String,
) -> Result<String, AssistError> {
    let settings = get_settings(app);
    // Callers hold the dictation pipeline while this runs, so a request
    // that never answers must not hold it forever.
    match tokio::time::timeout(
        REQUEST_TIMEOUT,
        complete_with_settings(&settings, system_prompt, user_content),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => {
            error!("Assist request timed out after {:?}", REQUEST_TIMEOUT);
            Err(AssistError::Failed("timeout".to_string()))
        }
    }
}

async fn complete_with_settings(
    settings: &AppSettings,
    system_prompt: &str,
    user_content: String,
) -> Result<String, AssistError> {
    let provider = settings
        .active_post_process_provider()
        .cloned()
        .ok_or(AssistError::NotConfigured)?;
    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();
    if model.trim().is_empty() {
        debug!("Assist skipped: provider '{}' has no model", provider.id);
        return Err(AssistError::NotConfigured);
    }
    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    // Turn reasoning off where the provider lets us: these are short
    // rewrites and thinking only adds latency.
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

    debug!(
        "Assist request: provider '{}' model '{}' ({} chars)",
        provider.id,
        model,
        user_content.len()
    );

    match crate::llm_client::send_chat_completion_with_schema(
        &provider,
        api_key,
        &model,
        user_content,
        Some(system_prompt.to_string()),
        None,
        reasoning_effort,
        reasoning,
    )
    .await
    {
        Ok(Some(text)) if !text.trim().is_empty() => Ok(text.trim().to_string()),
        Ok(_) => Err(AssistError::Empty),
        Err(e) => {
            error!("Assist request failed: {}", e);
            Err(AssistError::Failed(e))
        }
    }
}

const EDIT_SYSTEM_PROMPT: &str = "Sos un editor de texto. El usuario te pasa un texto seleccionado y una instrucción dictada. Aplicá la instrucción al texto. Devolvé SOLO el texto nuevo, sin preámbulo, sin explicaciones, sin comillas, sin markdown. Si la instrucción es ambigua, hacé tu mejor interpretación. Mantené el idioma del texto original.";

const WRITE_SYSTEM_PROMPT: &str = "Sos un asistente de escritura. El usuario te dicta un pedido y no hay ningún texto seleccionado: escribí lo que pide, listo para pegar donde está el cursor. Devolvé SOLO el texto, sin preámbulo, sin explicaciones, sin comillas, sin markdown. Respondé en el idioma del pedido.";

/// Builds the (system prompt, user content) pair for Edit Mode.
///
/// With a selection the instruction is applied to it; without one the
/// instruction is treated as a request to write something from scratch.
pub fn build_edit_request(selection: Option<&str>, instruction: &str) -> (&'static str, String) {
    match selection.map(str::trim).filter(|s| !s.is_empty()) {
        Some(selection) => (
            EDIT_SYSTEM_PROMPT,
            format!(
                "Texto seleccionado:\n<<<\n{}\n>>>\n\nInstrucción:\n{}",
                selection,
                instruction.trim()
            ),
        ),
        None => (WRITE_SYSTEM_PROMPT, instruction.trim().to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn with_a_selection_the_instruction_edits_it() {
        let (system, user) = build_edit_request(Some("hola mundo"), " hacelo formal ");
        assert_eq!(system, EDIT_SYSTEM_PROMPT);
        assert!(user.contains("<<<\nhola mundo\n>>>"));
        assert!(user.ends_with("Instrucción:\nhacelo formal"));
    }

    #[test]
    fn without_a_selection_the_instruction_is_a_writing_request() {
        let (system, user) = build_edit_request(None, " escribí un saludo ");
        assert_eq!(system, WRITE_SYSTEM_PROMPT);
        assert_eq!(user, "escribí un saludo");
    }

    #[test]
    fn a_blank_selection_counts_as_none() {
        let (system, _) = build_edit_request(Some("  \n"), "escribí un saludo");
        assert_eq!(system, WRITE_SYSTEM_PROMPT);
    }
}
