import React, { useEffect, useMemo, useState } from "react";
import { commands } from "@/bindings";

/**
 * Phase 14 (Bundle 2) — Insights view.
 *
 * Frontend-only: pulls the last N=500 entries from the existing history
 * table via getHistoryEntries(null, N) and computes stats client-side.
 * No backend schema migration — keeps the change low-risk. Categories
 * marked "instrumentation pending" (WPM, app breakdown) will be filled
 * in a follow-up bundle that captures duration_ms / active_app per
 * dictation.
 */

type Tab = "usage" | "voice";

interface Entry {
  id: number;
  timestamp: number; // unix seconds
  transcription_text: string;
  post_processed_text: string | null;
}

export const InsightsView: React.FC = () => {
  const [tab, setTab] = useState<Tab>("usage");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await commands.getHistoryEntries(null, 500);
        if (result.status === "ok") {
          setEntries((result.data.entries || []) as Entry[]);
        }
      } catch (e) {
        console.debug("Insights fetch failed:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stats = useMemo(() => computeStats(entries), [entries]);

  return (
    <div className="w-full max-w-5xl mx-auto py-4 space-y-6">
      <header>
        <h1 className="font-serif italic text-4xl text-ez-text">Insights</h1>
      </header>

      <nav className="flex gap-6 border-b border-mid-gray/20">
        <TabButton active={tab === "usage"} onClick={() => setTab("usage")}>
          Tu uso
        </TabButton>
        <TabButton active={tab === "voice"} onClick={() => setTab("voice")}>
          Tu voz
        </TabButton>
      </nav>

      {loading ? (
        <div className="text-mid-gray text-sm">Cargando stats...</div>
      ) : tab === "usage" ? (
        <UsageTab stats={stats} entries={entries} />
      ) : (
        <VoiceTab />
      )}
    </div>
  );
};

function UsageTab({ stats, entries }: { stats: Stats; entries: Entry[] }) {
  return (
    <>
      {/* Top stat cards */}
      <section className="grid grid-cols-3 gap-4">
        <BigStatCard
          label="Palabras dictadas"
          value={stats.totalWords.toLocaleString()}
          sublabel={
            stats.wordsChangePct !== null
              ? `${stats.wordsChangePct > 0 ? "+" : ""}${stats.wordsChangePct.toFixed(1)}% este mes`
              : undefined
          }
          subAccent={stats.wordsChangePct !== null && stats.wordsChangePct >= 0}
        />
        <BigStatCard
          label="Dictados totales"
          value={stats.totalDictations.toLocaleString()}
          sublabel={`${stats.thisWeekDictations} esta semana`}
        />
        <BigStatCard
          label={`Racha ${stats.streak === 1 ? "" : "actual"}`}
          value={`${stats.streak} ${stats.streak === 1 ? "día" : "días"}`}
          sublabel={`Más larga: ${stats.longestStreak} días`}
        />
      </section>

      {/* WPM & Fixes — instrumentation pending */}
      <section className="grid grid-cols-2 gap-4">
        <PendingCard
          title="Words per minute"
          description="Requiere capturar la duración de cada recording. Próximo bundle."
        />
        <PendingCard
          title="Fixes aplicados"
          description="Requiere contador de custom_words + snippets substituciones por dictado. Próximo bundle."
        />
      </section>

      {/* Streak calendar */}
      <section className="border border-mid-gray/20 rounded-xl p-5 space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif italic text-2xl">
            {stats.streak === 0 ? "Sin racha activa" : `${stats.streak} día${stats.streak === 1 ? "" : "s"} de racha`}
          </h2>
          <span className="text-xs uppercase tracking-wider text-mid-gray font-mono">
            Mejor racha · {stats.longestStreak} días
          </span>
        </div>
        <StreakCalendar entries={entries} />
        <div className="flex items-center gap-2 text-xs text-mid-gray">
          <span>Menos</span>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4].map((lvl) => (
              <span
                key={lvl}
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: intensityColor(lvl) }}
              />
            ))}
          </div>
          <span>Más</span>
        </div>
      </section>
    </>
  );
}

function VoiceTab() {
  return (
    <div className="border border-dashed border-mid-gray/40 rounded-xl p-8 text-center space-y-3">
      <div className="font-serif italic text-2xl text-accent">Voice analytics</div>
      <p className="text-mid-gray text-sm max-w-xl mx-auto">
        Acento detectado, velocidad de habla, idiomas más usados.
        Requiere instrumentación adicional del recorder. Próximo bundle.
      </p>
      <div className="inline-block text-xs uppercase tracking-wider font-mono text-mid-gray border border-mid-gray/30 rounded px-2 py-1">
        Próximamente
      </div>
    </div>
  );
}

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

function BigStatCard({
  label,
  value,
  sublabel,
  subAccent,
}: {
  label: string;
  value: string;
  sublabel?: string;
  subAccent?: boolean;
}) {
  return (
    <div className="border border-mid-gray/20 rounded-xl p-5 hover:border-mid-gray/40 transition-colors">
      <div className="text-3xl font-light">{value}</div>
      <div className="text-xs uppercase tracking-wider text-mid-gray mt-2">
        {label}
      </div>
      {sublabel && (
        <div
          className={`text-xs mt-3 inline-block px-2 py-0.5 rounded-full ${
            subAccent
              ? "bg-accent/15 text-accent"
              : "bg-mid-gray/10 text-mid-gray"
          }`}
        >
          {sublabel}
        </div>
      )}
    </div>
  );
}

function PendingCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="border border-dashed border-mid-gray/40 rounded-xl p-5">
      <div className="text-mid-gray text-xs uppercase tracking-wider mb-2">
        {title}
      </div>
      <div className="font-serif italic text-xl text-mid-gray">—</div>
      <p className="text-xs text-mid-gray mt-3">{description}</p>
    </div>
  );
}

// Streak calendar — last 16 weeks × 7 days
function StreakCalendar({ entries }: { entries: Entry[] }) {
  const dayCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      const d = new Date(e.timestamp * 1000);
      const key = dayKey(d);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [entries]);

  const today = new Date();
  const weeks = 16;
  // Build a grid: 7 rows (days Sun..Sat) × N columns (weeks, oldest left)
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - weeks * 7 + 1);

  const columns: Array<Array<{ date: Date; count: number }>> = [];
  for (let w = 0; w < weeks; w++) {
    const col: Array<{ date: Date; count: number }> = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + w * 7 + d);
      col.push({ date, count: dayCounts.get(dayKey(date)) || 0 });
    }
    columns.push(col);
  }

  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      <div className="flex flex-col gap-1 mr-2 justify-around text-xs text-mid-gray">
        <span>L</span>
        <span>M</span>
        <span>M</span>
        <span>J</span>
        <span>V</span>
        <span>S</span>
        <span>D</span>
      </div>
      {columns.map((col, ci) => (
        <div key={ci} className="flex flex-col gap-1">
          {col.map((cell, ri) => (
            <div
              key={ri}
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: intensityColor(intensityFor(cell.count)) }}
              title={`${cell.date.toLocaleDateString()} · ${cell.count} dictado${cell.count === 1 ? "" : "s"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

interface Stats {
  totalWords: number;
  totalDictations: number;
  thisWeekDictations: number;
  wordsChangePct: number | null;
  streak: number;
  longestStreak: number;
}

function computeStats(entries: Entry[]): Stats {
  if (entries.length === 0) {
    return {
      totalWords: 0,
      totalDictations: 0,
      thisWeekDictations: 0,
      wordsChangePct: null,
      streak: 0,
      longestStreak: 0,
    };
  }

  const totalWords = entries.reduce((sum, e) => sum + wordCount(text(e)), 0);
  const totalDictations = entries.length;

  const now = Date.now() / 1000;
  const weekAgo = now - 7 * 24 * 60 * 60;
  const thisWeekDictations = entries.filter((e) => e.timestamp >= weekAgo).length;

  // % change in word count: this 30 days vs prev 30 days
  const day30 = now - 30 * 24 * 60 * 60;
  const day60 = now - 60 * 24 * 60 * 60;
  const wordsLast30 = entries
    .filter((e) => e.timestamp >= day30)
    .reduce((s, e) => s + wordCount(text(e)), 0);
  const wordsPrev30 = entries
    .filter((e) => e.timestamp >= day60 && e.timestamp < day30)
    .reduce((s, e) => s + wordCount(text(e)), 0);
  const wordsChangePct =
    wordsPrev30 > 0 ? ((wordsLast30 - wordsPrev30) / wordsPrev30) * 100 : null;

  // streak — consecutive days back from today w/ at least one entry
  const days = new Set(entries.map((e) => dayKey(new Date(e.timestamp * 1000))));
  let streak = 0;
  let longestStreak = 0;
  // current streak
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (days.has(dayKey(d))) streak++;
    else if (i > 0) break;
  }
  // longest streak ever
  const sortedDayKeys = Array.from(days).sort();
  let current = 0;
  let prevKey: string | null = null;
  for (const key of sortedDayKeys) {
    if (prevKey === null) {
      current = 1;
    } else {
      const prev = new Date(prevKey);
      const cur = new Date(key);
      const diff = (cur.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000);
      if (Math.round(diff) === 1) current++;
      else current = 1;
    }
    if (current > longestStreak) longestStreak = current;
    prevKey = key;
  }

  return {
    totalWords,
    totalDictations,
    thisWeekDictations,
    wordsChangePct,
    streak,
    longestStreak,
  };
}

function text(e: Entry): string {
  return e.post_processed_text || e.transcription_text || "";
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function intensityFor(count: number): number {
  if (count === 0) return 0;
  if (count <= 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

function intensityColor(level: number): string {
  // Lime accent at high intensity, muted at low
  const colors = [
    "rgba(232, 228, 222, 0.06)", // 0: bg-mid-gray/5-ish
    "rgba(200, 255, 0, 0.18)",
    "rgba(200, 255, 0, 0.42)",
    "rgba(200, 255, 0, 0.72)",
    "rgba(200, 255, 0, 1)",
  ];
  return colors[Math.max(0, Math.min(4, level))];
}

// Keep ComingSoonCard exported so the other placeholder views still import it
export function ComingSoonCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="border border-dashed border-mid-gray/40 rounded-xl p-8 text-center space-y-3">
      <div className="font-serif italic text-2xl text-accent">{title}</div>
      <p className="text-mid-gray text-sm max-w-xl mx-auto">{description}</p>
      <div className="inline-block text-xs uppercase tracking-wider font-mono text-mid-gray border border-mid-gray/30 rounded px-2 py-1">
        Próximamente
      </div>
    </div>
  );
}
