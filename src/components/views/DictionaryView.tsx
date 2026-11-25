import React, { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { commands, type WordSuggestion } from "@/bindings";
import { useSettings } from "../../hooks/useSettings";
import { CustomWords } from "../settings/CustomWords";
import { Button } from "../ui/Button";

/**
 * Phase 13 Dictionary view — Wispr-style top-level page wrapping the
 * existing CustomWords component (which still works inside Settings).
 *
 * Tabs (All / Personal / Shared with team) are kept for visual parity
 * with Wispr Flow; "Shared" is a placeholder until we add team sync.
 */

type DictTab = "all" | "personal" | "shared";

export const DictionaryView: React.FC = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DictTab>("all");

  return (
    <div className="w-full max-w-4xl mx-auto py-4 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="font-serif italic text-4xl text-ez-text">
          {t("sidebar.dictionary")}
        </h1>
      </header>

      {/* Tabs */}
      <nav className="flex gap-6 border-b border-mid-gray/20">
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>
          {t("views.dictionary.tabs.all")}
        </TabButton>
        <TabButton
          active={tab === "personal"}
          onClick={() => setTab("personal")}
        >
          {t("views.dictionary.tabs.personal")}
        </TabButton>
        <TabButton active={tab === "shared"} onClick={() => setTab("shared")}>
          {t("views.dictionary.tabs.shared")}
        </TabButton>
      </nav>

      {/* Promo card */}
      <div className="border border-mid-gray/20 rounded-xl p-6 bg-mid-gray/5">
        <h2 className="font-serif italic text-2xl mb-2">
          <Trans
            i18nKey="views.dictionary.promo.title"
            components={{ emphasis: <span className="not-italic" /> }}
          />
        </h2>
        <p className="text-sm text-mid-gray max-w-2xl">
          {t("views.dictionary.promo.description")}
        </p>
      </div>

      {/* Content */}
      {tab === "shared" ? (
        <div className="text-mid-gray text-sm border border-mid-gray/20 rounded-lg p-6 text-center">
          <Trans
            i18nKey="views.dictionary.sharedUnavailable"
            components={{ path: <span className="font-medium" /> }}
          />
        </div>
      ) : (
        <>
          <DictionarySuggestions />
          <CustomWords descriptionMode="inline" grouped={false} />
        </>
      )}
    </div>
  );
};

/**
 * Words the cleanup kept correcting in the person's own dictations, offered
 * for the dictionary. Renders nothing while loading or when the suggestions
 * could not be read: the word list below must work either way.
 */
const DictionarySuggestions: React.FC = () => {
  const { t } = useTranslation();
  const { refreshSettings } = useSettings();
  // `null`: not loaded yet, or the load failed.
  const [suggestions, setSuggestions] = useState<WordSuggestion[] | null>(null);
  // Word whose add or dismiss is running.
  const [pending, setPending] = useState<string | null>(null);
  const mounted = useRef(true);
  // Only the answer to the latest load is applied.
  const loads = useRef(0);

  const load = useCallback(async () => {
    const id = ++loads.current;
    let loaded: WordSuggestion[] | null = null;
    try {
      const result = await commands.getDictionarySuggestions();
      if (result.status === "ok") loaded = result.data ?? [];
    } catch {
      // Same as an error result: keep what is on screen.
    }
    if (!mounted.current || id !== loads.current) return;
    if (loaded) setSuggestions(loaded);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const decide = async (word: string, accept: boolean) => {
    if (pending) return;
    setPending(word);
    let saved = false;
    try {
      const result = accept
        ? await commands.acceptDictionarySuggestion(word)
        : await commands.dismissDictionarySuggestion(word);
      saved = result.status === "ok";
    } catch {
      saved = false;
    }
    if (!mounted.current) return;
    if (saved) {
      // Decided: it leaves the block even if the reload below fails.
      setSuggestions(
        (current) => current?.filter((s) => s.word !== word) ?? current,
      );
      // The word is in the dictionary now: show it in the list below.
      if (accept) await refreshSettings();
      await load();
    } else {
      toast.error(t("views.dictionary.suggestions.failed"));
    }
    if (mounted.current) setPending(null);
  };

  if (suggestions === null) return null;

  return (
    <section
      aria-label={t("views.dictionary.suggestions.title")}
      className="space-y-3"
    >
      <h2 className="font-serif italic text-2xl">
        {t("views.dictionary.suggestions.title")}
      </h2>
      {suggestions.length === 0 ? (
        <p className="text-sm text-mid-gray">
          {t("views.dictionary.suggestions.empty")}
        </p>
      ) : (
        <ul className="border border-mid-gray/20 rounded-xl divide-y divide-mid-gray/20">
          {suggestions.map(({ word, count, heard_as }) => (
            <li
              key={word}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate select-text">
                  {word}
                </div>
                {heard_as.length > 0 && (
                  <div className="text-sm text-mid-gray">
                    {t("views.dictionary.suggestions.heardAs", {
                      words: heard_as.join(", "),
                    })}
                  </div>
                )}
                <div className="text-xs text-mid-gray">
                  {t("views.dictionary.suggestions.count", { count })}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="primary-soft"
                  size="sm"
                  onClick={() => decide(word, true)}
                  disabled={pending !== null}
                  aria-label={t("views.dictionary.suggestions.addLabel", {
                    word,
                  })}
                >
                  {t("views.dictionary.suggestions.add")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => decide(word, false)}
                  disabled={pending !== null}
                  aria-label={t("views.dictionary.suggestions.dismissLabel", {
                    word,
                  })}
                >
                  {t("views.dictionary.suggestions.dismiss")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pb-2 px-1 text-sm font-medium transition-colors ${
        active
          ? "border-b-2 border-accent text-ez-text"
          : "text-mid-gray hover:text-ez-text"
      }`}
    >
      {children}
    </button>
  );
}
