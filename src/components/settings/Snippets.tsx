import React, { useState } from "react";
import { toast } from "sonner";
import { useSettings } from "../../hooks/useSettings";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { SettingContainer } from "../ui/SettingContainer";
import type { Snippet } from "@/bindings";

interface SnippetsProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/**
 * Voice trigger → text expansion editor.
 *
 * Each snippet has a `trigger` phrase (e.g. "mi email") and an `expansion`
 * (e.g. the full email address). When transcribed text contains the trigger
 * as a whole-word case-insensitive match, it is replaced before paste.
 *
 * Applied between LLM post-processing and paste; see actions.rs:apply_snippets.
 */
export const Snippets: React.FC<SnippetsProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const snippets: Snippet[] = getSetting("snippets") || [];

    const [newTrigger, setNewTrigger] = useState("");
    const [newExpansion, setNewExpansion] = useState("");

    const handleAdd = () => {
      const trigger = newTrigger.trim();
      const expansion = newExpansion.trim();
      if (!trigger || !expansion) return;

      if (snippets.some((s) => s.trigger.toLowerCase() === trigger.toLowerCase())) {
        toast.error(`Snippet "${trigger}" ya existe`);
        return;
      }
      if (trigger.length > 80 || expansion.length > 2000) {
        toast.error("Trigger ≤ 80 chars, expansión ≤ 2000 chars");
        return;
      }
      updateSetting("snippets", [...snippets, { trigger, expansion }]);
      setNewTrigger("");
      setNewExpansion("");
    };

    const handleRemove = (triggerToRemove: string) => {
      updateSetting(
        "snippets",
        snippets.filter((s) => s.trigger !== triggerToRemove),
      );
    };

    return (
      <>
        <SettingContainer
          title="Snippets"
          description="Voice triggers que se expanden a texto. Ej: decí 'mi email' y se pega tu dirección completa. Match case-insensitive de palabra completa."
          descriptionMode={descriptionMode}
          grouped={grouped}
        >
          <div className="flex flex-col gap-2 w-full">
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={newTrigger}
                onChange={(e) => setNewTrigger(e.target.value)}
                placeholder="trigger (ej: 'mi email')"
                variant="compact"
                className="flex-1"
                disabled={isUpdating("snippets")}
              />
              <Input
                type="text"
                value={newExpansion}
                onChange={(e) => setNewExpansion(e.target.value)}
                placeholder="expansion (texto a pegar)"
                variant="compact"
                className="flex-[2]"
                disabled={isUpdating("snippets")}
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
                  !newTrigger.trim() ||
                  !newExpansion.trim() ||
                  isUpdating("snippets")
                }
                variant="primary"
                size="md"
              >
                Agregar
              </Button>
            </div>
          </div>
        </SettingContainer>

        {snippets.length > 0 && (
          <div
            className={`px-4 p-2 ${
              grouped ? "" : "rounded-lg border border-mid-gray/20"
            } flex flex-col gap-1`}
          >
            {snippets.map((snippet) => (
              <div
                key={snippet.trigger}
                className="flex items-center gap-2 py-1 text-sm"
              >
                <span className="font-mono text-accent flex-shrink-0">
                  {snippet.trigger}
                </span>
                <span className="text-mid-gray flex-shrink-0">→</span>
                <span className="flex-1 truncate" title={snippet.expansion}>
                  {snippet.expansion}
                </span>
                <Button
                  onClick={() => handleRemove(snippet.trigger)}
                  disabled={isUpdating("snippets")}
                  variant="secondary"
                  size="sm"
                  aria-label={`Eliminar snippet ${snippet.trigger}`}
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
