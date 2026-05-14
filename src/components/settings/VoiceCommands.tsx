import React, { useState } from "react";
import { toast } from "sonner";
import { useSettings } from "../../hooks/useSettings";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { SettingContainer } from "../ui/SettingContainer";

interface VoiceCommandsProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/**
 * Voice command editor: spoken phrase → launchable target (URI or exe).
 *
 * When the user holds the `voice_command` hotkey and says one of these
 * phrases, the transcription is normalized and matched here, then the
 * Windows shell is invoked with `cmd /C start "" <target>` to launch the
 * URI/exe. See app_launcher.rs for the matching logic.
 */
export const VoiceCommands: React.FC<VoiceCommandsProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const commands = (getSetting("voice_commands") || {}) as {
      [key: string]: string;
    };
    const entries = Object.entries(commands);

    const [newPhrase, setNewPhrase] = useState("");
    const [newTarget, setNewTarget] = useState("");

    const handleAdd = () => {
      const phrase = newPhrase.trim().toLowerCase();
      const target = newTarget.trim();
      if (!phrase || !target) return;

      if (commands[phrase]) {
        toast.error(`Comando "${phrase}" ya existe`);
        return;
      }
      updateSetting("voice_commands", { ...commands, [phrase]: target });
      setNewPhrase("");
      setNewTarget("");
    };

    const handleRemove = (phraseToRemove: string) => {
      const next = { ...commands };
      delete next[phraseToRemove];
      updateSetting("voice_commands", next);
    };

    return (
      <>
        <SettingContainer
          title="Voice commands"
          description="Comandos de voz para lanzar apps. Mantené el hotkey de voice command + decí la frase. Targets: URIs (claude://, whatsapp://, notion://) o exe directos (chrome.exe, calc.exe)."
          descriptionMode={descriptionMode}
          grouped={grouped}
        >
          <div className="flex flex-col gap-2 w-full">
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={newPhrase}
                onChange={(e) => setNewPhrase(e.target.value)}
                placeholder="frase (ej: 'claude code')"
                variant="compact"
                className="flex-1"
                disabled={isUpdating("voice_commands")}
              />
              <Input
                type="text"
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                placeholder="target (ej: 'claude://')"
                variant="compact"
                className="flex-1"
                disabled={isUpdating("voice_commands")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
              />
              <Button
                onClick={handleAdd}
                disabled={
                  !newPhrase.trim() ||
                  !newTarget.trim() ||
                  isUpdating("voice_commands")
                }
                variant="primary"
                size="md"
              >
                Agregar
              </Button>
            </div>
          </div>
        </SettingContainer>

        {entries.length > 0 && (
          <div
            className={`px-4 p-2 ${
              grouped ? "" : "rounded-lg border border-mid-gray/20"
            } flex flex-col gap-1`}
          >
            {entries.map(([phrase, target]) => (
              <div
                key={phrase}
                className="flex items-center gap-2 py-1 text-sm"
              >
                <span className="font-mono text-accent flex-shrink-0">
                  {phrase}
                </span>
                <span className="text-mid-gray flex-shrink-0">→</span>
                <span className="flex-1 truncate font-mono text-xs" title={target}>
                  {target}
                </span>
                <Button
                  onClick={() => handleRemove(phrase)}
                  disabled={isUpdating("voice_commands")}
                  variant="secondary"
                  size="sm"
                  aria-label={`Eliminar voice command ${phrase}`}
                >
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </Button>
              </div>
            ))}
          </div>
        )}
      </>
    );
  },
);
