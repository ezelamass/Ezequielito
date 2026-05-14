import React, { useState } from "react";
import { toast } from "sonner";
import { useSettings } from "../../hooks/useSettings";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { SettingContainer } from "../ui/SettingContainer";

interface AppPromptMappingProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/**
 * Phase 11 (rescue): Editor for the app → prompt map used by the
 * `transcribe_auto` binding. Keys are process names (lowercase, no .exe);
 * values are prompt IDs that exist in post_process_prompts.
 *
 * Default suggestions:
 *  - `ez_code`    for Claude / Cursor / VS Code / Windsurf
 *  - `ez_formal`  for Outlook / Thunderbird
 *  - `ez_casual`  for WhatsApp / Telegram / Slack / Discord (and unknown apps)
 */
export const AppPromptMapping: React.FC<AppPromptMappingProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const map = (getSetting("app_prompt_map") || {}) as {
      [key in string]: string;
    };
    const entries = Object.entries(map);

    const [newApp, setNewApp] = useState("");
    const [newPrompt, setNewPrompt] = useState("ez_casual");

    const validPromptIds = ["ez_casual", "ez_formal", "ez_code"];

    const handleAdd = () => {
      const app = newApp.trim().toLowerCase().replace(/\.exe$/i, "");
      const prompt = newPrompt.trim();
      if (!app || !prompt) return;
      if (map[app]) {
        toast.error(`Mapping para "${app}" ya existe`);
        return;
      }
      updateSetting("app_prompt_map", { ...map, [app]: prompt });
      setNewApp("");
      setNewPrompt("ez_casual");
    };

    const handleRemove = (appToRemove: string) => {
      const next = { ...map };
      delete next[appToRemove];
      updateSetting("app_prompt_map", next);
    };

    const handleChangePrompt = (app: string, prompt: string) => {
      updateSetting("app_prompt_map", { ...map, [app]: prompt });
    };

    const promptLabel = (id: string) => {
      switch (id) {
        case "ez_casual":
          return "Casual";
        case "ez_formal":
          return "Formal";
        case "ez_code":
          return "Code";
        default:
          return id;
      }
    };

    return (
      <>
        <SettingContainer
          title="App → Prompt mapping (Auto mode)"
          description="Cuando usás el hotkey 'Transcribe (Auto)', el sistema detecta la app en foreground y rutea al prompt mapeado acá. Apps no listadas usan Casual por default."
          descriptionMode={descriptionMode}
          grouped={grouped}
        >
          <div className="flex flex-col gap-2 w-full">
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={newApp}
                onChange={(e) => setNewApp(e.target.value)}
                placeholder="exe name (ej: 'cursor', 'outlook')"
                variant="compact"
                className="flex-1"
                disabled={isUpdating("app_prompt_map")}
              />
              <select
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                className="bg-background-ui border border-mid-gray/30 rounded px-2 py-1 text-sm"
                disabled={isUpdating("app_prompt_map")}
              >
                {validPromptIds.map((id) => (
                  <option key={id} value={id}>
                    {promptLabel(id)}
                  </option>
                ))}
              </select>
              <Button
                onClick={handleAdd}
                disabled={!newApp.trim() || isUpdating("app_prompt_map")}
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
            {entries
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([app, prompt]) => (
                <div
                  key={app}
                  className="flex items-center gap-2 py-1 text-sm"
                >
                  <span className="font-mono text-accent flex-shrink-0 min-w-[120px]">
                    {app}
                  </span>
                  <span className="text-mid-gray flex-shrink-0">→</span>
                  <select
                    value={prompt}
                    onChange={(e) =>
                      handleChangePrompt(app, e.target.value)
                    }
                    className="bg-background-ui border border-mid-gray/30 rounded px-2 py-1 text-sm flex-1"
                    disabled={isUpdating("app_prompt_map")}
                  >
                    {validPromptIds.map((id) => (
                      <option key={id} value={id}>
                        {promptLabel(id)}
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={() => handleRemove(app)}
                    disabled={isUpdating("app_prompt_map")}
                    variant="secondary"
                    size="sm"
                    aria-label={`Eliminar mapping ${app}`}
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
