//! Voice-command app launcher (Ezequielito fork).
//!
//! When the `voice_command` hotkey fires, the user dictates something like
//! "open Claude Code". The transcription is normalized (lowercased, prefix
//! stripped) and matched against the `voice_commands` map in settings. On
//! a hit, we shell-out to `cmd /C start "" <target>` to launch the app or
//! URI via the Windows shell — same handler that processes start-menu
//! launches, custom URI protocols, Microsoft Store apps, and bare exes.
//!
//! Mirrors the existing `std::process::Command` invocation pattern used
//! elsewhere in `clipboard.rs` for external paste scripts.

use log::{info, warn};
use std::collections::HashMap;
use std::process::Command;

/// Spawn the Windows shell to launch `target`. `target` can be a URI
/// (`claude://`), an executable name (`chrome.exe`), or a Store app
/// activation alias.
pub fn launch(target: &str) -> Result<(), String> {
    info!("Voice command launching: '{}'", target);

    // `cmd /C start "" <target>` — the empty quoted string is the
    // window title arg that `start` requires when the target is quoted.
    Command::new("cmd")
        .args(["/C", "start", "", target])
        .spawn()
        .map_err(|e| format!("Failed to launch '{}': {}", target, e))?;

    Ok(())
}

/// Match a transcription against the voice-command map and launch on hit.
/// Returns `Ok(launched_phrase)` on success, `Err(reason)` on miss.
///
/// Normalization steps applied to the transcription before lookup:
/// - lowercase
/// - trim surrounding whitespace and trailing punctuation
/// - strip common leading verbs: "open", "abrir", "abrí", "launch", "lanzar"
pub fn match_and_launch(
    transcription: &str,
    commands: &HashMap<String, String>,
) -> Result<String, String> {
    let trimmed = transcription
        .trim()
        .trim_end_matches(|c: char| c == '.' || c == ',' || c == '!' || c == '?')
        .to_lowercase();

    // Strip optional leading verb prefixes (longest match first).
    let normalized = ["open ", "abrir ", "abrí ", "launch ", "lanzar "]
        .iter()
        .find_map(|prefix| trimmed.strip_prefix(prefix))
        .unwrap_or(trimmed.as_str())
        .trim()
        .to_string();

    if let Some(target) = commands.get(&normalized) {
        launch(target)?;
        Ok(normalized)
    } else {
        warn!("No voice command match for: '{}'", normalized);
        Err(format!("Voice command not recognized: '{}'", normalized))
    }
}
