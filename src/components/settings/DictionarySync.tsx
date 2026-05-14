import React, { useState } from "react";
import { toast } from "sonner";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useSettings } from "../../hooks/useSettings";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { SettingContainer } from "../ui/SettingContainer";
import { commands } from "@/bindings";

interface DictionarySyncProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/**
 * Phase 9: Dictionary sync via a JSON file living in a cloud-synced folder
 * (OneDrive / Dropbox / Google Drive). User picks the path; Sync Now merges
 * the file contents with custom_words (deduped union) and writes back.
 */
export const DictionarySync: React.FC<DictionarySyncProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { getSetting } = useSettings();
    const syncPath = getSetting("dictionary_sync_path") || "";
    const [draft, setDraft] = useState(syncPath);
    const [isSyncing, setIsSyncing] = useState(false);

    const handlePickFile = async () => {
      try {
        const selected = await openDialog({
          multiple: false,
          directory: false,
          defaultPath: syncPath || undefined,
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (typeof selected === "string") {
          setDraft(selected);
          await commands.setDictionarySyncPath(selected);
          toast.success("Dictionary sync path saved");
        }
      } catch (e) {
        toast.error(`Error: ${String(e)}`);
      }
    };

    const handleSavePath = async () => {
      try {
        await commands.setDictionarySyncPath(draft);
        toast.success("Dictionary sync path saved");
      } catch (e) {
        toast.error(`Error: ${String(e)}`);
      }
    };

    const handleClear = async () => {
      setDraft("");
      await commands.setDictionarySyncPath("");
      toast.success("Dictionary sync disabled");
    };

    const handleSyncNow = async () => {
      if (!syncPath) {
        toast.error("Configurá una ruta de sync primero");
        return;
      }
      setIsSyncing(true);
      try {
        const result = await commands.syncDictionaryNow();
        if (result.status === "ok") {
          toast.success(`Sync OK — ${result.data.length} palabras`);
        } else {
          toast.error(`Sync falló: ${result.error}`);
        }
      } catch (e) {
        toast.error(`Sync error: ${String(e)}`);
      } finally {
        setIsSyncing(false);
      }
    };

    return (
      <SettingContainer
        title="Dictionary sync"
        description="Sincronizá tu custom_words con un archivo JSON en OneDrive / Dropbox / Google Drive. El servicio de cloud se encarga de propagar entre dispositivos."
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <div className="flex flex-col gap-2 w-full">
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="C:\Users\…\OneDrive\ezequielito-dictionary.json"
              variant="compact"
              className="flex-1"
            />
            <Button onClick={handlePickFile} variant="secondary" size="md">
              Examinar
            </Button>
            <Button
              onClick={handleSavePath}
              variant="primary"
              size="md"
              disabled={draft === syncPath}
            >
              Guardar
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSyncNow}
              variant="primary"
              size="md"
              disabled={!syncPath || isSyncing}
            >
              {isSyncing ? "Sincronizando..." : "Sync now"}
            </Button>
            {syncPath && (
              <Button onClick={handleClear} variant="secondary" size="md">
                Desactivar
              </Button>
            )}
            {syncPath && (
              <span className="text-xs text-mid-gray truncate flex-1" title={syncPath}>
                Sync activo: {syncPath}
              </span>
            )}
          </div>
        </div>
      </SettingContainer>
    );
  },
);
