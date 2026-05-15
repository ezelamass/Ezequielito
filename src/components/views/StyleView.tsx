import React, { useState } from "react";
import { Check } from "lucide-react";
import { useSettings } from "../../hooks/useSettings";

/**
 * Phase 15 (Bundle 3) — Style view.
 *
 * Maps Wispr Flow's "Style per context" UX onto our existing
 * `app_prompt_map` (Phase 11). Each tab represents a category of apps;
 * picking a style card (Formal / Casual / very casual) updates the
 * prompt assignment for ALL apps in that category at once.
 *
 * The user's `transcribe_auto` binding picks the right prompt for the
 * foreground app via `app_prompt_map`, so the wiring just works:
 * select "Formal" for Email → app_prompt_map[outlook]=ez_formal →
 * dictating into Outlook with transcribe_auto uses the formal prompt.
 */

type StyleId = "ez_formal" | "ez_casual" | "ez_very_casual";
type CategoryId = "personal" | "work" | "email" | "other" | "auto_cleanup";

interface Category {
  id: CategoryId;
  label: string;
  apps: string[]; // lowercase exe names without .exe
  description: string;
}

const CATEGORIES: Category[] = [
  {
    id: "personal",
    label: "Personal messages",
    apps: ["whatsapp", "telegram", "signal", "discord", "messenger", "skype"],
    description: "Aplica en mensajeros personales.",
  },
  {
    id: "work",
    label: "Work messages",
    apps: ["slack", "teams"],
    description: "Aplica en mensajeros de trabajo.",
  },
  {
    id: "email",
    label: "Email",
    apps: ["outlook", "olk", "msoutlook", "thunderbird"],
    description: "Aplica en clientes de mail.",
  },
  {
    id: "other",
    label: "Other",
    apps: [
      "claude",
      "cursor",
      "code",
      "windsurf",
      "notion",
      "chrome",
      "firefox",
      "edge",
    ],
    description:
      "Apps de productividad / browsers / IDEs. Si querés todo en code, asignalo manualmente en App Prompt Map en Advanced.",
  },
  {
    id: "auto_cleanup",
    label: "Auto Cleanup",
    apps: [],
    description: "Limpieza automática sin LLM — próximo bundle.",
  },
];

const STYLES: Array<{
  id: StyleId;
  title: string;
  subtitle: string;
  example: string;
}> = [
  {
    id: "ez_formal",
    title: "Formal",
    subtitle: "Caps + Puntuación",
    example:
      "Hola, ¿estás libre para almorzar mañana? Avisame si las 12 te funciona.",
  },
  {
    id: "ez_casual",
    title: "Casual",
    subtitle: "Caps + Poca puntuación",
    example: "Hola estás libre para almorzar mañana? las 12 si te funciona",
  },
  {
    id: "ez_very_casual",
    title: "very casual",
    subtitle: "Sin caps + poca puntuación",
    example: "hola estás libre para almorzar mañana? las 12 si te funciona",
  },
];

export const StyleView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<CategoryId>("personal");
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const map = (getSetting("app_prompt_map") || {}) as {
    [key: string]: string;
  };

  // What style is currently picked for this category? Inspect the first app
  // in the list; if all apps in the category share the same prompt id, that's
  // the active style. Otherwise show "mixed" (no card highlighted).
  const activeCategory = CATEGORIES.find((c) => c.id === activeTab)!;
  const activeStyleId = (() => {
    if (activeCategory.apps.length === 0) return null;
    const first = map[activeCategory.apps[0]];
    if (!first) return null;
    const allSame = activeCategory.apps.every((a) => map[a] === first);
    return allSame ? (first as StyleId) : null;
  })();

  const handlePickStyle = (style: StyleId) => {
    if (activeCategory.apps.length === 0) return;
    const next = { ...map };
    for (const app of activeCategory.apps) {
      next[app] = style;
    }
    updateSetting("app_prompt_map", next);
  };

  return (
    <div className="w-full max-w-5xl mx-auto py-4 space-y-6">
      <header>
        <h1 className="font-serif italic text-4xl text-ez-text">Style</h1>
      </header>

      {/* Tabs */}
      <nav className="flex gap-6 border-b border-mid-gray/20 overflow-x-auto">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActiveTab(c.id)}
            className={`pb-2 px-1 text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === c.id
                ? "border-b-2 border-accent text-ez-text"
                : "text-mid-gray hover:text-ez-text"
            }`}
          >
            {c.label}
            {c.id === "auto_cleanup" && (
              <span className="ml-2 text-xs uppercase tracking-wider font-mono text-mid-gray">
                Beta
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Header card per tab */}
      <div className="border border-mid-gray/20 rounded-xl p-5 bg-mid-gray/5">
        <h2 className="font-serif italic text-2xl mb-1">
          {activeCategory.description.split(".")[0]}.
        </h2>
        {activeCategory.apps.length > 0 && (
          <p className="text-xs text-mid-gray font-mono mt-2">
            Apps: {activeCategory.apps.slice(0, 10).join(" · ")}
          </p>
        )}
      </div>

      {/* Style cards */}
      {activeTab === "auto_cleanup" ? (
        <div className="border border-dashed border-mid-gray/40 rounded-xl p-8 text-center">
          <p className="text-mid-gray text-sm">
            Auto Cleanup todavía no está implementado. Por ahora todos los
            dictados pasan por el LLM si tenés post-processing activo.
          </p>
        </div>
      ) : (
        <section className="grid grid-cols-3 gap-4">
          {STYLES.map((s) => {
            const isSelected = activeStyleId === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => handlePickStyle(s.id)}
                disabled={isUpdating("app_prompt_map")}
                className={`text-left border rounded-xl p-5 transition-all ${
                  isSelected
                    ? "border-accent bg-accent/5"
                    : "border-mid-gray/20 hover:border-mid-gray/40"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-serif italic text-2xl text-ez-text">
                      {s.title}
                    </div>
                    <div className="text-xs text-mid-gray mt-1">
                      {s.subtitle}
                    </div>
                  </div>
                  {isSelected && (
                    <Check className="text-accent shrink-0" size={18} />
                  )}
                </div>
                <div className="mt-5 text-sm text-mid-gray leading-relaxed border-t border-mid-gray/20 pt-3">
                  {s.example}
                </div>
              </button>
            );
          })}
        </section>
      )}

      {activeStyleId === null && activeTab !== "auto_cleanup" && (
        <p className="text-xs text-mid-gray">
          Style mixto en este contexto. Hacé click en una card para uniformar.
        </p>
      )}
    </div>
  );
};
