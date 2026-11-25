import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSettings } from "../../hooks/useSettings";
import { commands, type AvailableUpdate } from "../../bindings";

interface UpdateCheckerProps {
  className?: string;
}

/** How long "up to date" or "could not check" stays on screen. */
const NOTICE_DURATION_MS = 3000;

/** What a check the person asked for ended in, when there is no update. */
type Notice = "upToDate" | "failed";

/**
 * Tells the person when a newer version has been published, with a link to
 * the page that has the installers. It is a notice, not a self-update: the
 * app never downloads or installs anything by itself.
 */
const UpdateChecker: React.FC<UpdateCheckerProps> = ({ className = "" }) => {
  const { t } = useTranslation();
  const [isChecking, setIsChecking] = useState(false);
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const { settings, isLoading } = useSettings();
  const settingsLoaded = !isLoading && settings !== null;
  const updateChecksEnabled = settings?.update_checks_enabled ?? false;

  const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const isCheckingRef = useRef(false);
  // A check asked for by the person (tray menu, or a click here) reports
  // how it ended; the one at start-up only speaks when there is an update.
  const isManualCheckRef = useRef(false);
  // Bumped when the checks are turned off or the component goes away, so a
  // check that was still running does not report into the new state.
  const generationRef = useRef(0);

  const checkForUpdates = useCallback(async (manual: boolean) => {
    if (manual) isManualCheckRef.current = true;
    if (isCheckingRef.current) return;

    const generation = generationRef.current;
    isCheckingRef.current = true;
    setIsChecking(true);
    setNotice(null);
    clearTimeout(noticeTimeoutRef.current);

    let found: AvailableUpdate | null = null;
    let failed = false;
    try {
      const result = await commands.checkForUpdate();
      if (result.status === "ok") found = result.data;
      else failed = true;
    } catch (error) {
      console.error("Failed to check for updates:", error);
      failed = true;
    }
    if (generation !== generationRef.current) return;

    const wasManual = isManualCheckRef.current;
    isManualCheckRef.current = false;
    isCheckingRef.current = false;
    setIsChecking(false);
    // A failed check says nothing about an update that was already found.
    if (!failed) setUpdate(found);

    if (wasManual && (failed || !found)) {
      setNotice(failed ? "failed" : "upToDate");
      noticeTimeoutRef.current = setTimeout(() => {
        setNotice(null);
      }, NOTICE_DURATION_MS);
    }
  }, []);

  useEffect(() => {
    // Wait for settings to load before doing anything
    if (!settingsLoaded || !updateChecksEnabled) return;

    void checkForUpdates(false);

    // The tray menu asks for a check through this event
    const updateUnlisten = listen("check-for-updates", () => {
      void checkForUpdates(true);
    });

    return () => {
      generationRef.current += 1;
      isCheckingRef.current = false;
      isManualCheckRef.current = false;
      clearTimeout(noticeTimeoutRef.current);
      setIsChecking(false);
      setUpdate(null);
      setNotice(null);
      updateUnlisten.then((fn) => fn());
    };
  }, [settingsLoaded, updateChecksEnabled, checkForUpdates]);

  const getUpdateStatusText = () => {
    if (!updateChecksEnabled) return t("footer.updateCheckingDisabled");
    if (isChecking) return t("footer.checkingUpdates");
    if (notice === "upToDate") return t("footer.upToDate");
    if (notice === "failed") return t("footer.checkFailed");
    return t("footer.checkForUpdates");
  };

  const shownUpdate =
    updateChecksEnabled && !isChecking && !notice ? update : null;
  const isCheckClickable = updateChecksEnabled && !isChecking && !notice;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {shownUpdate ? (
        <>
          <span className="text-text/60 tabular-nums">
            {t("footer.updateAvailable", { version: shownUpdate.version })}
          </span>
          <button
            onClick={() => {
              openUrl(shownUpdate.url).catch((error) => {
                console.error("Failed to open the download page:", error);
              });
            }}
            className="transition-colors text-logo-primary hover:text-logo-primary/80 font-medium"
          >
            {t("footer.downloadUpdate")}
          </button>
        </>
      ) : isCheckClickable ? (
        <button
          onClick={() => void checkForUpdates(true)}
          className="transition-colors tabular-nums text-text/60 hover:text-text/80"
        >
          {getUpdateStatusText()}
        </button>
      ) : (
        <span className="text-text/60 tabular-nums">
          {getUpdateStatusText()}
        </span>
      )}
    </div>
  );
};

export default UpdateChecker;
