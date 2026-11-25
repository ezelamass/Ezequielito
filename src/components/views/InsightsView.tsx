import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type HistoryEntry } from "@/bindings";
import {
  DEFAULT_TYPING_WPM,
  MIN_SPEECH_MS,
  appBreakdown,
  calendarWeeks,
  computeStats,
  displayAppName,
  splitHoursMinutes,
  timeSavedMinutes,
  wordsPerMinute,
  type AppBreakdown,
  type CalendarCell,
  type Stats,
} from "@/lib/insights";

/**
 * Insights view.
 *
 * Pulls every entry kept in the history table via
 * getHistoryEntries(null, null) (a numeric limit is capped at 100 by the
 * backend; `null` returns them all) and derives every number client-side
 * with the pure functions in `@/lib/insights`. Speed, time saved and the per-app
 * breakdown only count entries that carry `duration_ms` / `app_name`, which
 * older entries do not have.
 */

type Tab = "usage" | "voice";

interface Insights {
  stats: Stats;
  wpm: number | null;
  savedMinutes: number | null;
  apps: AppBreakdown;
  weeks: CalendarCell[][];
}

export const InsightsView: React.FC = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("usage");
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  // "Today" for the stats; refreshed together with the entries.
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await commands.getHistoryEntries(null, null);
        if (result.status === "ok") {
          setEntries(result.data.entries || []);
          setNow(new Date());
        }
      } catch (e) {
        console.debug("Insights fetch failed:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const insights = useMemo<Insights>(
    () => ({
      stats: computeStats(entries, now),
      wpm: wordsPerMinute(entries),
      savedMinutes: timeSavedMinutes(entries),
      apps: appBreakdown(entries),
      weeks: calendarWeeks(entries, now),
    }),
    [entries, now],
  );

  return (
    <div className="w-full max-w-5xl mx-auto py-4 space-y-6">
      <header>
        <h1 className="font-serif italic text-4xl text-ez-text">
          {t("sidebar.insights")}
        </h1>
      </header>

      <nav className="flex gap-6 border-b border-mid-gray/20">
        <TabButton active={tab === "usage"} onClick={() => setTab("usage")}>
          {t("views.insights.tabs.usage")}
        </TabButton>
        <TabButton active={tab === "voice"} onClick={() => setTab("voice")}>
          {t("views.insights.tabs.voice")}
        </TabButton>
      </nav>

      {loading ? (
        <div className="text-mid-gray text-sm">
          {t("views.insights.loading")}
        </div>
      ) : tab === "usage" ? (
        <UsageTab insights={insights} />
      ) : (
        <VoiceTab />
      )}
    </div>
  );
};

function UsageTab({ insights }: { insights: Insights }) {
  const { t } = useTranslation();
  const { stats, wpm, savedMinutes, apps, weeks } = insights;
  const notEnoughData = {
    emptyTitle: t("views.insights.notEnoughData.title"),
    emptyNote: t("views.insights.notEnoughData.description", {
      seconds: MIN_SPEECH_MS / 1000,
    }),
  };

  let savedValue: string | null = null;
  if (savedMinutes !== null) {
    const { hours, minutes } = splitHoursMinutes(savedMinutes);
    const total = hours * 60 + minutes;
    if (total <= 60) {
      savedValue = t("views.insights.timeSaved.minutes", { minutes: total });
    } else if (minutes === 0) {
      savedValue = t("views.insights.timeSaved.hours", { hours });
    } else {
      savedValue = t("views.insights.timeSaved.hoursMinutes", {
        hours,
        minutes,
      });
    }
  }

  return (
    <>
      {/* Top stat cards */}
      <section className="grid grid-cols-3 gap-4">
        <BigStatCard
          label={t("views.insights.stats.wordsDictated")}
          value={stats.totalWords.toLocaleString()}
          sublabel={
            stats.wordsChangePct !== null
              ? t("views.insights.stats.wordsChange", {
                  change: `${stats.wordsChangePct > 0 ? "+" : ""}${stats.wordsChangePct.toFixed(1)}`,
                })
              : undefined
          }
          subAccent={stats.wordsChangePct !== null && stats.wordsChangePct >= 0}
        />
        <BigStatCard
          label={t("views.insights.stats.totalDictations")}
          value={stats.totalDictations.toLocaleString()}
          sublabel={t("views.insights.stats.thisWeek", {
            count: stats.thisWeekDictations,
          })}
        />
        <BigStatCard
          label={
            stats.streak === 1
              ? t("views.insights.stats.streak")
              : t("views.insights.stats.currentStreak")
          }
          value={t("views.insights.stats.streakDays", { count: stats.streak })}
          sublabel={t("views.insights.stats.longestStreak", {
            count: stats.longestStreak,
          })}
        />
      </section>

      {/* Speed & time saved — only from entries with a recorded duration */}
      <section className="grid grid-cols-2 gap-4">
        <MetricCard
          label={t("views.insights.speed.label")}
          value={wpm !== null ? Math.round(wpm).toLocaleString() : null}
          note={t("views.insights.speed.note", { wpm: DEFAULT_TYPING_WPM })}
          {...notEnoughData}
        />
        <MetricCard
          label={t("views.insights.timeSaved.label")}
          value={savedValue}
          note={t("views.insights.timeSaved.note", {
            wpm: DEFAULT_TYPING_WPM,
          })}
          {...notEnoughData}
        />
      </section>

      {/* Streak calendar */}
      <section className="border border-mid-gray/20 rounded-xl p-5 space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif italic text-2xl">
            {stats.streak === 0
              ? t("views.insights.calendar.noStreak")
              : t("views.insights.calendar.streakTitle", {
                  count: stats.streak,
                })}
          </h2>
          <span className="text-xs uppercase tracking-wider text-mid-gray font-mono">
            {t("views.insights.calendar.bestStreak", {
              count: stats.longestStreak,
            })}
          </span>
        </div>
        <StreakCalendar weeks={weeks} />
        <div className="flex items-center gap-2 text-xs text-mid-gray">
          <span>{t("views.insights.calendar.less")}</span>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4].map((lvl) => (
              <span
                key={lvl}
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: intensityColor(lvl) }}
              />
            ))}
          </div>
          <span>{t("views.insights.calendar.more")}</span>
        </div>
      </section>

      {/* Words per app */}
      <section className="border border-mid-gray/20 rounded-xl p-5 space-y-4">
        <h2 className="font-serif italic text-2xl">
          {t("views.insights.apps.title")}
        </h2>
        <AppUsageList apps={apps} />
      </section>
    </>
  );
}

function VoiceTab() {
  const { t } = useTranslation();
  return (
    <div className="border border-dashed border-mid-gray/40 rounded-xl p-8 text-center space-y-3">
      <div className="font-serif italic text-2xl text-accent">
        {t("views.insights.voice.title")}
      </div>
      <p className="text-mid-gray text-sm max-w-xl mx-auto">
        {t("views.insights.voice.description")}
      </p>
      <div className="inline-block text-xs uppercase tracking-wider font-mono text-mid-gray border border-mid-gray/30 rounded px-2 py-1">
        {t("views.insights.comingSoon")}
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

function MetricCard({
  label,
  value,
  note,
  emptyTitle,
  emptyNote,
}: {
  label: string;
  /** `null` when there is not enough data to show a number. */
  value: string | null;
  note: string;
  emptyTitle: string;
  emptyNote: string;
}) {
  return (
    <div className="border border-mid-gray/20 rounded-xl p-5 hover:border-mid-gray/40 transition-colors">
      {value !== null ? (
        <div className="text-3xl font-light">{value}</div>
      ) : (
        <div className="font-serif italic text-xl text-mid-gray">
          {emptyTitle}
        </div>
      )}
      <div className="text-xs uppercase tracking-wider text-mid-gray mt-2">
        {label}
      </div>
      <p className="text-xs text-mid-gray mt-3">
        {value !== null ? note : emptyNote}
      </p>
    </div>
  );
}

function AppUsageList({ apps }: { apps: AppBreakdown }) {
  const { t } = useTranslation();

  if (apps.items.length === 0) {
    return (
      <p className="text-sm text-mid-gray">{t("views.insights.apps.empty")}</p>
    );
  }

  return (
    <>
      <ul className="space-y-3">
        {apps.items.map((item) => (
          // App names are never empty, so "" is free for the merged item.
          <li key={item.app ?? ""} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm truncate">
                {item.app !== null
                  ? displayAppName(item.app)
                  : t("views.insights.apps.other")}
              </span>
              <span className="text-xs text-mid-gray font-mono shrink-0">
                {t("views.insights.apps.words", {
                  count: item.words,
                  formatted: item.words.toLocaleString(),
                })}
              </span>
            </div>
            <div
              className="h-1.5 rounded-full bg-mid-gray/10 overflow-hidden"
              aria-hidden="true"
            >
              <div
                className={`h-full rounded-full ${
                  item.app !== null ? "bg-logo-primary" : "bg-mid-gray/40"
                }`}
                style={{ width: `${item.share * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      {apps.untracked > 0 && (
        <p className="text-xs text-mid-gray">
          {t("views.insights.apps.untracked", { count: apps.untracked })}
        </p>
      )}
    </>
  );
}

// Streak calendar — one column per week, rows Monday (top) to Sunday.
function StreakCalendar({ weeks }: { weeks: CalendarCell[][] }) {
  const { t } = useTranslation();
  const weekdays = [
    t("views.insights.calendar.weekdays.monday"),
    t("views.insights.calendar.weekdays.tuesday"),
    t("views.insights.calendar.weekdays.wednesday"),
    t("views.insights.calendar.weekdays.thursday"),
    t("views.insights.calendar.weekdays.friday"),
    t("views.insights.calendar.weekdays.saturday"),
    t("views.insights.calendar.weekdays.sunday"),
  ];

  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      <div className="flex flex-col gap-1 mr-2 text-xs text-mid-gray">
        {weekdays.map((label, row) => (
          <span key={row} className="h-3 leading-3">
            {label}
          </span>
        ))}
      </div>
      {weeks.map((column, ci) => (
        <div key={ci} className="flex flex-col gap-1">
          {column.map((cell, ri) =>
            cell.future ? (
              // Days that have not happened yet keep their slot but stay empty.
              <div key={ri} className="w-3 h-3 invisible" aria-hidden="true" />
            ) : (
              <div
                key={ri}
                className="w-3 h-3 rounded-sm"
                style={{
                  backgroundColor: intensityColor(intensityFor(cell.count)),
                }}
                title={t("views.insights.calendar.dayTooltip", {
                  date: cell.date.toLocaleDateString(),
                  count: cell.count,
                })}
              />
            ),
          )}
        </div>
      ))}
    </div>
  );
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
  const { t } = useTranslation();
  return (
    <div className="border border-dashed border-mid-gray/40 rounded-xl p-8 text-center space-y-3">
      <div className="font-serif italic text-2xl text-accent">{title}</div>
      <p className="text-mid-gray text-sm max-w-xl mx-auto">{description}</p>
      <div className="inline-block text-xs uppercase tracking-wider font-mono text-mid-gray border border-mid-gray/30 rounded px-2 py-1">
        {t("views.insights.comingSoon")}
      </div>
    </div>
  );
}
