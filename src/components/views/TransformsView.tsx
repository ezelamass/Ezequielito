import React from "react";
import { Wand2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";

/**
 * Phase 15 (Bundle 3) — Transforms view.
 *
 * Read-only list of the 3 built-in clipboard transforms. Each shows its
 * configured hotkey (read from settings.bindings) and a one-line
 * description. To rebind: Settings → General → Ezequielito shortcuts.
 *
 * Behaviour (see actions.rs::TransformAction): user copies text → presses
 * the transform's hotkey → app reads clipboard, sends to the configured
 * post-process LLM with the transform's prompt, pastes result.
 */

const BUILTIN_TRANSFORMS = [
  {
    id: "transform_polish",
    nameKey: "views.transforms.builtin.polish.name",
    descriptionKey: "views.transforms.builtin.polish.description",
  },
  {
    id: "transform_prompt_engineer",
    nameKey: "views.transforms.builtin.promptEngineer.name",
    descriptionKey: "views.transforms.builtin.promptEngineer.description",
  },
  {
    id: "transform_summarize",
    nameKey: "views.transforms.builtin.summarize.name",
    descriptionKey: "views.transforms.builtin.summarize.description",
  },
];

export const TransformsView: React.FC = () => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const bindings = settings?.bindings || {};

  return (
    <div className="w-full max-w-4xl mx-auto py-4 space-y-6">
      <header>
        <h1 className="font-serif italic text-4xl text-ez-text">
          {t("sidebar.transforms")}
        </h1>
        <p className="text-xs uppercase tracking-wider font-mono text-mid-gray mt-1">
          {t("views.transforms.beta")}
        </p>
      </header>

      <div className="border border-mid-gray/20 rounded-xl p-5 bg-mid-gray/5 flex items-start gap-4">
        <Wand2 className="text-accent shrink-0 mt-1" size={20} />
        <div>
          <h2 className="font-serif italic text-2xl">
            {t("views.transforms.intro.title")}
          </h2>
          <p className="text-sm text-mid-gray max-w-2xl mt-1">
            {t("views.transforms.intro.description")}
          </p>
        </div>
      </div>

      <section className="space-y-3">
        {BUILTIN_TRANSFORMS.map((transform) => {
          const binding = (bindings as any)[transform.id];
          const unassigned = t("views.transforms.unassigned");
          const hotkey = binding?.current_binding?.trim() || unassigned;
          const isAssigned = hotkey !== unassigned;
          return (
            <div
              key={transform.id}
              className={`border rounded-xl p-5 flex items-center gap-4 transition-colors ${
                isAssigned
                  ? "border-mid-gray/20 hover:border-mid-gray/40"
                  : "border-dashed border-mid-gray/30"
              }`}
            >
              <div className="flex-1">
                <div className="font-serif italic text-2xl">
                  {t(transform.nameKey)}
                </div>
                <div className="text-sm text-mid-gray mt-1">
                  {t(transform.descriptionKey)}
                </div>
              </div>
              <kbd
                className={`font-mono text-xs px-3 py-1.5 rounded ${
                  isAssigned
                    ? "bg-accent/15 text-accent border border-accent/30"
                    : "bg-mid-gray/10 text-mid-gray border border-mid-gray/30"
                }`}
              >
                {hotkey}
              </kbd>
            </div>
          );
        })}
      </section>

      <p className="text-xs text-mid-gray">
        {t("views.transforms.assignHint")}
      </p>
    </div>
  );
};
