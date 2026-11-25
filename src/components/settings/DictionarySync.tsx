import React, { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
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
    const { t } = useTranslation();
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
          toast.success(t("settings.ezequielito.dictionarySync.pathSaved"));
        }
      } catch (e) {
        toast.error(
          t("settings.ezequielito.dictionarySync.error", { error: String(e) }),
        );
      }
    };

    const handleSavePath = async () => {
      try {
        await commands.setDictionarySyncPath(draft);
        toast.success(t("settings.ezequielito.dictionarySync.pathSaved"));
      } catch (e) {
        toast.error(
          t("settings.ezequielito.dictionarySync.error", { error: String(e) }),
        );
      }
    };

    const handleClear = async () => {
      setDraft("");
      await commands.setDictionarySyncPath("");
      toast.success(t("settings.ezequielito.dictionarySync.disabled"));
    };

    const handleSyncNow = async () => {
      if (!syncPath) {
        toast.error(t("settings.ezequielito.dictionarySync.noPath"));
        return;
      }
      setIsSyncing(true);
      try {
        const result = await commands.syncDictionaryNow();
        if (result.status === "ok") {
          toast.success(
            t("settings.ezequielito.dictionarySync.syncOk", {
              count: result.data.length,
            }),
          );
        } else {
          toast.error(
            t("settings.ezequielito.dictionarySync.syncFailed", {
              error: result.error,
            }),
          );
        }
      } catch (e) {
        toast.error(
          t("settings.ezequielito.dictionarySync.syncError", {
            error: String(e),
          }),
        );
      } finally {
        setIsSyncing(false);
      }
    };

    return (
      <SettingContainer
        title={t("settings.ezequielito.dictionarySync.title")}
        description={t("settings.ezequielito.dictionarySync.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <div className="flex flex-col gap-2 w-full">
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t(
                "settings.ezequielito.dictionarySync.pathPlaceholder",
              )}
              variant="compact"
              className="flex-1"
            />
            <Button onClick={handlePickFile} variant="secondary" size="md">
              {t("settings.ezequielito.dictionarySync.browse")}
            </Button>
            <Button
              onClick={handleSavePath}
              variant="primary"
              size="md"
              disabled={draft === syncPath}
            >
              {t("common.save")}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSyncNow}
              variant="primary"
              size="md"
              disabled={!syncPath || isSyncing}
            >
              {isSyncing
                ? t("settings.ezequielito.dictionarySync.syncing")
                : t("settings.ezequielito.dictionarySync.syncNow")}
            </Button>
            {syncPath && (
              <Button onClick={handleClear} variant="secondary" size="md">
                {t("settings.ezequielito.dictionarySync.disable")}
              </Button>
            )}
            {syncPath && (
              <span
                className="text-xs text-mid-gray truncate flex-1"
                title={syncPath}
              >
                {t("settings.ezequielito.dictionarySync.active", {
                  path: syncPath,
                })}
              </span>
            )}
          </div>
        </div>
      </SettingContainer>
    );
  },
);
