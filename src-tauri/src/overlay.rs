use crate::input;
use crate::settings;
use crate::settings::OverlayPosition;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};

#[cfg(not(target_os = "macos"))]
use log::debug;

#[cfg(not(target_os = "macos"))]
use tauri::WebviewWindowBuilder;

#[cfg(target_os = "macos")]
use tauri::WebviewUrl;

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelBuilder, PanelLevel};

#[cfg(target_os = "linux")]
use gtk_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};

#[cfg(target_os = "linux")]
use std::env;

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(RecordingOverlayPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

// Phase 10 rescue: pill is now ~250px wide and the lock badge floats
// ~6px below it, so the window needs ~64px of vertical room.
const OVERLAY_WIDTH: f64 = 280.0;
const OVERLAY_HEIGHT: f64 = 64.0;

// Idle pill: the window shrinks to the hover target so the transparent
// area around it does not swallow clicks meant for the app underneath.
const OVERLAY_IDLE_WIDTH: f64 = 140.0;
const OVERLAY_IDLE_HEIGHT: f64 = 34.0;

/// How long an error stays on the pill before it returns to idle/hidden.
const OVERLAY_ERROR_MS: u64 = 2600;

/// Time the webview gets to play its fade-out before the window is
/// shrunk (idle pill) or hidden.
const OVERLAY_SETTLE_MS: u64 = 300;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OverlaySize {
    Idle,
    Active,
}

impl OverlaySize {
    fn dimensions(self) -> (f64, f64) {
        match self {
            OverlaySize::Idle => (OVERLAY_IDLE_WIDTH, OVERLAY_IDLE_HEIGHT),
            OverlaySize::Active => (OVERLAY_WIDTH, OVERLAY_HEIGHT),
        }
    }
}

/// Machine-readable reasons shown on the pill; the overlay maps each to a
/// translated message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OverlayError {
    MicDenied,
    NoMic,
    NoSpeech,
    TranscriptionFailed,
    PasteFailed,
    CommandNotFound,
    NoSelection,
    AiNotConfigured,
    AiFailed,
    Generic,
}

impl OverlayError {
    pub fn code(self) -> &'static str {
        match self {
            OverlayError::MicDenied => "mic_denied",
            OverlayError::NoMic => "no_mic",
            OverlayError::NoSpeech => "no_speech",
            OverlayError::TranscriptionFailed => "transcription_failed",
            OverlayError::PasteFailed => "paste_failed",
            OverlayError::CommandNotFound => "command_not_found",
            OverlayError::NoSelection => "no_selection",
            OverlayError::AiNotConfigured => "ai_not_configured",
            OverlayError::AiFailed => "ai_failed",
            OverlayError::Generic => "generic",
        }
    }
}

#[cfg(target_os = "macos")]
const OVERLAY_TOP_OFFSET: f64 = 46.0;
#[cfg(any(target_os = "windows", target_os = "linux"))]
const OVERLAY_TOP_OFFSET: f64 = 4.0;

#[cfg(target_os = "macos")]
const OVERLAY_BOTTOM_OFFSET: f64 = 15.0;

#[cfg(any(target_os = "windows", target_os = "linux"))]
const OVERLAY_BOTTOM_OFFSET: f64 = 40.0;

#[cfg(target_os = "linux")]
fn update_gtk_layer_shell_anchors(overlay_window: &tauri::webview::WebviewWindow) {
    let window_clone = overlay_window.clone();
    let _ = overlay_window.run_on_main_thread(move || {
        // Try to get the GTK window from the Tauri webview
        if let Ok(gtk_window) = window_clone.gtk_window() {
            let settings = settings::get_settings(window_clone.app_handle());
            match settings.overlay_position {
                OverlayPosition::Top => {
                    gtk_window.set_anchor(Edge::Top, true);
                    gtk_window.set_anchor(Edge::Bottom, false);
                }
                OverlayPosition::Bottom | OverlayPosition::None => {
                    gtk_window.set_anchor(Edge::Bottom, true);
                    gtk_window.set_anchor(Edge::Top, false);
                }
            }
        }
    });
}

/// Returns true when the environment variable is set to a truthy value
/// (e.g. "1", "true", "yes", "on").
/// "0", "false", "no", "off" and empty string are treated as falsy (case-insensitive).
/// Returns false when the variable is not set.
#[cfg(target_os = "linux")]
fn env_flag_enabled(name: &str) -> bool {
    match env::var(name) {
        Ok(v) => !matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "" | "0" | "false" | "no" | "off"
        ),
        Err(_) => false,
    }
}

/// Initializes GTK layer shell for Linux overlay window
/// Returns true if layer shell was successfully initialized, false otherwise
#[cfg(target_os = "linux")]
fn init_gtk_layer_shell(overlay_window: &tauri::webview::WebviewWindow) -> bool {
    if env_flag_enabled("HANDY_NO_GTK_LAYER_SHELL") {
        debug!("Skipping GTK layer shell init (HANDY_NO_GTK_LAYER_SHELL is enabled)");
        return false;
    }

    if !gtk_layer_shell::is_supported() {
        return false;
    }

    // Try to get the GTK window from the Tauri webview
    if let Ok(gtk_window) = overlay_window.gtk_window() {
        // Initialize layer shell
        gtk_window.init_layer_shell();
        gtk_window.set_layer(Layer::Overlay);
        gtk_window.set_keyboard_mode(KeyboardMode::None);
        gtk_window.set_exclusive_zone(0);

        update_gtk_layer_shell_anchors(overlay_window);

        return true;
    }
    false
}

/// Forces a window to be topmost using Win32 API (Windows only)
/// This is more reliable than Tauri's set_always_on_top which can be overridden
#[cfg(target_os = "windows")]
fn force_overlay_topmost(overlay_window: &tauri::webview::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };

    // Clone because run_on_main_thread takes 'static
    let overlay_clone = overlay_window.clone();

    // Make sure the Win32 call happens on the UI thread
    let _ = overlay_clone.clone().run_on_main_thread(move || {
        if let Ok(hwnd) = overlay_clone.hwnd() {
            unsafe {
                // Force Z-order: make this window topmost without changing size/pos or stealing focus
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
            }
        }
    });
}

fn get_monitor_with_cursor(app_handle: &AppHandle) -> Option<tauri::Monitor> {
    if let Some(mouse_location) = input::get_cursor_position(app_handle) {
        if let Ok(monitors) = app_handle.available_monitors() {
            for monitor in monitors {
                // Tauri's monitor position/size are physical pixels, but enigo
                // may return logical coordinates (confirmed on macOS via
                // NSEvent::mouseLocation; on Windows, GetCursorPos behavior
                // depends on the process DPI-awareness context). Dividing by
                // scale_factor normalizes to logical, which is safe regardless:
                // if enigo returns logical it matches directly, and if it returns
                // physical on a scale=1 monitor the division is a no-op.
                let scale = monitor.scale_factor();
                let pos = PhysicalPosition::new(
                    (monitor.position().x as f64 / scale) as i32,
                    (monitor.position().y as f64 / scale) as i32,
                );
                let size = PhysicalSize::new(
                    (monitor.size().width as f64 / scale) as u32,
                    (monitor.size().height as f64 / scale) as u32,
                );
                if is_mouse_within_monitor(mouse_location, &pos, &size) {
                    return Some(monitor);
                }
            }
        }
    }

    app_handle.primary_monitor().ok().flatten()
}

fn is_mouse_within_monitor(
    mouse_pos: (i32, i32),
    monitor_pos: &PhysicalPosition<i32>,
    monitor_size: &PhysicalSize<u32>,
) -> bool {
    let (mouse_x, mouse_y) = mouse_pos;
    let PhysicalPosition {
        x: monitor_x,
        y: monitor_y,
    } = *monitor_pos;
    let PhysicalSize {
        width: monitor_width,
        height: monitor_height,
    } = *monitor_size;

    mouse_x >= monitor_x
        && mouse_x < (monitor_x + monitor_width as i32)
        && mouse_y >= monitor_y
        && mouse_y < (monitor_y + monitor_height as i32)
}

/// Returns overlay position in logical coordinates (points on macOS).
///
/// Uses monitor position/size directly rather than work_area(), which can
/// return incorrect coordinates on macOS for monitors with negative positions.
/// The per-platform OVERLAY_TOP_OFFSET / OVERLAY_BOTTOM_OFFSET constants
/// already account for system chrome (menu bar, taskbar).
///
/// We must use LogicalPosition (not PhysicalPosition) because Tauri/tao
/// converts PhysicalPosition using the scale factor of the monitor the window
/// is *currently* on, which is wrong when moving cross-monitor.
fn calculate_overlay_position(app_handle: &AppHandle, size: OverlaySize) -> Option<(f64, f64)> {
    let (width, height) = size.dimensions();
    let monitor = get_monitor_with_cursor(app_handle)?;
    let scale = monitor.scale_factor();
    let monitor_x = monitor.position().x as f64 / scale;
    let monitor_y = monitor.position().y as f64 / scale;
    let monitor_width = monitor.size().width as f64 / scale;
    let monitor_height = monitor.size().height as f64 / scale;

    let settings = settings::get_settings(app_handle);

    let x = monitor_x + (monitor_width - width) / 2.0;
    let y = match settings.overlay_position {
        OverlayPosition::Top => monitor_y + OVERLAY_TOP_OFFSET,
        OverlayPosition::Bottom | OverlayPosition::None => {
            monitor_y + monitor_height - height - OVERLAY_BOTTOM_OFFSET
        }
    };

    Some((x, y))
}

/// Creates the recording overlay window and keeps it hidden by default
#[cfg(not(target_os = "macos"))]
pub fn create_recording_overlay(app_handle: &AppHandle) {
    // On Linux (Wayland), monitor detection often fails, but we don't need exact coordinates
    // for Layer Shell as we use anchors. On other platforms, we require a monitor.
    #[cfg(not(target_os = "linux"))]
    {
        let position = calculate_overlay_position(app_handle, OverlaySize::Active);
        if position.is_none() {
            debug!("Failed to determine overlay position, not creating overlay window");
            return;
        }
    }

    // Position starts unset — update_overlay_position() sets the correct
    // LogicalPosition before the overlay is shown.
    let mut builder = WebviewWindowBuilder::new(
        app_handle,
        "recording_overlay",
        tauri::WebviewUrl::App("src/overlay/index.html".into()),
    )
    .title("Recording")
    .resizable(false)
    .inner_size(OVERLAY_WIDTH, OVERLAY_HEIGHT)
    .shadow(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .accept_first_mouse(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .transparent(true)
    .focused(false)
    .visible(false);

    // A click on the pill must not take keyboard focus away from the app the
    // text is going to be pasted into. The window system keeps this as a
    // window flag (WS_EX_NOACTIVATE), so it survives every show/hide.
    #[cfg(target_os = "windows")]
    {
        builder = builder.focusable(false);
    }

    if let Some(data_dir) = crate::portable::data_dir() {
        builder = builder.data_directory(data_dir.join("webview"));
    }

    #[allow(unused_variables)]
    match builder.build() {
        Ok(window) => {
            #[cfg(target_os = "linux")]
            {
                // Try to initialize GTK layer shell, ignore errors if compositor doesn't support it
                if init_gtk_layer_shell(&window) {
                    debug!("GTK layer shell initialized for overlay window");
                } else {
                    debug!("GTK layer shell not available, falling back to regular window");
                }
            }

            debug!("Recording overlay window created successfully (hidden)");
        }
        Err(e) => {
            debug!("Failed to create recording overlay window: {}", e);
        }
    }
}

/// Creates the recording overlay panel and keeps it hidden by default (macOS)
#[cfg(target_os = "macos")]
pub fn create_recording_overlay(app_handle: &AppHandle) {
    if let Some((x, y)) = calculate_overlay_position(app_handle, OverlaySize::Active) {
        // PanelBuilder creates a Tauri window then converts it to NSPanel.
        // The window remains registered, so get_webview_window() still works.
        match PanelBuilder::<_, RecordingOverlayPanel>::new(app_handle, "recording_overlay")
            .url(WebviewUrl::App("src/overlay/index.html".into()))
            .title("Recording")
            .position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
            .level(PanelLevel::Status)
            .size(tauri::Size::Logical(tauri::LogicalSize {
                width: OVERLAY_WIDTH,
                height: OVERLAY_HEIGHT,
            }))
            .has_shadow(false)
            .transparent(true)
            .no_activate(true)
            .corner_radius(0.0)
            .with_window(|w| w.decorations(false).transparent(true))
            .collection_behavior(
                CollectionBehavior::new()
                    .can_join_all_spaces()
                    .full_screen_auxiliary(),
            )
            .build()
        {
            Ok(panel) => {
                let _ = panel.hide();
            }
            Err(e) => {
                log::error!("Failed to create recording overlay panel: {}", e);
            }
        }
    }
}

/// Resizes and repositions the overlay window for the given size.
fn apply_overlay_geometry(app_handle: &AppHandle, size: OverlaySize) {
    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        #[cfg(target_os = "linux")]
        {
            update_gtk_layer_shell_anchors(&overlay_window);
        }

        let (width, height) = size.dimensions();
        let _ = overlay_window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));

        if let Some((x, y)) = calculate_overlay_position(app_handle, size) {
            let _ = overlay_window
                .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
        }
    }
}

// ---------------------------------------------------------------------------
// Pill state machine
//
// Every overlay transition goes through one thread (`overlay_tx`), so a
// delayed step (shrink after the fade-out, dismissing an error) can never
// land on top of a newer state. The decisions live in `Pill::step`, which
// is pure: it takes an input plus the relevant settings and returns the
// effects to perform and the timer to arm.
// ---------------------------------------------------------------------------

/// What the settings currently allow.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PillEnv {
    /// Overlay position is not "None".
    overlay_on: bool,
    /// "Always-visible pill" is enabled.
    idle_pill: bool,
}

impl PillEnv {
    fn shows_idle(self) -> bool {
        self.overlay_on && self.idle_pill
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PillInput {
    /// A live state: "recording" | "transcribing" | "processing".
    Show(&'static str),
    /// A failure to show briefly.
    Error(OverlayError),
    /// The live state ended; go back to rest.
    Settle,
    /// Settings changed or the webview just loaded; re-apply the rest state.
    Refresh,
    /// The armed timer elapsed.
    TimerFired,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PillTimer {
    /// The fade-out finished: shrink to the idle pill, or hide the window.
    FinishSettle { idle: bool },
    /// The error has been on screen long enough.
    DismissError,
}

impl PillTimer {
    fn delay(self) -> Duration {
        match self {
            PillTimer::FinishSettle { .. } => Duration::from_millis(OVERLAY_SETTLE_MS),
            PillTimer::DismissError => Duration::from_millis(OVERLAY_ERROR_MS),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PillEffect {
    Resize(OverlaySize),
    ShowWindow,
    HideWindow,
    /// `show-overlay` with this state.
    EmitState(&'static str),
    /// `overlay-error` with this code.
    EmitError(&'static str),
    /// `hide-overlay`.
    EmitHide,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct Pill {
    /// A live state (recording / transcribing / processing / error) is on
    /// screen, as opposed to resting (idle pill or hidden).
    active: bool,
    timer: Option<PillTimer>,
    /// Counts every time a timer is armed, so the thread can tell "a new
    /// timer of the same kind" from "the old one is still pending".
    armed: u64,
}

impl Pill {
    fn step(&mut self, input: PillInput, env: PillEnv) -> Vec<PillEffect> {
        match input {
            PillInput::Show(state) => {
                if !env.overlay_on {
                    return Vec::new();
                }
                self.active = true;
                self.timer = None;
                vec![
                    PillEffect::Resize(OverlaySize::Active),
                    PillEffect::ShowWindow,
                    PillEffect::EmitState(state),
                ]
            }
            PillInput::Error(error) => {
                if !env.overlay_on {
                    // Nothing to show the error on; still leave the live state.
                    return self.settle(env);
                }
                self.active = true;
                self.arm(PillTimer::DismissError);
                vec![
                    PillEffect::Resize(OverlaySize::Active),
                    PillEffect::ShowWindow,
                    PillEffect::EmitError(error.code()),
                    PillEffect::EmitState("error"),
                ]
            }
            PillInput::Settle => self.settle(env),
            PillInput::Refresh => {
                if self.active {
                    // Only the position can have changed; keep the state.
                    return if env.overlay_on {
                        vec![PillEffect::Resize(OverlaySize::Active)]
                    } else {
                        Vec::new()
                    };
                }
                self.timer = None;
                if env.shows_idle() {
                    vec![
                        PillEffect::Resize(OverlaySize::Idle),
                        PillEffect::ShowWindow,
                        PillEffect::EmitState("idle"),
                    ]
                } else {
                    vec![PillEffect::EmitHide, PillEffect::HideWindow]
                }
            }
            PillInput::TimerFired => match self.timer.take() {
                Some(PillTimer::FinishSettle { idle: true }) => {
                    vec![PillEffect::Resize(OverlaySize::Idle)]
                }
                Some(PillTimer::FinishSettle { idle: false }) => vec![PillEffect::HideWindow],
                Some(PillTimer::DismissError) => self.settle(env),
                None => Vec::new(),
            },
        }
    }

    fn arm(&mut self, timer: PillTimer) {
        self.timer = Some(timer);
        self.armed += 1;
    }

    /// Leaves the live state. The webview is told first so its animation
    /// runs; the window itself is resized or hidden when the timer fires.
    fn settle(&mut self, env: PillEnv) -> Vec<PillEffect> {
        self.active = false;
        let idle = env.shows_idle();
        self.arm(PillTimer::FinishSettle { idle });
        if idle {
            vec![PillEffect::EmitState("idle")]
        } else {
            vec![PillEffect::EmitHide]
        }
    }
}

fn pill_env(app_handle: &AppHandle) -> PillEnv {
    let settings = settings::get_settings(app_handle);
    PillEnv {
        overlay_on: settings.overlay_position != OverlayPosition::None,
        idle_pill: settings.overlay_idle_pill,
    }
}

fn perform(app_handle: &AppHandle, effect: PillEffect) {
    let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") else {
        return;
    };
    match effect {
        PillEffect::Resize(size) => apply_overlay_geometry(app_handle, size),
        PillEffect::ShowWindow => {
            let _ = overlay_window.show();
            // On Windows, aggressively re-assert "topmost" in the native Z-order after showing
            #[cfg(target_os = "windows")]
            force_overlay_topmost(&overlay_window);
        }
        PillEffect::HideWindow => {
            let _ = overlay_window.hide();
        }
        PillEffect::EmitState(state) => {
            let _ = overlay_window.emit("show-overlay", state);
        }
        PillEffect::EmitError(code) => {
            let _ = overlay_window.emit("overlay-error", code);
        }
        PillEffect::EmitHide => {
            let _ = overlay_window.emit("hide-overlay", ());
        }
    }
}

static OVERLAY_TX: OnceLock<Sender<PillInput>> = OnceLock::new();

/// Sender to the pill thread, started on first use.
fn overlay_tx(app_handle: &AppHandle) -> &'static Sender<PillInput> {
    OVERLAY_TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<PillInput>();
        let app = app_handle.clone();
        std::thread::spawn(move || {
            let mut pill = Pill::default();
            let mut deadline: Option<Instant> = None;
            loop {
                let input = match deadline {
                    Some(at) => {
                        match rx.recv_timeout(at.saturating_duration_since(Instant::now())) {
                            Ok(input) => input,
                            Err(RecvTimeoutError::Timeout) => PillInput::TimerFired,
                            Err(RecvTimeoutError::Disconnected) => break,
                        }
                    }
                    None => match rx.recv() {
                        Ok(input) => input,
                        Err(_) => break,
                    },
                };

                let armed_before = pill.armed;
                for effect in pill.step(input, pill_env(&app)) {
                    perform(&app, effect);
                }
                // Start the clock only for a timer armed by this step; one
                // left pending by an unrelated input keeps its deadline.
                match pill.timer {
                    None => deadline = None,
                    Some(timer) if pill.armed != armed_before => {
                        deadline = Some(Instant::now() + timer.delay());
                    }
                    Some(_) => {}
                }
            }
        });
        tx
    })
}

fn send_pill(app_handle: &AppHandle, input: PillInput) {
    if overlay_tx(app_handle).send(input).is_err() {
        log::warn!("Overlay thread is gone; dropping {:?}", input);
    }
}

/// Shows the recording overlay window with fade-in animation
pub fn show_recording_overlay(app_handle: &AppHandle) {
    send_pill(app_handle, PillInput::Show("recording"));
}

/// Shows the transcribing overlay window
pub fn show_transcribing_overlay(app_handle: &AppHandle) {
    send_pill(app_handle, PillInput::Show("transcribing"));
}

/// Shows the processing overlay window
pub fn show_processing_overlay(app_handle: &AppHandle) {
    send_pill(app_handle, PillInput::Show("processing"));
}

/// Shows a short error on the pill, then returns to idle (or hides).
///
/// Call this instead of `hide_recording_overlay` on a failure path. With the
/// overlay disabled it just ends the live state; the existing events
/// (`recording-error`, `paste-error`) still reach the main window.
pub fn show_error_overlay(app_handle: &AppHandle, error: OverlayError) {
    send_pill(app_handle, PillInput::Error(error));
}

/// Re-applies the overlay position after the setting changed.
pub fn update_overlay_position(app_handle: &AppHandle) {
    send_pill(app_handle, PillInput::Refresh);
}

/// Puts the overlay in its resting state: the idle pill when the setting is
/// on, hidden otherwise. While a live state is showing it only repositions.
pub fn refresh_idle_overlay(app_handle: &AppHandle) {
    send_pill(app_handle, PillInput::Refresh);
}

/// Ends the live state: back to the idle pill, or hidden when it is off.
pub fn hide_recording_overlay(app_handle: &AppHandle) {
    send_pill(app_handle, PillInput::Settle);
}

pub fn emit_levels(app_handle: &AppHandle, levels: &Vec<f32>) {
    // emit levels to main app
    let _ = app_handle.emit("mic-level", levels);

    // also emit to the recording overlay if it's open
    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        let _ = overlay_window.emit("mic-level", levels);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ON: PillEnv = PillEnv {
        overlay_on: true,
        idle_pill: true,
    };
    const NO_IDLE: PillEnv = PillEnv {
        overlay_on: true,
        idle_pill: false,
    };
    const OFF: PillEnv = PillEnv {
        overlay_on: false,
        idle_pill: true,
    };

    #[test]
    fn recording_grows_the_window_before_announcing_the_state() {
        let mut pill = Pill::default();
        assert_eq!(
            pill.step(PillInput::Show("recording"), ON),
            vec![
                PillEffect::Resize(OverlaySize::Active),
                PillEffect::ShowWindow,
                PillEffect::EmitState("recording"),
            ]
        );
        assert!(pill.active);
        assert_eq!(pill.timer, None);
    }

    #[test]
    fn settling_with_the_idle_pill_shrinks_only_after_the_fade() {
        let mut pill = Pill::default();
        pill.step(PillInput::Show("recording"), ON);

        assert_eq!(
            pill.step(PillInput::Settle, ON),
            vec![PillEffect::EmitState("idle")]
        );
        assert!(!pill.active);
        assert_eq!(pill.timer, Some(PillTimer::FinishSettle { idle: true }));

        assert_eq!(
            pill.step(PillInput::TimerFired, ON),
            vec![PillEffect::Resize(OverlaySize::Idle)]
        );
        assert_eq!(pill.timer, None);
    }

    #[test]
    fn settling_without_the_idle_pill_hides_the_window() {
        let mut pill = Pill::default();
        pill.step(PillInput::Show("recording"), NO_IDLE);

        assert_eq!(
            pill.step(PillInput::Settle, NO_IDLE),
            vec![PillEffect::EmitHide]
        );
        assert_eq!(
            pill.step(PillInput::TimerFired, NO_IDLE),
            vec![PillEffect::HideWindow]
        );
    }

    #[test]
    fn a_new_recording_cancels_the_pending_shrink() {
        let mut pill = Pill::default();
        pill.step(PillInput::Show("recording"), ON);
        pill.step(PillInput::Settle, ON);

        pill.step(PillInput::Show("recording"), ON);
        assert_eq!(pill.timer, None);
        // A late timer must not touch the live recording.
        assert_eq!(pill.step(PillInput::TimerFired, ON), Vec::new());
        assert!(pill.active);
    }

    #[test]
    fn an_error_shows_then_dismisses_itself_back_to_idle() {
        let mut pill = Pill::default();
        assert_eq!(
            pill.step(PillInput::Error(OverlayError::NoSpeech), ON),
            vec![
                PillEffect::Resize(OverlaySize::Active),
                PillEffect::ShowWindow,
                PillEffect::EmitError("no_speech"),
                PillEffect::EmitState("error"),
            ]
        );
        assert_eq!(pill.timer, Some(PillTimer::DismissError));

        assert_eq!(
            pill.step(PillInput::TimerFired, ON),
            vec![PillEffect::EmitState("idle")]
        );
        assert_eq!(pill.timer, Some(PillTimer::FinishSettle { idle: true }));
    }

    #[test]
    fn a_new_recording_cancels_the_error_dismissal() {
        let mut pill = Pill::default();
        pill.step(PillInput::Error(OverlayError::PasteFailed), ON);
        pill.step(PillInput::Show("recording"), ON);

        assert_eq!(pill.step(PillInput::TimerFired, ON), Vec::new());
        assert!(pill.active);
    }

    #[test]
    fn an_error_with_the_overlay_turned_off_still_leaves_the_live_state() {
        // Overlay was on when recording started, then set to "None".
        let mut pill = Pill::default();
        pill.step(PillInput::Show("recording"), ON);

        assert_eq!(
            pill.step(PillInput::Error(OverlayError::NoSpeech), OFF),
            vec![PillEffect::EmitHide]
        );
        assert!(!pill.active);
        assert_eq!(
            pill.step(PillInput::TimerFired, OFF),
            vec![PillEffect::HideWindow]
        );
    }

    #[test]
    fn nothing_is_shown_while_the_overlay_is_off() {
        let mut pill = Pill::default();
        assert_eq!(pill.step(PillInput::Show("recording"), OFF), Vec::new());
        assert!(!pill.active);
        assert_eq!(
            pill.step(PillInput::Refresh, OFF),
            vec![PillEffect::EmitHide, PillEffect::HideWindow]
        );
    }

    #[test]
    fn refresh_at_rest_applies_the_idle_pill_setting() {
        let mut pill = Pill::default();
        assert_eq!(
            pill.step(PillInput::Refresh, ON),
            vec![
                PillEffect::Resize(OverlaySize::Idle),
                PillEffect::ShowWindow,
                PillEffect::EmitState("idle"),
            ]
        );
        assert_eq!(
            pill.step(PillInput::Refresh, NO_IDLE),
            vec![PillEffect::EmitHide, PillEffect::HideWindow]
        );
    }

    #[test]
    fn refresh_at_rest_cancels_a_pending_hide() {
        // Dictation ended with the pill off, then the user turned it on
        // before the delayed hide ran.
        let mut pill = Pill::default();
        pill.step(PillInput::Show("recording"), NO_IDLE);
        pill.step(PillInput::Settle, NO_IDLE);

        pill.step(PillInput::Refresh, ON);
        assert_eq!(pill.timer, None);
        assert_eq!(pill.step(PillInput::TimerFired, ON), Vec::new());
    }

    #[test]
    fn refresh_while_recording_only_repositions() {
        let mut pill = Pill::default();
        pill.step(PillInput::Show("recording"), ON);

        assert_eq!(
            pill.step(PillInput::Refresh, ON),
            vec![PillEffect::Resize(OverlaySize::Active)]
        );
        assert!(pill.active);
    }
}
