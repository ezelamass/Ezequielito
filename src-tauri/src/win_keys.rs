//! Windows-only: physical state of the modifier keys.
//!
//! Kept free of Tauri types so this file can be type-checked on its own
//! against the `windows` crate.

use std::time::{Duration, Instant};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
};

/// True while any of Ctrl, Shift, Alt or Win is physically held down.
pub fn any_modifier_down() -> bool {
    [VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN]
        .iter()
        // The high bit of GetAsyncKeyState is "down right now".
        .any(|key| unsafe { GetAsyncKeyState(key.0 as i32) } < 0)
}

/// Waits until no modifier is held, up to `timeout`. Returns whether they
/// were all released in time.
pub fn wait_for_modifiers_released(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while any_modifier_down() {
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    true
}
