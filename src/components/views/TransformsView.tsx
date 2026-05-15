import React from "react";
import { ComingSoonCard } from "./InsightsView";

export const TransformsView: React.FC = () => {
  return (
    <div className="w-full max-w-4xl mx-auto py-4 space-y-6">
      <header>
        <h1 className="font-serif italic text-4xl text-ez-text">Transforms</h1>
        <p className="text-xs uppercase tracking-wider font-mono text-mid-gray mt-1">
          Beta
        </p>
      </header>

      <ComingSoonCard
        title="Hotkey-bound text transforms"
        description="Win+Alt+1, Win+Alt+2, ..., Win+Alt+5. Cada hotkey aplica un prompt LLM a la selección actual de cualquier app. Defaults: Polish (clarity & concision) + Prompt Engineer. Crearás los tuyos. Generaliza el Edit Mode existente — Bundle 3."
      />
    </div>
  );
};
