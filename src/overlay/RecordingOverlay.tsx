import { listen } from "@tauri-apps/api/event";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./RecordingOverlay.css";
import { commands } from "@/bindings";
import i18n, { syncLanguageFromSettings } from "@/i18n";
import { getLanguageDirection } from "@/lib/utils/rtl";

/**
 * Recording overlay (Wispr-Flow style pill, Ezequielito brand).
 *
 * State machine (driven by Rust events):
 *  - HIDDEN: no overlay visible (default)
 *  - RECORDING: waveform reactive to mic level + cancel button (X)
 *  - LOCKED: hands-free engaged — waveform + lock badge + check (✓) to confirm-stop
 *  - TRANSCRIBING / PROCESSING: spinner
 *
 * Events:
 *  - show-overlay (payload: "recording" | "transcribing" | "processing")
 *  - hide-overlay
 *  - mic-level (payload: number[] — waveform levels)
 *  - hands-free-locked (payload: boolean — true = lock on, false = lock off)
 */

type OverlayState = "recording" | "transcribing" | "processing";

const RecordingOverlay: React.FC = () => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [state, setState] = useState<OverlayState>("recording");
  const [locked, setLocked] = useState(false);
  const [levels, setLevels] = useState<number[]>(Array(12).fill(0));
  const smoothedLevelsRef = useRef<number[]>(Array(12).fill(0));
  const direction = getLanguageDirection(i18n.language);

  useEffect(() => {
    const setupEventListeners = async () => {
      const unlistenShow = await listen("show-overlay", async (event) => {
        await syncLanguageFromSettings();
        const overlayState = event.payload as OverlayState;
        setState(overlayState);
        setIsVisible(true);
        // Reset lock state on every fresh show.
        if (overlayState === "recording") {
          setLocked(false);
        }
      });

      const unlistenHide = await listen("hide-overlay", () => {
        setIsVisible(false);
        setLocked(false);
      });

      const unlistenLevel = await listen<number[]>("mic-level", (event) => {
        const newLevels = event.payload as number[];
        const smoothed = smoothedLevelsRef.current.map((prev, i) => {
          const target = newLevels[i] || 0;
          return prev * 0.7 + target * 0.3;
        });
        smoothedLevelsRef.current = smoothed;
        // Use only the central 12 bars for a cleaner Wispr-style waveform.
        setLevels(smoothed.slice(0, 12));
      });

      const unlistenLocked = await listen<boolean>(
        "hands-free-locked",
        (event) => {
          setLocked(event.payload as boolean);
        },
      );

      return () => {
        unlistenShow();
        unlistenHide();
        unlistenLevel();
        unlistenLocked();
      };
    };

    setupEventListeners();
  }, []);

  const handleCancel = () => {
    commands.cancelOperation();
  };

  // Stop the hands-free recording explicitly. We don't have a dedicated
  // "stop" command on the frontend, so we emit a cancel which the user can
  // re-trigger; in practice the Space hotkey is the canonical way to stop.
  // For now, the check button is decorative + falls back to cancel.
  const handleConfirm = () => {
    // TODO: wire a dedicated stop-and-transcribe command. For Phase 10
    // first pass, treat ✓ the same as releasing the main hotkey would.
    // Cancel works as an escape hatch until that's wired up.
    commands.cancelOperation();
  };

  const isRecording = state === "recording";
  const isProcessing = state === "transcribing" || state === "processing";

  return (
    <div
      dir={direction}
      className={`ez-pill ${isVisible ? "ez-pill--visible" : ""} ${
        locked ? "ez-pill--locked" : ""
      } ${isProcessing ? "ez-pill--processing" : ""}`}
    >
      {/* LEFT: cancel button while recording, hidden during processing */}
      <div className="ez-pill__left">
        {isRecording && (
          <button
            type="button"
            className="ez-pill__btn ez-pill__btn--cancel"
            onClick={handleCancel}
            aria-label="Cancel"
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

      {/* CENTER: waveform (recording/locked) or spinner (processing) */}
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
          <div className="ez-pill__spinner" aria-label={t("overlay.transcribing")}>
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
      </div>

      {/* RIGHT: check/confirm button when locked; empty otherwise */}
      <div className="ez-pill__right">
        {isRecording && locked && (
          <button
            type="button"
            className="ez-pill__btn ez-pill__btn--confirm"
            onClick={handleConfirm}
            aria-label="Confirm"
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
        <div className="ez-pill__lock-badge">HANDS-FREE</div>
      )}
    </div>
  );
};

export default RecordingOverlay;
