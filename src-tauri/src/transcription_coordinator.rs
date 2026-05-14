use crate::actions::ACTION_MAP;
use crate::managers::audio::AudioRecordingManager;
use log::{debug, error, warn};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const DEBOUNCE: Duration = Duration::from_millis(30);

/// Commands processed sequentially by the coordinator thread.
enum Command {
    Input {
        binding_id: String,
        hotkey_string: String,
        is_pressed: bool,
        push_to_talk: bool,
    },
    Cancel {
        recording_was_active: bool,
    },
    ProcessingFinished,
    /// Phase 6: Space tapped mid-recording. First tap = lock the recording
    /// (skip the next PTT release); second tap = stop the recording.
    ToggleHandsFree,
}

/// Pipeline lifecycle, owned exclusively by the coordinator thread.
enum Stage {
    Idle,
    Recording(String), // binding_id
    Processing,
}

/// Serialises all transcription lifecycle events through a single thread
/// to eliminate race conditions between keyboard shortcuts, signals, and
/// the async transcribe-paste pipeline.
pub struct TranscriptionCoordinator {
    tx: Sender<Command>,
}

pub fn is_transcribe_binding(id: &str) -> bool {
    // Phase 5: casual / formal / code are full transcribe bindings, just
    // with a forced prompt id.
    // Phase 7: voice_command shares the record→transcribe pipeline; the
    // difference is that the resulting text triggers an app launcher
    // instead of paste (see TranscribeAction::stop in actions.rs).
    // Phase 8: transcribe_edit also shares the pipeline; the difference is
    // that the resulting text is treated as an LLM instruction applied to
    // the clipboard selection, and the rewritten text is pasted.
    matches!(
        id,
        "transcribe"
            | "transcribe_with_post_process"
            | "transcribe_casual"
            | "transcribe_formal"
            | "transcribe_code"
            | "transcribe_auto"
            | "transcribe_edit"
            | "voice_command"
    )
}

impl TranscriptionCoordinator {
    pub fn new(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel();

        thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let mut stage = Stage::Idle;
                let mut last_press: Option<Instant> = None;
                // Phase 6: while true, PTT release events are ignored. Set by Space
                // tap, cleared when recording actually stops (Stage transitions
                // back to Idle via Cancel/ProcessingFinished or explicit stop).
                let mut hands_free_locked = false;

                while let Ok(cmd) = rx.recv() {
                    match cmd {
                        Command::Input {
                            binding_id,
                            hotkey_string,
                            is_pressed,
                            push_to_talk,
                        } => {
                            // Debounce rapid-fire press events (key repeat / double-tap).
                            // Releases always pass through for push-to-talk.
                            if is_pressed {
                                let now = Instant::now();
                                if last_press.map_or(false, |t| now.duration_since(t) < DEBOUNCE) {
                                    debug!("Debounced press for '{binding_id}'");
                                    continue;
                                }
                                last_press = Some(now);
                            }

                            if push_to_talk {
                                if is_pressed && matches!(stage, Stage::Idle) {
                                    start(&app, &mut stage, &binding_id, &hotkey_string);
                                } else if !is_pressed
                                    && matches!(&stage, Stage::Recording(id) if id == &binding_id)
                                {
                                    // Phase 6: if Space-lock is engaged, ignore the
                                    // PTT release. Recording continues until Space
                                    // is tapped again.
                                    if hands_free_locked {
                                        debug!("PTT release ignored — hands-free locked");
                                    } else {
                                        stop(&app, &mut stage, &binding_id, &hotkey_string);
                                    }
                                }
                            } else if is_pressed {
                                match &stage {
                                    Stage::Idle => {
                                        start(&app, &mut stage, &binding_id, &hotkey_string);
                                    }
                                    Stage::Recording(id) if id == &binding_id => {
                                        stop(&app, &mut stage, &binding_id, &hotkey_string);
                                    }
                                    _ => {
                                        debug!("Ignoring press for '{binding_id}': pipeline busy")
                                    }
                                }
                            }
                        }
                        Command::Cancel {
                            recording_was_active,
                        } => {
                            // Don't reset during processing — wait for the pipeline to finish.
                            if !matches!(stage, Stage::Processing)
                                && (recording_was_active || matches!(stage, Stage::Recording(_)))
                            {
                                stage = Stage::Idle;
                                hands_free_locked = false;
                            }
                        }
                        Command::ProcessingFinished => {
                            stage = Stage::Idle;
                            hands_free_locked = false;
                        }
                        Command::ToggleHandsFree => {
                            // First tap during recording: engage the lock so the next
                            // PTT release is ignored. Second tap: clear the lock and
                            // stop recording explicitly.
                            if let Stage::Recording(active_binding) = &stage {
                                if !hands_free_locked {
                                    hands_free_locked = true;
                                    debug!("Hands-free LOCKED for binding '{active_binding}'");
                                    let _ = app.emit("hands-free-locked", true);
                                } else {
                                    let active = active_binding.clone();
                                    hands_free_locked = false;
                                    let _ = app.emit("hands-free-locked", false);
                                    stop(&app, &mut stage, &active, "space");
                                }
                            } else {
                                debug!("ToggleHandsFree ignored — not recording");
                            }
                        }
                    }
                }
                debug!("Transcription coordinator exited");
            }));
            if let Err(e) = result {
                error!("Transcription coordinator panicked: {e:?}");
            }
        });

        Self { tx }
    }

    /// Send a keyboard/signal input event for a transcribe binding.
    /// For signal-based toggles, use `is_pressed: true` and `push_to_talk: false`.
    pub fn send_input(
        &self,
        binding_id: &str,
        hotkey_string: &str,
        is_pressed: bool,
        push_to_talk: bool,
    ) {
        if self
            .tx
            .send(Command::Input {
                binding_id: binding_id.to_string(),
                hotkey_string: hotkey_string.to_string(),
                is_pressed,
                push_to_talk,
            })
            .is_err()
        {
            warn!("Transcription coordinator channel closed");
        }
    }

    pub fn notify_cancel(&self, recording_was_active: bool) {
        if self
            .tx
            .send(Command::Cancel {
                recording_was_active,
            })
            .is_err()
        {
            warn!("Transcription coordinator channel closed");
        }
    }

    pub fn notify_processing_finished(&self) {
        if self.tx.send(Command::ProcessingFinished).is_err() {
            warn!("Transcription coordinator channel closed");
        }
    }

    /// Phase 6: tapped Space during recording. Coordinator decides whether
    /// to lock the recording or stop it based on its internal flag.
    pub fn toggle_hands_free(&self) {
        if self.tx.send(Command::ToggleHandsFree).is_err() {
            warn!("Transcription coordinator channel closed");
        }
    }
}

fn start(app: &AppHandle, stage: &mut Stage, binding_id: &str, hotkey_string: &str) {
    let Some(action) = ACTION_MAP.get(binding_id) else {
        warn!("No action in ACTION_MAP for '{binding_id}'");
        return;
    };
    action.start(app, binding_id, hotkey_string);
    if app
        .try_state::<Arc<AudioRecordingManager>>()
        .map_or(false, |a| a.is_recording())
    {
        *stage = Stage::Recording(binding_id.to_string());
    } else {
        debug!("Start for '{binding_id}' did not begin recording; staying idle");
    }
}

fn stop(app: &AppHandle, stage: &mut Stage, binding_id: &str, hotkey_string: &str) {
    let Some(action) = ACTION_MAP.get(binding_id) else {
        warn!("No action in ACTION_MAP for '{binding_id}'");
        return;
    };
    action.stop(app, binding_id, hotkey_string);
    *stage = Stage::Processing;
}
