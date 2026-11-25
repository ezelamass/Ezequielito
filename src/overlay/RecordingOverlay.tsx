import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./RecordingOverlay.css";
import { commands } from "@/bindings";
import i18n, { syncLanguageFromSettings } from "@/i18n";
import { getLanguageDirection } from "@/lib/utils/rtl";
import { formatShortcut } from "./formatShortcut";

/**
 * Floating pill.
 *
 * State machine (driven by Rust events):
 *  - HIDDEN: nothing on screen
 *  - IDLE: small resting bar; hover shows the hotkey, click starts a
 *    hands-free dictation
 *  - RECORDING: waveform reactive to mic level + cancel button (✕)
 *  - LOCKED: hands-free engaged — waveform + badge + check (✓) that stops
 *    the recording and transcribes it
 *  - TRANSCRIBING / PROCESSING: spinner
 *  - ERROR: short message, then Rust sends us back to idle / hidden. The
 *    same state carries notices (a word was added to the dictionary), which
 *    are not errors and do not look like one
 *
 * Events:
 *  - show-overlay (payload: OverlayState)
 *  - hide-overlay
 *  - overlay-error (payload: error or notice code, sent right before
 *    show-overlay "error")
 *  - mic-level (payload: number[] — waveform levels)
 *  - hands-free-locked (payload: boolean)
 */

type OverlayState =
  | "idle"
  | "recording"
  | "transcribing"
  | "processing"
  | "error";

const ERROR_KEYS: Record<string, string> = {
  mic_denied: "overlay.errors.micDenied",
  no_mic: "overlay.errors.noMic",
  no_speech: "overlay.errors.noSpeech",
  transcription_failed: "overlay.errors.transcriptionFailed",
  paste_failed: "overlay.errors.pasteFailed",
  command_not_found: "overlay.errors.commandNotFound",
  no_selection: "overlay.errors.noSelection",
  ai_not_configured: "overlay.errors.aiNotConfigured",
  ai_failed: "overlay.errors.aiFailed",
  generic: "overlay.errors.generic",
};

/** Codes that arrive through `overlay-error` but report something that worked. */
const NOTICE_KEYS: Record<string, string> = {
  word_added: "overlay.notices.wordAdded",
  word_known: "overlay.notices.wordKnown",
};

const BAR_COUNT = 12;

const MicIcon: React.FC = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" />
  </svg>
);

const RecordingOverlay: React.FC = () => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [state, setState] = useState<OverlayState>("recording");
  const [locked, setLocked] = useState(false);
  const [errorCode, setErrorCode] = useState("generic");
  const [shortcut, setShortcut] = useState("");
  const [atTop, setAtTop] = useState(false);
  const [levels, setLevels] = useState<number[]>(Array(BAR_COUNT).fill(0));
  const smoothedLevelsRef = useRef<number[]>(Array(BAR_COUNT).fill(0));
  const direction = getLanguageDirection(i18n.language);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    const refreshFromSettings = async () => {
      const result = await commands.getAppSettings();
      if (cancelled || result.status !== "ok") return;
      const binding = result.data.bindings?.transcribe?.current_binding ?? "";
      setShortcut(formatShortcut(binding));
      setAtTop(result.data.overlay_position === "top");
    };

    const setup = async () => {
      unlisteners.push(
        await listen<OverlayState>("show-overlay", (event) => {
          const next = event.payload;
          // Apply the state synchronously: events that follow this one
          // (hands-free-locked, the next show-overlay) must find it already
          // set, so nothing here may wait before updating.
          setState(next);
          setIsVisible(true);
          // A fresh recording or the resting state never starts locked.
          if (next === "recording" || next === "idle") {
            setLocked(false);
          }
          if (next === "idle") {
            void refreshFromSettings();
          } else {
            void syncLanguageFromSettings();
          }
        }),
        await listen("hide-overlay", () => {
          setIsVisible(false);
          setLocked(false);
        }),
        await listen<string>("overlay-error", (event) => {
          setErrorCode(event.payload);
        }),
        await listen<number[]>("mic-level", (event) => {
          const incoming = event.payload;
          const smoothed = smoothedLevelsRef.current.map((prev, i) => {
            const target = incoming[i] || 0;
            return prev * 0.7 + target * 0.3;
          });
          smoothedLevelsRef.current = smoothed;
          setLevels(smoothed.slice(0, BAR_COUNT));
        }),
        await listen<boolean>("hands-free-locked", (event) => {
          setLocked(event.payload);
        }),
      );

      if (cancelled) {
        unlisteners.forEach((unlisten) => unlisten());
        return;
      }
      // Listeners are attached: ask Rust for the resting state (idle pill or
      // hidden). Events emitted before this point would have been lost.
      await commands.overlayReady();
    };

    void setup();

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  const handleCancel = () => {
    void commands.cancelOperation();
  };

  // Hands-free confirm: stop the recording and send it through the normal
  // transcribe → paste pipeline (the audio is kept, unlike cancel).
  const handleConfirm = () => {
    void commands.confirmRecording();
  };

  const handleStart = () => {
    void commands.startDictationFromOverlay();
  };

  const isIdle = state === "idle";
  const isRecording = state === "recording";
  const isProcessing = state === "transcribing" || state === "processing";
  const noticeKey = NOTICE_KEYS[errorCode];
  const isNotice = state === "error" && noticeKey !== undefined;
  const isError = state === "error" && !isNotice;

  if (isIdle) {
    return (
      <div
        dir={direction}
        className={`ez-idle ${isVisible ? "ez-idle--visible" : ""} ${
          atTop ? "ez-idle--top" : ""
        }`}
      >
        <button
          type="button"
          className="ez-idle__pill"
          onClick={handleStart}
          aria-label={t("overlay.idle.start")}
        >
          <span className="ez-idle__content">
            <MicIcon />
            <span className="ez-idle__label">
              {shortcut || t("overlay.idle.start")}
            </span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      dir={direction}
      className={`ez-pill ${isVisible ? "ez-pill--visible" : ""} ${
        locked ? "ez-pill--locked" : ""
      } ${isProcessing ? "ez-pill--processing" : ""} ${
        isError ? "ez-pill--error" : ""
      } ${isNotice ? "ez-pill--notice" : ""}`}
    >
      {/* LEFT: cancel button while recording, hidden otherwise */}
      <div className="ez-pill__left">
        {isRecording && (
          <button
            type="button"
            className="ez-pill__btn ez-pill__btn--cancel"
            onClick={handleCancel}
            aria-label={t("overlay.cancel")}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* CENTER: waveform, spinner, error message or notice */}
      <div className="ez-pill__center">
        {isRecording && (
          <div className="ez-pill__waveform">
            {levels.map((v, i) => (
              <div
                key={i}
                className="ez-pill__bar"
                style={{
                  height: `${Math.min(22, 3 + Math.pow(v, 0.6) * 19)}px`,
                  opacity: Math.max(0.3, Math.min(1, v * 2)),
                }}
              />
            ))}
          </div>
        )}
        {isProcessing && (
          <div
            className="ez-pill__spinner"
            aria-label={t("overlay.transcribing")}
          >
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        )}
        {isError && (
          <div className="ez-pill__error" role="alert">
            {t(ERROR_KEYS[errorCode] ?? ERROR_KEYS.generic)}
          </div>
        )}
        {isNotice && (
          <div className="ez-pill__notice" role="status">
            {t(noticeKey)}
          </div>
        )}
      </div>

      {/* RIGHT: check/confirm button when locked; empty otherwise */}
      <div className="ez-pill__right">
        {isRecording && locked && (
          <button
            type="button"
            className="ez-pill__btn ez-pill__btn--confirm"
            onClick={handleConfirm}
            aria-label={t("overlay.confirm")}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </button>
        )}
      </div>

      {/* Lock indicator: floating badge below the pill when hands-free engaged */}
      {isRecording && locked && (
        <div className="ez-pill__lock-badge">{t("overlay.handsFree")}</div>
      )}
    </div>
  );
};

export default RecordingOverlay;
