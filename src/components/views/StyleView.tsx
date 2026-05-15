import React from "react";
import { ComingSoonCard } from "./InsightsView";

export const StyleView: React.FC = () => {
  return (
    <div className="w-full max-w-4xl mx-auto py-4 space-y-6">
      <header>
        <h1 className="font-serif italic text-4xl text-ez-text">Style</h1>
      </header>

      <ComingSoonCard
        title="Style por contexto"
        description="Tabs por contexto (Personal messages / Work / Email / Other / Auto Cleanup). Cada tab te deja elegir entre Formal / Casual / very casual, que se aplican según la app en foreground. Reutiliza el sistema de app_prompt_map de Phase 11 con UI cleaner — Bundle 3."
      />
    </div>
  );
};
