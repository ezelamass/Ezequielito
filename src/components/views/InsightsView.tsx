import React from "react";

/**
 * Phase 13 placeholder. Bundle 2 (Phase 14) will populate this with
 * real stats from a `get_insights_stats` tauri command + a streak
 * calendar grid + Desktop usage breakdown.
 */
export const InsightsView: React.FC = () => {
  return (
    <div className="w-full max-w-4xl mx-auto py-4 space-y-6">
      <header>
        <h1 className="font-serif italic text-4xl text-ez-text">Insights</h1>
      </header>

      <ComingSoonCard
        title="Stats y racha"
        description="WPM promedio, fixes hechos, total de palabras dictadas, racha calendar grid y desglose de uso por app. Necesita instrumentación backend (duration, word count, fixes_applied, active_app per dictation) — Bundle 2."
      />
    </div>
  );
};

export function ComingSoonCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="border border-dashed border-mid-gray/40 rounded-xl p-8 text-center space-y-3">
      <div className="font-serif italic text-2xl text-accent">
        {title}
      </div>
      <p className="text-mid-gray text-sm max-w-xl mx-auto">{description}</p>
      <div className="inline-block text-xs uppercase tracking-wider font-mono text-mid-gray border border-mid-gray/30 rounded px-2 py-1">
        Próximamente
      </div>
    </div>
  );
}
