//! Phase 11 (rescue): Foreground app detection.
//!
//! Used by the `transcribe_auto` binding to choose an LLM prompt based on
//! the application the user is currently typing into. Returns the active
//! window's process executable name, lowercased and stripped of the
//! `.exe` suffix (e.g. `"claude"`, `"outlook"`, `"whatsapp"`).
//!
//! Windows-only in this first cut. macOS/Linux callers get `None` and
//! the caller falls back to the default casual prompt.

#[cfg(target_os = "windows")]
pub fn active_process_name() -> Option<String> {
    use windows::Win32::Foundation::{CloseHandle, MAX_PATH};
    use windows::Win32::System::ProcessStatus::K32GetModuleBaseNameW;
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
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

        let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(h) => h,
            Err(_) => return None,
        };

        let mut buf = [0u16; MAX_PATH as usize];
        let len = K32GetModuleBaseNameW(handle, None, &mut buf);
        let _ = CloseHandle(handle);

        if len == 0 {
            return None;
        }

        let name = String::from_utf16_lossy(&buf[..len as usize]);
        let stripped = name
            .strip_suffix(".exe")
            .or_else(|| name.strip_suffix(".EXE"))
            .unwrap_or(&name);
        Some(stripped.to_lowercase())
    }
}

#[cfg(not(target_os = "windows"))]
pub fn active_process_name() -> Option<String> {
    // Not implemented on macOS/Linux yet. Callers fall back to default.
    None
}
