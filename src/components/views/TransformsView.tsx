import React from "react";
import { Wand2 } from "lucide-react";
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
    name: "Polish",
    description: "Mejora claridad y concisión sin cambiar el significado.",
  },
  {
    id: "transform_prompt_engineer",
    name: "Prompt Engineer",
    description: "Reescribe el texto como un prompt LLM estructurado.",
  },
  {
    id: "transform_summarize",
    name: "Summarize",
    description: "Resumen en 3-5 oraciones, mismo idioma.",
  },
];

export const TransformsView: React.FC = () => {
  const { settings } = useSettings();
  const bindings = settings?.bindings || {};

  return (
    <div className="w-full max-w-4xl mx-auto py-4 space-y-6">
      <header>
        <h1 className="font-serif italic text-4xl text-ez-text">Transforms</h1>
        <p className="text-xs uppercase tracking-wider font-mono text-mid-gray mt-1">
          Beta
        </p>
      </header>

      <div className="border border-mid-gray/20 rounded-xl p-5 bg-mid-gray/5 flex items-start gap-4">
        <Wand2 className="text-accent shrink-0 mt-1" size={20} />
        <div>
          <h2 className="font-serif italic text-2xl">
            Transform funciona en cualquier app
          </h2>
          <p className="text-sm text-mid-gray max-w-2xl mt-1">
            Copiá texto en cualquier ventana, apretá el hotkey del
            transform y el LLM lo reescribe + pega.
          </p>
        </div>
      </div>

      <section className="space-y-3">
        {BUILTIN_TRANSFORMS.map((t) => {
          const binding = (bindings as any)[t.id];
          const hotkey =
            binding?.current_binding?.trim() || "Sin asignar";
          const isAssigned = hotkey !== "Sin asignar";
          return (
            <div
              key={t.id}
              className={`border rounded-xl p-5 flex items-center gap-4 transition-colors ${
                isAssigned
                  ? "border-mid-gray/20 hover:border-mid-gray/40"
                  : "border-dashed border-mid-gray/30"
              }`}
            >
              <div className="flex-1">
                <div className="font-serif italic text-2xl">{t.name}</div>
                <div className="text-sm text-mid-gray mt-1">
                  {t.description}
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
        Para asignar hotkeys: Settings → General → grupo &ldquo;Ezequielito
        shortcuts&rdquo;.
      </p>
    </div>
  );
};
