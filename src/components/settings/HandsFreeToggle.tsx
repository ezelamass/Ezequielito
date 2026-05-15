import React from "react";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface HandsFreeToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/**
 * Phase 6 follow-up: opt-in toggle for the Wispr-style hands-free gesture.
 *
 * When ON: while a dictation is in progress (any transcribe-flavour
 * hotkey), tapping Space "locks" the recording so the user can release
 * the main PTT key and keep talking. Tap Space again to stop.
 *
 * A conflict guard in shortcut::register_hands_free_shortcut skips
 * registration if the Space binding would collide with the active
 * transcribe hotkey (e.g. transcribe = "ctrl+space"). For users with
 * non-Space PTT bindings (like "ctrl+win"), it just works.
 */
export const HandsFreeToggle: React.FC<HandsFreeToggleProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const enabled = getSetting("hands_free_enabled") ?? false;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(value) => updateSetting("hands_free_enabled", value)}
        isUpdating={isUpdating("hands_free_enabled")}
        label="Hands-free (tap Space mid-recording)"
        description="Mientras estás grabando con tu hotkey de transcribe, tap Space → recording se queda lockeado y podés soltar el hotkey. Tap Space de nuevo para parar. Útil para dictados largos sin tener que mantener teclas. Si tu hotkey de transcribe es Ctrl+Space, el guard de conflicto skipea esto automáticamente (usá Ctrl+Win u otro)."
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);
