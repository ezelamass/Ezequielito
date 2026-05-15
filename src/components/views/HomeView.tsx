import React, { useEffect, useState } from "react";
import { Mic, Keyboard } from "lucide-react";
import { commands } from "@/bindings";
import { useSettings } from "../../hooks/useSettings";

/**
 * Phase 13 Home view — dashboard with stats and configured hotkeys.
 *
 * Stats are computed from the local history (paginated fetch of the
 * most recent N entries — Bundle 2 will switch to a real
 * `get_insights_stats` command with proper aggregation). Streak is
 * derived from the unique timestamps of dictations.
 */
export const HomeView: React.FC = () => {
  const { settings } = useSettings();
  const [totalWords, setTotalWords] = useState<number>(0);
  const [recentDictations, setRecentDictations] = useState<number>(0);
  const [streakDays, setStreakDays] = useState<number>(0);

  useEffect(() => {
    (async () => {
      try {
        const result = await commands.getHistoryEntries(null, 200);
        if (result.status === "ok") {
          const entries = result.data.entries || [];
          const words = entries.reduce((sum: number, e: any) => {
            const text = e.post_processed_text || e.transcription_text || "";
            return sum + text.trim().split(/\s+/).filter(Boolean).length;
          }, 0);
          setTotalWords(words);
          setRecentDictations(entries.length);
          setStreakDays(calcStreak(entries.map((e: any) => e.timestamp)));
        }
      } catch (e) {
        // Non-fatal: stats will show as 0
        console.debug("Home stats fetch failed:", e);
      }
    })();
  }, []);

  const bindings = settings?.bindings || {};
  const configuredHotkeys = Object.values(bindings)
    .filter((b: any) => b && b.current_binding && b.current_binding.trim() !== "")
    .sort((a: any, b: any) => a.name.localeCompare(b.name));

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8 py-4">
      <header className="space-y-1">
        <h1 className="font-serif italic text-5xl text-accent">Ezequielito</h1>
        <p className="text-mid-gray text-sm">Tu dictado, tu marca, tu workflow.</p>
      </header>

      {/* Stat cards */}
      <section className="grid grid-cols-3 gap-4">
        <StatCard label="Palabras dictadas" value={totalWords.toLocaleString()} />
        <StatCard label="Dictados recientes" value={recentDictations.toString()} />
        <StatCard label="Racha" value={`${streakDays} día${streakDays === 1 ? "" : "s"}`} />
      </section>

      {/* Hotkey cheatsheet */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Keyboard size={18} />
          <h2 className="font-serif italic text-2xl">Tus hotkeys</h2>
        </div>
        {configuredHotkeys.length === 0 ? (
          <div className="text-mid-gray text-sm border border-mid-gray/20 rounded-lg p-4">
            No tenés hotkeys asignados todavía. Andá a{" "}
            <span className="font-medium">Settings → General</span> para configurar
            tu primer transcribe shortcut.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {configuredHotkeys.map((b: any) => (
              <div
                key={b.id}
                className="flex items-center justify-between border border-mid-gray/20 rounded-lg p-3"
              >
                <span className="text-sm truncate" title={b.description}>
                  {b.name}
                </span>
                <kbd className="font-mono text-xs bg-mid-gray/20 px-2 py-1 rounded">
                  {b.current_binding}
                </kbd>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Quick-start CTA */}
      <section className="border border-accent/40 rounded-lg p-5 flex items-center gap-4 hover:border-accent/70 transition-colors">
        <Mic size={32} className="text-accent shrink-0" />
        <div className="flex-1">
          <p className="font-medium">Para empezar a dictar</p>
          <p className="text-sm text-mid-gray">
            Mantené apretado tu hotkey de transcribe y hablá. Soltá para que
            transcriba y pegue.
          </p>
        </div>
      </section>
    </div>
  );
};

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-mid-gray/20 rounded-xl p-5 hover:border-mid-gray/40 transition-colors">
      <div className="text-3xl font-light">{value}</div>
      <div className="text-xs uppercase tracking-wider text-mid-gray mt-2">
        {label}
      </div>
    </div>
  );
}

/**
 * Streak = number of consecutive days (counting back from today) that have
 * at least one entry. Tolerant of timezones: groups by local-time YYYY-MM-DD.
 */
function calcStreak(timestamps: number[]): number {
  if (timestamps.length === 0) return 0;
  const days = new Set(
    timestamps.map((ts) => {
      const d = new Date(ts * 1000);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }),
  );
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (days.has(key)) streak++;
    else if (i > 0) break; // tolerate "no entry today" but not earlier gaps
  }
  return streak;
}
