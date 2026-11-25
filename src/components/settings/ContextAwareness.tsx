import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface ContextAwarenessProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/**
 * Lets the cleanup model know which app and window the text is going to.
 * Off means the app name and window title never leave the machine.
 */
export const ContextAwareness: React.FC<ContextAwarenessProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const enabled = getSetting("context_awareness") ?? true;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(value) => updateSetting("context_awareness", value)}
        isUpdating={isUpdating("context_awareness")}
        label={t("settings.advanced.contextAwareness.title")}
        description={t("settings.advanced.contextAwareness.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);
