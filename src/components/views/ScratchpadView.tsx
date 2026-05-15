import React from "react";
import { ComingSoonCard } from "./InsightsView";

export const ScratchpadView: React.FC = () => {
  return (
    <div className="w-full max-w-4xl mx-auto py-4 space-y-6">
      <header>
        <h1 className="font-serif italic text-4xl text-ez-text">Scratchpad</h1>
      </header>

      <ComingSoonCard
        title="Editor libre con dictado in-place"
        description="Toggle 'Send dictations here' que redirige tus dictados al scratchpad en vez de la app activa. Útil para drafts largos antes de copiar afuera. Persiste entre sesiones (localStorage). Botones Copy all + Clear — Bundle 4."
      />
    </div>
  );
};
