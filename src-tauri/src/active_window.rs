//! Foreground app detection.
//!
//! Tells the dictation pipeline where the text is going: which app, and on
//! Windows also the window title. It is used to pick a writing style per
//! app, to give the cleanup model a hint about tone and proper names, and
//! to break usage down by app in Insights.
//!
//! - Windows: process executable name (lowercased, no `.exe`) + window title.
//! - macOS: frontmost app name, lowercased. No title (that needs the
//!   Accessibility API).
//! - Linux: nothing; callers fall back to their defaults.

/// Longest window title handed to the model, in characters.
const MAX_TITLE_CHARS: usize = 120;

/// The app the user is typing into.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveApp {
    /// Lowercased app identifier: `"chrome"`, `"outlook"`, `"google chrome"`.
    pub process: String,
    /// Title of the foreground window, when the platform exposes it.
    pub title: Option<String>,
}

impl ActiveApp {
    /// A sentence for the cleanup model describing where the text goes.
    ///
    /// The title comes from other software, so it is flattened to one line,
    /// stripped of quotes and cut short before it reaches the prompt.
    pub fn context_note(&self) -> String {
        let title = self
            .title
            .as_deref()
            .map(sanitize_title)
            .filter(|title| !title.is_empty());

        let place = match title {
            Some(title) => format!(
                "en la app \"{}\", en la ventana \"{}\"",
                sanitize_title(&self.process),
                title
            ),
            None => format!("en la app \"{}\"", sanitize_title(&self.process)),
        };

        format!(
            "Contexto (no lo menciones ni lo copies en la respuesta): el usuario está escribiendo {}. Usalo solo para ajustar el tono y para escribir bien los nombres propios que aparezcan ahí.",
            place
        )
    }
}

/// One line, no quotes, at most `MAX_TITLE_CHARS` characters.
fn sanitize_title(raw: &str) -> String {
    let flat: String = raw
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .filter(|c| *c != '"')
        .collect();
    let collapsed = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(MAX_TITLE_CHARS).collect()
}

/// Extracts the app name from `lsappinfo info -only name <asn>` output,
/// which looks like `"LSDisplayName"="Google Chrome"`.
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn parse_lsappinfo_name(output: &str) -> Option<String> {
    let (_, value) = output.trim().split_once('=')?;
    let name = value.trim().trim_matches('"').trim();
    if name.is_empty() || name == "[ NULL ]" {
        None
    } else {
        Some(name.to_lowercase())
    }
}

/// File name of an executable path, lowercased and without `.exe`:
/// `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe` → `chrome`.
#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
fn process_name_from_path(path: &str) -> Option<String> {
    let file = path.rsplit(['\\', '/']).next()?.trim();
    let lower = file.to_lowercase();
    let name = lower.strip_suffix(".exe").unwrap_or(&lower);
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

#[cfg(target_os = "windows")]
pub fn active_app() -> Option<ActiveApp> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }

        let mut pid: u32 = 0;
        let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }

        // QueryFullProcessImageNameW is the call that works with the
        // "limited information" right, which is all that is granted for
        // elevated or protected processes. (GetModuleBaseName needs
        // PROCESS_VM_READ and fails on those.)
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut path_buf = [0u16; 1024];
        let mut path_len = path_buf.len() as u32;
        let queried = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(path_buf.as_mut_ptr()),
            &mut path_len,
        );
        let _ = CloseHandle(handle);
        queried.ok()?;

        let path = String::from_utf16_lossy(&path_buf[..path_len as usize]);
        let process = process_name_from_path(&path)?;

        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, &mut title_buf);
        let title = if title_len > 0 {
            Some(String::from_utf16_lossy(&title_buf[..title_len as usize]))
        } else {
            None
        };

        Some(ActiveApp { process, title })
    }
}

#[cfg(target_os = "macos")]
pub fn active_app() -> Option<ActiveApp> {
    use std::process::Command;
    use std::sync::mpsc;
    use std::time::Duration;

    // `lsappinfo` ships with macOS and needs no permission prompt. It runs
    // on its own thread with a deadline: this is called on every key
    // release, and a hung helper must not freeze the hotkeys.
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let name = (|| {
            let front = Command::new("lsappinfo").arg("front").output().ok()?;
            let asn = String::from_utf8_lossy(&front.stdout).trim().to_string();
            if asn.is_empty() {
                return None;
            }
            let info = Command::new("lsappinfo")
                .args(["info", "-only", "name", &asn])
                .output()
                .ok()?;
            parse_lsappinfo_name(&String::from_utf8_lossy(&info.stdout))
        })();
        let _ = tx.send(name);
    });

    let process = rx.recv_timeout(Duration::from_millis(400)).ok()??;
    Some(ActiveApp {
        process,
        title: None,
    })
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn active_app() -> Option<ActiveApp> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_names_the_app_and_the_window() {
        let app = ActiveApp {
            process: "whatsapp".to_string(),
            title: Some("Juan Pérez".to_string()),
        };
        let note = app.context_note();
        assert!(note.contains("en la app \"whatsapp\""));
        assert!(note.contains("en la ventana \"Juan Pérez\""));
    }

    #[test]
    fn note_without_a_title_names_only_the_app() {
        let app = ActiveApp {
            process: "google chrome".to_string(),
            title: None,
        };
        let note = app.context_note();
        assert!(note.contains("en la app \"google chrome\""));
        assert!(!note.contains("ventana"));
    }

    #[test]
    fn a_blank_title_is_treated_as_missing() {
        let app = ActiveApp {
            process: "code".to_string(),
            title: Some("  \n ".to_string()),
        };
        assert!(!app.context_note().contains("ventana"));
    }

    #[test]
    fn titles_are_flattened_unquoted_and_cut_short() {
        let long = format!("Re: \"oferta\"\nlínea dos\t{}", "x".repeat(300));
        let clean = sanitize_title(&long);
        assert!(clean.starts_with("Re: oferta línea dos x"));
        assert!(!clean.contains('"'));
        assert!(!clean.contains('\n'));
        assert_eq!(clean.chars().count(), MAX_TITLE_CHARS);
    }

    #[test]
    fn process_name_is_the_file_name_lowercased_without_exe() {
        assert_eq!(
            process_name_from_path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
            Some("chrome".to_string())
        );
        assert_eq!(
            process_name_from_path(r"C:\Windows\System32\WindowsTerminal.EXE"),
            Some("windowsterminal".to_string())
        );
        assert_eq!(
            process_name_from_path("notepad++.exe"),
            Some("notepad++".to_string())
        );
        assert_eq!(process_name_from_path(""), None);
    }

    #[test]
    fn lsappinfo_output_gives_the_lowercased_app_name() {
        assert_eq!(
            parse_lsappinfo_name("\"LSDisplayName\"=\"Google Chrome\"\n"),
            Some("google chrome".to_string())
        );
    }

    #[test]
    fn lsappinfo_without_a_name_gives_nothing() {
        assert_eq!(parse_lsappinfo_name(""), None);
        assert_eq!(parse_lsappinfo_name("\"LSDisplayName\"=[ NULL ]"), None);
        assert_eq!(parse_lsappinfo_name("garbage"), None);
    }
}
