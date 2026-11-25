//! Reads the text the user has selected in the foreground app.
//!
//! There is no portable "get selection" API, so this does what a person
//! would: press copy and read the clipboard, then put the clipboard back the
//! way it was. Used by Edit Mode and Transforms so nobody has to copy by
//! hand before speaking an instruction.

use crate::active_window::ActiveApp;
use crate::input::{self, EnigoState};
use log::warn;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// How long to wait for the foreground app to answer the copy shortcut.
const COPY_TIMEOUT: Duration = Duration::from_millis(450);
const POLL_INTERVAL: Duration = Duration::from_millis(15);
/// How long to wait for the user to let go of the hotkey's modifiers.
const MODIFIER_TIMEOUT: Duration = Duration::from_millis(400);
/// How long the main thread gets to send the keystroke.
const DISPATCH_TIMEOUT: Duration = Duration::from_secs(1);

/// What `capture_selection` found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selection {
    /// Text was selected; this is it.
    Text(String),
    /// The app answered nothing: no selection (or it is not text).
    Empty,
    /// Copy was not simulated (Linux, a terminal where Ctrl+C interrupts
    /// the running program, an app that could not be identified, or the
    /// keystroke could not be sent). The caller may fall back to whatever
    /// the user copied by hand.
    Unsupported,
}

/// Apps where Ctrl+C is "interrupt", not "copy".
///
/// Only matters on Windows and Linux: macOS terminals copy with Cmd+C.
/// Terminals embedded in another app (an editor's terminal panel) cannot be
/// told apart from the editor and are not covered.
const TERMINALS: &[&str] = &[
    "windowsterminal",
    "wt",
    "cmd",
    "powershell",
    "pwsh",
    "conhost",
    "openconsole",
    "mintty",
    "alacritty",
    "wezterm",
    "wezterm-gui",
    "kitty",
    "hyper",
    "tabby",
    "warp",
    "putty",
    "gnome-terminal",
    "konsole",
    "xterm",
];

/// Whether the copy shortcut can be simulated without risk of doing
/// something other than copying.
///
/// - macOS: always. Cmd+C is copy everywhere, terminals included.
/// - Windows: only when the foreground app is known and is not a terminal.
///   An app that could not be identified might be one.
/// - Linux: never. The foreground app cannot be identified there, so a
///   terminal cannot be ruled out.
fn copy_is_safe(app: Option<&ActiveApp>) -> bool {
    if cfg!(target_os = "macos") {
        return true;
    }
    if cfg!(target_os = "linux") {
        return false;
    }
    app.is_some_and(|app| !TERMINALS.contains(&app.process.as_str()))
}

/// Returns the selected text of the foreground app, leaving the clipboard
/// as it was (text and images; other formats cannot be restored).
///
/// `target` is the foreground app, when known. Blocks the calling thread
/// for up to roughly `MODIFIER_TIMEOUT + COPY_TIMEOUT`. Must NOT be called
/// from the main thread: the key press itself is dispatched there.
pub fn capture_selection(app: &AppHandle, target: Option<&ActiveApp>) -> Selection {
    if !copy_is_safe(target) {
        log::debug!("Selection capture skipped: copy cannot be simulated safely here");
        return Selection::Unsupported;
    }

    let clipboard = app.clipboard();
    let original_text = clipboard.read_text().unwrap_or_default();
    // No text on the clipboard may mean an image is there; keep it so it
    // can be put back.
    let original_image = if original_text.is_empty() {
        clipboard.read_image().ok()
    } else {
        None
    };

    // Empty the clipboard so "the app copied something" is observable even
    // when the selection equals what was already there.
    if let Err(e) = clipboard.clear() {
        warn!("Selection capture: could not clear clipboard: {}", e);
        return Selection::Unsupported;
    }

    let modifiers_released = wait_for_modifiers_released();

    let sent = send_copy_on_main_thread(app, !modifiers_released);
    let copied = sent && {
        let deadline = Instant::now() + COPY_TIMEOUT;
        loop {
            match clipboard.read_text() {
                Ok(text) if !text.is_empty() => break true,
                _ if Instant::now() >= deadline => break false,
                _ => std::thread::sleep(POLL_INTERVAL),
            }
        }
    };

    let captured = if copied {
        clipboard.read_text().unwrap_or_default()
    } else {
        String::new()
    };

    let restored = if !original_text.is_empty() {
        clipboard.write_text(original_text)
    } else if let Some(image) = original_image.as_ref() {
        clipboard.write_image(image)
    } else {
        clipboard.clear()
    };
    if let Err(e) = restored {
        warn!("Selection capture: could not restore clipboard: {}", e);
    }

    if !sent {
        // The keystroke never went out: that is not "nothing selected".
        return Selection::Unsupported;
    }
    selection_from_copied_text(&captured)
}

/// Waits for the user to let go of the hotkey. Returns `false` when they
/// are still holding a modifier (or when that cannot be checked here).
fn wait_for_modifiers_released() -> bool {
    #[cfg(target_os = "windows")]
    {
        crate::win_keys::wait_for_modifiers_released(MODIFIER_TIMEOUT)
    }
    #[cfg(not(target_os = "windows"))]
    {
        // No cheap way to read the physical key state: give the release a
        // moment and let `send_copy` clear Shift/Alt defensively.
        let _ = MODIFIER_TIMEOUT;
        std::thread::sleep(Duration::from_millis(80));
        false
    }
}

/// Classifies what came back from the copy shortcut.
fn selection_from_copied_text(text: &str) -> Selection {
    if text.trim().is_empty() {
        Selection::Empty
    } else {
        Selection::Text(text.to_string())
    }
}

/// Presses the copy shortcut on the main thread and waits for it to finish.
fn send_copy_on_main_thread(app: &AppHandle, release_stray_modifiers: bool) -> bool {
    let (tx, rx) = mpsc::channel::<bool>();
    let app_for_keys = app.clone();
    // Set when we stop waiting: a closure that runs late must not press
    // copy after the clipboard has already been restored.
    let abandoned = Arc::new(AtomicBool::new(false));
    let abandoned_in_closure = Arc::clone(&abandoned);

    let dispatched = app.run_on_main_thread(move || {
        if abandoned_in_closure.load(Ordering::SeqCst) {
            return;
        }
        let ok = match app_for_keys.try_state::<EnigoState>() {
            Some(state) => match state.0.lock() {
                Ok(mut enigo) => match input::send_copy(&mut enigo, release_stray_modifiers) {
                    Ok(()) => true,
                    Err(e) => {
                        warn!("Selection capture: {}", e);
                        false
                    }
                },
                Err(_) => false,
            },
            None => false,
        };
        let _ = tx.send(ok);
    });

    if dispatched.is_err() {
        return false;
    }
    match rx.recv_timeout(DISPATCH_TIMEOUT) {
        Ok(ok) => ok,
        Err(_) => {
            abandoned.store(true, Ordering::SeqCst);
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(process: &str) -> ActiveApp {
        ActiveApp {
            process: process.to_string(),
            title: None,
        }
    }

    #[test]
    fn copied_text_is_the_selection() {
        assert_eq!(
            selection_from_copied_text("hola mundo"),
            Selection::Text("hola mundo".to_string())
        );
    }

    #[test]
    fn selection_keeps_its_own_whitespace() {
        assert_eq!(
            selection_from_copied_text("  indented line\n"),
            Selection::Text("  indented line\n".to_string())
        );
    }

    #[test]
    fn nothing_or_only_whitespace_is_no_selection() {
        assert_eq!(selection_from_copied_text(""), Selection::Empty);
        assert_eq!(selection_from_copied_text(" \n\t"), Selection::Empty);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn on_windows_copy_is_simulated_only_in_known_apps_that_are_not_terminals() {
        assert!(copy_is_safe(Some(&app("chrome"))));
        assert!(copy_is_safe(Some(&app("winword"))));
        assert!(!copy_is_safe(Some(&app("windowsterminal"))));
        assert!(!copy_is_safe(Some(&app("powershell"))));
        assert!(!copy_is_safe(None));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn on_linux_copy_is_never_simulated() {
        assert!(!copy_is_safe(Some(&app("chrome"))));
        assert!(!copy_is_safe(None));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn on_macos_copy_is_always_simulated() {
        assert!(copy_is_safe(Some(&app("terminal"))));
        assert!(copy_is_safe(None));
    }
}
