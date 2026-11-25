import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface OverlayIdlePillProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/**
 * Keeps the pill on screen while idle so dictation can start with a click.
 * Has no effect while the overlay position is set to "None".
 */
export const OverlayIdlePill: React.FC<OverlayIdlePillProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const enabled = getSetting("overlay_idle_pill") ?? true;
    const overlayOff = getSetting("overlay_position") === "none";

    return (
      <ToggleSwitch
        checked={enabled && !overlayOff}
        onChange={(value) => updateSetting("overlay_idle_pill", value)}
        isUpdating={isUpdating("overlay_idle_pill")}
        disabled={overlayOff}
        label={t("settings.advanced.overlayIdlePill.title")}
        description={t("settings.advanced.overlayIdlePill.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);
