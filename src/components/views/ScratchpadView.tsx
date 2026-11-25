import React, { useEffect, useRef, useState } from "react";
import { Copy, Trash2, FileEdit } from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { Trans, useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";

/**
 * Phase 16 (Bundle 4) — Scratchpad view.
 *
 * Free editor that auto-receives the result of dictations triggered by
 * the `transcribe_to_scratchpad` binding. The Rust side emits
 * `scratchpad-append` with the transcribed text; this view appends.
 * Content persists across sessions in localStorage.
 */

const STORAGE_KEY = "ezequielito.scratchpad.v1";

export const ScratchpadView: React.FC = () => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [text, setText] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Persist on change (debounced via microtask).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, text);
    } catch {
      /* localStorage may be unavailable; non-fatal */
    }
  }, [text]);

  // Listen for scratchpad-append events from the Rust side.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<string>("scratchpad-append", (event) => {
        const incoming = event.payload?.trim();
        if (!incoming) return;
        setText((prev) => {
          if (prev.trim() === "") return incoming;
          // Insert a single blank line separator between dictations.
          return prev.replace(/\s+$/, "") + "\n\n" + incoming;
        });
        toast.success(t("views.scratchpad.appended"));
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [t]);

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("views.scratchpad.copied"));
    } catch {
      toast.error(t("views.scratchpad.copyFailed"));
    }
  };

  const handleClear = () => {
    if (text.trim() === "") return;
    if (confirm(t("views.scratchpad.confirmClear"))) {
      setText("");
    }
  };

  const binding =
    settings?.bindings &&
    (settings.bindings as any)["transcribe_to_scratchpad"];
  const hotkey = binding?.current_binding?.trim();

  const wordCount = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
  const charCount = text.length;

  return (
    <div className="w-full max-w-4xl mx-auto py-4 space-y-4">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="font-serif italic text-4xl text-ez-text">
            {t("sidebar.scratchpad")}
          </h1>
          <p className="text-sm text-mid-gray mt-1">
            <Trans
              i18nKey="views.scratchpad.description"
              components={{ binding: <span className="font-mono" /> }}
            />
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hotkey ? (
            <kbd className="font-mono text-xs bg-accent/15 text-accent border border-accent/30 px-2 py-1 rounded">
              {hotkey}
            </kbd>
          ) : (
            <span className="text-xs text-mid-gray font-mono">
              {t("views.scratchpad.noHotkey")}
            </span>
          )}
        </div>
      </header>

      <div className="border border-mid-gray/20 rounded-xl overflow-hidden">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("views.scratchpad.placeholder")}
          className="w-full min-h-[420px] p-5 bg-transparent text-ez-text font-sans text-base leading-relaxed resize-y focus:outline-none focus:ring-0"
          spellCheck={true}
        />
        <div className="flex items-center justify-between border-t border-mid-gray/20 px-4 py-2 bg-mid-gray/5">
          <div className="text-xs text-mid-gray font-mono">
            {t("views.scratchpad.wordCount", { count: wordCount })} ·{" "}
            {t("views.scratchpad.charCount", { count: charCount })}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyAll}
              disabled={text.trim() === ""}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-mid-gray/30 hover:border-accent/50 hover:text-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Copy size={12} />
              {t("views.scratchpad.copyAll")}
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={text.trim() === ""}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-mid-gray/30 hover:border-warm hover:text-warm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 size={12} />
              {t("views.scratchpad.clear")}
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 text-xs text-mid-gray border border-mid-gray/20 rounded-lg p-3">
        <FileEdit size={14} className="shrink-0 mt-0.5" />
        <p>{t("views.scratchpad.hint")}</p>
      </div>
    </div>
  );
};
