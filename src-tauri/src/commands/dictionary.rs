//! Dictionary suggestions: words the app proposes from the person's own
//! dictations (see `learn.rs`), and what they decide about each.

use crate::learn::{self, Dictation, WordSuggestion};
use crate::managers::history::HistoryManager;
use crate::settings::{get_settings, write_settings};
use std::sync::Arc;
use tauri::{AppHandle, State};

/// Words suggested for the dictionary, most corrected first. Looks at the
/// dictations kept in History that went through a cleanup.
#[tauri::command]
#[specta::specta]
pub async fn get_dictionary_suggestions(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<Vec<WordSuggestion>, String> {
    let history = history_manager
        .get_history_entries(None, None)
        .await
        .map_err(|e| e.to_string())?;
    let settings = get_settings(&app);

    let dictations: Vec<Dictation> = history
        .entries
        .iter()
        .filter_map(|entry| {
            entry
                .post_processed_text
                .as_deref()
                .map(|cleaned| Dictation {
                    raw: &entry.transcription_text,
                    cleaned,
                })
        })
        .collect();

    Ok(learn::suggest_words(
        &dictations,
        &settings.custom_words,
        &settings.dictionary_dismissed,
    ))
}

/// Adds a suggested word to the dictionary.
#[tauri::command]
#[specta::specta]
pub fn accept_dictionary_suggestion(app: AppHandle, word: String) -> Result<(), String> {
    let mut settings = get_settings(&app);
    if learn::add_word(&mut settings.custom_words, word.trim()) {
        write_settings(&app, settings);
        crate::commands::vento::profile_changed(&app);
    }
    Ok(())
}

/// Stops suggesting a word.
#[tauri::command]
#[specta::specta]
pub fn dismiss_dictionary_suggestion(app: AppHandle, word: String) -> Result<(), String> {
    let mut settings = get_settings(&app);
    if learn::add_word(&mut settings.dictionary_dismissed, word.trim()) {
        write_settings(&app, settings);
    }
    Ok(())
}
