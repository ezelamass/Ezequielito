import React from "react";
import { useTranslation } from "react-i18next";
import { type } from "@tauri-apps/plugin-os";
import { MicrophoneSelector } from "../MicrophoneSelector";
import { ShortcutInput } from "../ShortcutInput";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { OutputDeviceSelector } from "../OutputDeviceSelector";
import { PushToTalk } from "../PushToTalk";
import { AudioFeedback } from "../AudioFeedback";
import { useSettings } from "../../../hooks/useSettings";
import { VolumeSlider } from "../VolumeSlider";
import { MuteWhileRecording } from "../MuteWhileRecording";
import { ModelSettingsCard } from "./ModelSettingsCard";

export const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { audioFeedbackEnabled, getSetting } = useSettings();
  const pushToTalk = getSetting("push_to_talk");
  const handsFreeEnabled = getSetting("hands_free_enabled") ?? false;
  const isLinux = type() === "linux";
  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("settings.general.title")}>
        <ShortcutInput shortcutId="transcribe" grouped={true} />
        <PushToTalk descriptionMode="tooltip" grouped={true} />
        {/* Cancel shortcut is hidden with push-to-talk (release key cancels) and on Linux (dynamic shortcut instability) */}
        {!isLinux && !pushToTalk && (
          <ShortcutInput shortcutId="cancel" grouped={true} />
        )}
      </SettingsGroup>

      {/* Ezequielito fork — all the new binding hotkeys, surfaced here so
          the user can rebind them. Some have empty defaults — assign a
          combo to enable. */}
      <SettingsGroup title="Ezequielito shortcuts">
        <ShortcutInput shortcutId="transcribe_with_post_process" grouped={true} />
        <ShortcutInput shortcutId="transcribe_auto" grouped={true} />
        <ShortcutInput shortcutId="transcribe_casual" grouped={true} />
        <ShortcutInput shortcutId="transcribe_formal" grouped={true} />
        <ShortcutInput shortcutId="transcribe_code" grouped={true} />
        <ShortcutInput shortcutId="transcribe_edit" grouped={true} />
        <ShortcutInput shortcutId="voice_command" grouped={true} />
        <ShortcutInput shortcutId="transform_polish" grouped={true} />
        <ShortcutInput shortcutId="transform_prompt_engineer" grouped={true} />
        <ShortcutInput shortcutId="transform_summarize" grouped={true} />
        {handsFreeEnabled && (
          <ShortcutInput shortcutId="hands_free_toggle" grouped={true} />
        )}
      </SettingsGroup>

      <ModelSettingsCard />
      <SettingsGroup title={t("settings.sound.title")}>
        <MicrophoneSelector descriptionMode="tooltip" grouped={true} />
        <MuteWhileRecording descriptionMode="tooltip" grouped={true} />
        <AudioFeedback descriptionMode="tooltip" grouped={true} />
        <OutputDeviceSelector
          descriptionMode="tooltip"
          grouped={true}
          disabled={!audioFeedbackEnabled}
        />
        <VolumeSlider disabled={!audioFeedbackEnabled} />
      </SettingsGroup>
    </div>
  );
};
