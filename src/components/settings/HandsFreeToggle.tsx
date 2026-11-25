import React from "react";
import { useTranslation } from "react-i18next";
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
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const enabled = getSetting("hands_free_enabled") ?? false;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(value) => updateSetting("hands_free_enabled", value)}
        isUpdating={isUpdating("hands_free_enabled")}
        label={t("settings.advanced.handsFree.title")}
        description={t("settings.advanced.handsFree.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);
