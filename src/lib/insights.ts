import type { HistoryEntry } from "@/bindings";

/**
 * Pure statistics for the Insights screen.
 *
 * Nothing here touches React or the clock: every function that depends on
 * "today" takes `now` as a parameter, so the results are reproducible in
 * tests. Days are bucketed in the local time zone of the machine, which is
 * what the user sees on the calendar.
 */

/** The fields of a history entry that the Insights statistics read. */
export type InsightsEntry = Pick<
  HistoryEntry,
  | "timestamp"
  | "transcription_text"
  | "post_processed_text"
  | "duration_ms"
  | "app_name"
>;

/** Below this much recorded speech, speed and time saved are not reported. */
export const MIN_SPEECH_MS = 30_000;

/** Typing speed that dictation is compared against, in words per minute. */
export const DEFAULT_TYPING_WPM = 40;

const DAY_SECONDS = 24 * 60 * 60;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = DAY_SECONDS * 1000;

export interface Stats {
  totalWords: number;
  totalDictations: number;
  /** Dictations in the 7 days before `now`. */
  thisWeekDictations: number;
  /** Words in the last 30 days against the 30 before; null with no baseline. */
  wordsChangePct: number | null;
  /** Consecutive days with a dictation, counting back from today. */
  streak: number;
  longestStreak: number;
}

export interface AppUsage {
  /** Lowercased app name, or `null` for the merged "other" item. */
  app: string | null;
  words: number;
  dictations: number;
  /** Fraction (0 to 1) of the words of all entries that have an app. */
  share: number;
}

export interface AppBreakdown {
  /** Apps sorted by words, largest first; "other" (`app: null`) goes last. */
  items: AppUsage[];
  /** Entries with no app recorded, which are left out of `items`. */
  untracked: number;
}

export interface CalendarCell {
  date: Date;
  /** Dictations on that day; always 0 for future cells. */
  count: number;
  /** True for the days of the current week that come after today. */
  future: boolean;
}

/** The text that was actually pasted: post-processed when there is one. */
export function entryText(entry: InsightsEntry): string {
  return entry.post_processed_text || entry.transcription_text || "";
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Local calendar day as `YYYY-MM-DD`. */
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const entryWords = (entry: InsightsEntry): number =>
  wordCount(entryText(entry));

const entryDay = (entry: InsightsEntry): string =>
  dayKey(new Date(entry.timestamp * 1000));

const sumWords = (entries: InsightsEntry[]): number =>
  entries.reduce((sum, entry) => sum + entryWords(entry), 0);

/** `date` moved by whole calendar days, at local midnight (DST-safe). */
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Days between two `YYYY-MM-DD` keys, independent of time zone and DST. */
function daysBetween(fromKey: string, toKey: string): number {
  const toUtc = (key: string): number => {
    const [year, month, day] = key.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(toKey) - toUtc(fromKey)) / MS_PER_DAY);
}

export function computeStats(entries: InsightsEntry[], now: Date): Stats {
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

  const nowSeconds = now.getTime() / 1000;
  const weekAgo = nowSeconds - 7 * DAY_SECONDS;
  const day30 = nowSeconds - 30 * DAY_SECONDS;
  const day60 = nowSeconds - 60 * DAY_SECONDS;

  const wordsLast30 = sumWords(entries.filter((e) => e.timestamp >= day30));
  const wordsPrev30 = sumWords(
    entries.filter((e) => e.timestamp >= day60 && e.timestamp < day30),
  );

  const days = new Set(entries.map(entryDay));

  // Current streak: walk back from today. A day without dictations ends it,
  // except today itself, which may simply not have happened yet.
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    if (days.has(dayKey(addDays(now, -i)))) streak++;
    else if (i > 0) break;
  }

  let longestStreak = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of Array.from(days).sort()) {
    run = previous !== null && daysBetween(previous, key) === 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
    previous = key;
  }

  return {
    totalWords: sumWords(entries),
    totalDictations: entries.length,
    thisWeekDictations: entries.filter((e) => e.timestamp >= weekAgo).length,
    wordsChangePct:
      wordsPrev30 > 0
        ? ((wordsLast30 - wordsPrev30) / wordsPrev30) * 100
        : null,
    streak,
    longestStreak,
  };
}

/** Words and speech time of the entries whose duration was recorded. */
function timedTotals(entries: InsightsEntry[]): {
  words: number;
  durationMs: number;
} {
  let words = 0;
  let durationMs = 0;
  for (const entry of entries) {
    const duration = entry.duration_ms;
    if (duration === null || !(duration > 0)) continue;
    words += entryWords(entry);
    durationMs += duration;
  }
  return { words, durationMs };
}

/**
 * Speaking speed: total words over total minutes of speech, counting only
 * entries with a recorded duration. `null` under `MIN_SPEECH_MS` of speech.
 */
export function wordsPerMinute(entries: InsightsEntry[]): number | null {
  const { words, durationMs } = timedTotals(entries);
  if (durationMs < MIN_SPEECH_MS) return null;
  return words / (durationMs / MS_PER_MINUTE);
}

/**
 * Minutes saved against typing the same words at `typingWpm`, counting only
 * entries with a recorded duration. Never negative. `null` under
 * `MIN_SPEECH_MS` of speech, or when `typingWpm` is not a positive number.
 */
export function timeSavedMinutes(
  entries: InsightsEntry[],
  typingWpm: number = DEFAULT_TYPING_WPM,
): number | null {
  if (!(typingWpm > 0)) return null;
  const { words, durationMs } = timedTotals(entries);
  if (durationMs < MIN_SPEECH_MS) return null;
  return Math.max(0, words / typingWpm - durationMs / MS_PER_MINUTE);
}

/**
 * Words and dictations per app. Entries with no app are counted in
 * `untracked` and left out. Apps past `limit` are merged into a single
 * trailing item with `app: null`.
 */
export function appBreakdown(
  entries: InsightsEntry[],
  limit: number = 6,
): AppBreakdown {
  const byApp = new Map<string, { words: number; dictations: number }>();
  let untracked = 0;
  let trackedWords = 0;

  for (const entry of entries) {
    const app = entry.app_name?.trim();
    if (!app) {
      untracked++;
      continue;
    }
    const words = entryWords(entry);
    const current = byApp.get(app) ?? { words: 0, dictations: 0 };
    current.words += words;
    current.dictations += 1;
    byApp.set(app, current);
    trackedWords += words;
  }

  const share = (words: number): number =>
    trackedWords > 0 ? words / trackedWords : 0;

  const sorted = Array.from(byApp, ([app, usage]) => ({ app, ...usage })).sort(
    (a, b) =>
      b.words - a.words ||
      b.dictations - a.dictations ||
      a.app.localeCompare(b.app),
  );

  const keep = Math.max(0, Math.floor(limit));
  const items: AppUsage[] = sorted
    .slice(0, keep)
    .map((usage) => ({ ...usage, share: share(usage.words) }));

  const rest = sorted.slice(keep);
  if (rest.length > 0) {
    const words = rest.reduce((sum, usage) => sum + usage.words, 0);
    const dictations = rest.reduce((sum, usage) => sum + usage.dictations, 0);
    items.push({ app: null, words, dictations, share: share(words) });
  }

  return { items, untracked };
}

/**
 * Grid for the streak calendar: `weeks` columns of 7 cells, oldest week
 * first. Row 0 is always Monday and row 6 Sunday; the last column is the
 * week that contains `now`, with the days after today marked `future`.
 */
export function calendarWeeks(
  entries: InsightsEntry[],
  now: Date,
  weeks: number = 16,
): CalendarCell[][] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = entryDay(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const today = addDays(now, 0);
  // getDay() is 0 for Sunday; shift it so Monday is 0 and Sunday is 6.
  const daysSinceMonday = (today.getDay() + 6) % 7;
  const columnCount = Math.max(0, Math.floor(weeks));
  const firstMonday = addDays(today, -daysSinceMonday - (columnCount - 1) * 7);

  const columns: CalendarCell[][] = [];
  for (let week = 0; week < columnCount; week++) {
    const column: CalendarCell[] = [];
    for (let row = 0; row < 7; row++) {
      const date = addDays(firstMonday, week * 7 + row);
      const future = date.getTime() > today.getTime();
      column.push({
        date,
        count: future ? 0 : (counts.get(dayKey(date)) ?? 0),
        future,
      });
    }
    columns.push(column);
  }
  return columns;
}

/** "google chrome" becomes "Google Chrome", for display only. */
export function displayAppName(app: string): string {
  return app
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Rounds to whole minutes and splits them into hours and minutes. */
export function splitHoursMinutes(totalMinutes: number): {
  hours: number;
  minutes: number;
} {
  const rounded = Math.max(0, Math.round(totalMinutes));
  return { hours: Math.floor(rounded / 60), minutes: rounded % 60 };
}
