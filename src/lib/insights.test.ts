import { describe, expect, test } from "bun:test";
import {
  appBreakdown,
  calendarWeeks,
  computeStats,
  dayKey,
  displayAppName,
  splitHoursMinutes,
  timeSavedMinutes,
  wordsPerMinute,
  type InsightsEntry,
} from "./insights";

/** Unix seconds for a local date; month is 1-based here. */
function at(year: number, month: number, day: number, hour = 12): number {
  return Math.floor(new Date(year, month - 1, day, hour).getTime() / 1000);
}

function entry(overrides: Partial<InsightsEntry> = {}): InsightsEntry {
  return {
    timestamp: at(2026, 11, 25),
    transcription_text: "",
    post_processed_text: null,
    duration_ms: null,
    app_name: null,
    ...overrides,
  };
}

/** A string of `count` words. */
const words = (count: number): string =>
  Array.from({ length: count }, (_, i) => `w${i}`).join(" ");

// 2026-11-23 is a Monday, so 23..29 covers one day of each weekday.
const WEEK_OF_NOV_23 = [23, 24, 25, 26, 27, 28, 29];
const WEDNESDAY = new Date(2026, 10, 25, 15, 30);

describe("computeStats", () => {
  test("returns zeros and no change for an empty history", () => {
    expect(computeStats([], WEDNESDAY)).toEqual({
      totalWords: 0,
      totalDictations: 0,
      thisWeekDictations: 0,
      wordsChangePct: null,
      streak: 0,
      longestStreak: 0,
    });
  });

  test("counts the post-processed text when there is one", () => {
    const stats = computeStats(
      [
        entry({ transcription_text: "one two three" }),
        entry({
          transcription_text: "um so one two three four five",
          post_processed_text: "One two.",
        }),
        entry({ transcription_text: "raw text", post_processed_text: "" }),
      ],
      WEDNESDAY,
    );
    expect(stats.totalWords).toBe(3 + 2 + 2);
    expect(stats.totalDictations).toBe(3);
  });

  test("counts the dictations of the 7 days before now", () => {
    const stats = computeStats(
      [
        entry({ timestamp: at(2026, 11, 25, 9) }),
        entry({ timestamp: at(2026, 11, 19, 9) }),
        entry({ timestamp: at(2026, 11, 17, 9) }),
      ],
      WEDNESDAY,
    );
    expect(stats.thisWeekDictations).toBe(2);
  });

  test("compares the words of the last 30 days with the 30 before", () => {
    const stats = computeStats(
      [
        entry({ timestamp: at(2026, 11, 20), transcription_text: words(150) }),
        entry({ timestamp: at(2026, 10, 10), transcription_text: words(100) }),
        entry({ timestamp: at(2026, 8, 1), transcription_text: words(900) }),
      ],
      WEDNESDAY,
    );
    expect(stats.wordsChangePct).toBeCloseTo(50, 6);
  });

  test("reports no change when the previous 30 days have no words", () => {
    const stats = computeStats(
      [entry({ timestamp: at(2026, 11, 20), transcription_text: words(10) })],
      WEDNESDAY,
    );
    expect(stats.wordsChangePct).toBeNull();
  });

  test("keeps a streak going across a month boundary", () => {
    const now = new Date(2026, 11, 2, 10); // 2 December
    const stats = computeStats(
      [
        entry({ timestamp: at(2026, 12, 2, 8) }),
        entry({ timestamp: at(2026, 12, 1) }),
        entry({ timestamp: at(2026, 11, 30) }),
        entry({ timestamp: at(2026, 11, 29) }),
        // gap on 28 November
        entry({ timestamp: at(2026, 11, 27) }),
      ],
      now,
    );
    expect(stats.streak).toBe(4);
    expect(stats.longestStreak).toBe(4);
  });

  test("does not break the streak before today's first dictation", () => {
    const stats = computeStats(
      [
        entry({ timestamp: at(2026, 11, 24) }),
        entry({ timestamp: at(2026, 11, 23) }),
      ],
      WEDNESDAY,
    );
    expect(stats.streak).toBe(2);
  });

  test("has no current streak after a full day without dictating", () => {
    const stats = computeStats(
      [
        entry({ timestamp: at(2026, 11, 23) }),
        entry({ timestamp: at(2026, 11, 22) }),
        entry({ timestamp: at(2026, 11, 21) }),
      ],
      WEDNESDAY,
    );
    expect(stats.streak).toBe(0);
    expect(stats.longestStreak).toBe(3);
  });

  test("counts several dictations on one day as a single streak day", () => {
    const stats = computeStats(
      [
        entry({ timestamp: at(2026, 11, 25, 8) }),
        entry({ timestamp: at(2026, 11, 25, 9) }),
        entry({ timestamp: at(2026, 11, 25, 10) }),
      ],
      WEDNESDAY,
    );
    expect(stats.streak).toBe(1);
    expect(stats.longestStreak).toBe(1);
  });
});

describe("wordsPerMinute", () => {
  test("is null for an empty history", () => {
    expect(wordsPerMinute([])).toBeNull();
  });

  test("is null under 30 seconds of speech and a number from 30 on", () => {
    const short = [
      entry({ transcription_text: words(40), duration_ms: 20_000 }),
      entry({ transcription_text: words(20), duration_ms: 9_999 }),
    ];
    expect(wordsPerMinute(short)).toBeNull();

    const enough = [
      ...short,
      entry({ transcription_text: "", duration_ms: 1 }),
    ];
    expect(wordsPerMinute(enough)).toBeCloseTo(120, 6);
  });

  test("divides total words by total minutes, not an average of rates", () => {
    const entries = [
      entry({ transcription_text: words(200), duration_ms: 60_000 }),
      entry({ transcription_text: words(100), duration_ms: 120_000 }),
    ];
    expect(wordsPerMinute(entries)).toBeCloseTo(100, 6);
  });

  test("ignores entries with no duration, a zero one or a negative one", () => {
    const entries = [
      entry({ transcription_text: words(150), duration_ms: 60_000 }),
      entry({ transcription_text: words(5000), duration_ms: null }),
      entry({ transcription_text: words(5000), duration_ms: 0 }),
      entry({ transcription_text: words(5000), duration_ms: -60_000 }),
    ];
    expect(wordsPerMinute(entries)).toBeCloseTo(150, 6);
  });

  test("is null when only entries without duration exist", () => {
    const entries = [
      entry({ transcription_text: words(500) }),
      entry({ transcription_text: words(500), duration_ms: 0 }),
    ];
    expect(wordsPerMinute(entries)).toBeNull();
  });

  test("uses the post-processed text when there is one", () => {
    const entries = [
      entry({
        transcription_text: words(300),
        post_processed_text: words(90),
        duration_ms: 60_000,
      }),
    ];
    expect(wordsPerMinute(entries)).toBeCloseTo(90, 6);
  });
});

describe("timeSavedMinutes", () => {
  test("is null for an empty history and under 30 seconds of speech", () => {
    expect(timeSavedMinutes([])).toBeNull();
    expect(
      timeSavedMinutes([
        entry({ transcription_text: words(400), duration_ms: 29_999 }),
      ]),
    ).toBeNull();
  });

  test("subtracts the speaking time from the time to type at 40 wpm", () => {
    const entries = [
      entry({ transcription_text: words(400), duration_ms: 120_000 }),
      entry({ transcription_text: words(80), duration_ms: 60_000 }),
    ];
    // (400 / 40 - 2) + (80 / 40 - 1)
    expect(timeSavedMinutes(entries)).toBeCloseTo(9, 6);
  });

  test("accepts another typing speed", () => {
    const entries = [
      entry({ transcription_text: words(400), duration_ms: 120_000 }),
    ];
    expect(timeSavedMinutes(entries, 80)).toBeCloseTo(3, 6);
  });

  test("never goes below zero when speaking was slower than typing", () => {
    const entries = [
      entry({ transcription_text: words(10), duration_ms: 300_000 }),
    ];
    expect(timeSavedMinutes(entries)).toBe(0);
  });

  test("ignores entries without duration", () => {
    const entries = [
      entry({ transcription_text: words(400), duration_ms: 120_000 }),
      entry({ transcription_text: words(4000), duration_ms: null }),
      entry({ transcription_text: words(4000), duration_ms: 0 }),
    ];
    expect(timeSavedMinutes(entries)).toBeCloseTo(8, 6);
  });

  test("uses the post-processed text when there is one", () => {
    const entries = [
      entry({
        transcription_text: words(400),
        post_processed_text: words(200),
        duration_ms: 60_000,
      }),
    ];
    expect(timeSavedMinutes(entries)).toBeCloseTo(4, 6);
  });
});

describe("appBreakdown", () => {
  test("is empty for an empty history", () => {
    expect(appBreakdown([])).toEqual({ items: [], untracked: 0 });
  });

  test("leaves entries without an app out and counts them", () => {
    const result = appBreakdown([
      entry({ transcription_text: words(10), app_name: "chrome" }),
      entry({ transcription_text: words(99), app_name: null }),
      entry({ transcription_text: words(99), app_name: "" }),
      entry({ transcription_text: words(99), app_name: "   " }),
    ]);
    expect(result.untracked).toBe(3);
    expect(result.items).toEqual([
      { app: "chrome", words: 10, dictations: 1, share: 1 },
    ]);
  });

  test("has no items when no entry has an app yet", () => {
    const result = appBreakdown([
      entry({ transcription_text: words(10) }),
      entry({ transcription_text: words(20) }),
    ]);
    expect(result).toEqual({ items: [], untracked: 2 });
  });

  test("adds up words and dictations per app, largest first", () => {
    const result = appBreakdown([
      entry({ transcription_text: words(10), app_name: "whatsapp" }),
      entry({ transcription_text: words(30), app_name: "google chrome" }),
      entry({ transcription_text: words(20), app_name: "whatsapp" }),
      entry({ transcription_text: words(40), app_name: "google chrome" }),
      entry({ transcription_text: words(5), app_name: "slack" }),
    ]);
    expect(result.items.map((item) => item.app)).toEqual([
      "google chrome",
      "whatsapp",
      "slack",
    ]);
    expect(result.items[0]).toEqual({
      app: "google chrome",
      words: 70,
      dictations: 2,
      share: 70 / 105,
    });
    expect(result.items[1].words).toBe(30);
    expect(result.items[1].dictations).toBe(2);
  });

  test("counts the post-processed text when there is one", () => {
    const result = appBreakdown([
      entry({
        transcription_text: words(50),
        post_processed_text: words(12),
        app_name: "notes",
      }),
    ]);
    expect(result.items[0].words).toBe(12);
  });

  test("merges the apps past the limit into one 'other' item at the end", () => {
    const result = appBreakdown(
      [
        entry({ transcription_text: words(50), app_name: "a" }),
        entry({ transcription_text: words(30), app_name: "b" }),
        entry({ transcription_text: words(12), app_name: "c" }),
        entry({ transcription_text: words(5), app_name: "d" }),
        entry({ transcription_text: words(2), app_name: "d" }),
        entry({ transcription_text: words(1), app_name: "e" }),
      ],
      2,
    );
    expect(result.items).toEqual([
      { app: "a", words: 50, dictations: 1, share: 0.5 },
      { app: "b", words: 30, dictations: 1, share: 0.3 },
      { app: null, words: 20, dictations: 4, share: 0.2 },
    ]);
  });

  test("does not add 'other' when the apps fit in the limit", () => {
    const entries = ["a", "b", "c", "d", "e", "f"].map((app, i) =>
      entry({ transcription_text: words(i + 1), app_name: app }),
    );
    const result = appBreakdown(entries);
    expect(result.items).toHaveLength(6);
    expect(result.items.some((item) => item.app === null)).toBe(false);
  });

  test("keeps 6 apps by default and merges the seventh", () => {
    const entries = ["a", "b", "c", "d", "e", "f", "g"].map((app, i) =>
      entry({ transcription_text: words(10 - i), app_name: app }),
    );
    const result = appBreakdown(entries);
    expect(result.items).toHaveLength(7);
    expect(result.items[6]).toEqual({
      app: null,
      words: 4,
      dictations: 1,
      share: 4 / 49,
    });
  });

  test("shares add up to 1 and ignore the words of entries without an app", () => {
    const result = appBreakdown(
      [
        entry({ transcription_text: words(7), app_name: "a" }),
        entry({ transcription_text: words(5), app_name: "b" }),
        entry({ transcription_text: words(3), app_name: "c" }),
        entry({ transcription_text: words(1), app_name: "d" }),
        entry({ transcription_text: words(1000), app_name: null }),
      ],
      2,
    );
    const total = result.items.reduce((sum, item) => sum + item.share, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(result.items[0].share).toBeCloseTo(7 / 16, 10);
    expect(result.untracked).toBe(1);
  });

  test("gives a share of 0 when the tracked entries have no words", () => {
    const result = appBreakdown([
      entry({ transcription_text: "", app_name: "chrome" }),
    ]);
    expect(result.items).toEqual([
      { app: "chrome", words: 0, dictations: 1, share: 0 },
    ]);
  });
});

describe("calendarWeeks", () => {
  test("builds 16 columns of 7 days by default, even with no entries", () => {
    const columns = calendarWeeks([], WEDNESDAY);
    expect(columns).toHaveLength(16);
    expect(columns.every((column) => column.length === 7)).toBe(true);
    expect(columns.flat().every((cell) => cell.count === 0)).toBe(true);
  });

  test("honours the number of weeks", () => {
    expect(calendarWeeks([], WEDNESDAY, 4)).toHaveLength(4);
    expect(calendarWeeks([], WEDNESDAY, 1)).toHaveLength(1);
  });

  for (const day of WEEK_OF_NOV_23) {
    const now = new Date(2026, 10, day, 18, 45);
    const weekday = now.toLocaleDateString("en-US", { weekday: "long" });

    test(`starts every column on Monday when today is a ${weekday}`, () => {
      const columns = calendarWeeks([], now);
      for (const column of columns) {
        // getDay(): 1 is Monday ... 6 is Saturday, 0 is Sunday.
        expect(column.map((cell) => cell.date.getDay())).toEqual([
          1, 2, 3, 4, 5, 6, 0,
        ]);
      }
    });

    test(`ends on the current week when today is a ${weekday}`, () => {
      const columns = calendarWeeks([], now);
      const lastColumn = columns[columns.length - 1];
      expect(lastColumn.map((cell) => dayKey(cell.date))).toEqual(
        WEEK_OF_NOV_23.map((d) => `2026-11-${d}`),
      );
      // 15 weeks before Monday 23 November.
      expect(dayKey(columns[0][0].date)).toBe("2026-08-10");
    });

    test(`marks only the days after today as future on a ${weekday}`, () => {
      const columns = calendarWeeks([], now);
      const lastColumn = columns[columns.length - 1];
      expect(lastColumn.map((cell) => cell.future)).toEqual(
        WEEK_OF_NOV_23.map((d) => d > day),
      );
      const earlier = columns.slice(0, -1).flat();
      expect(earlier.some((cell) => cell.future)).toBe(false);
    });
  }

  test("lists consecutive days with no gaps or repeats", () => {
    const cells = calendarWeeks([], WEDNESDAY).flat();
    expect(cells).toHaveLength(112);
    expect(new Set(cells.map((cell) => dayKey(cell.date))).size).toBe(112);
    for (let i = 1; i < cells.length; i++) {
      const previous = cells[i - 1].date;
      const expected = new Date(
        previous.getFullYear(),
        previous.getMonth(),
        previous.getDate() + 1,
      );
      expect(dayKey(cells[i].date)).toBe(dayKey(expected));
    }
  });

  test("puts each day's dictations in the row of its weekday", () => {
    const columns = calendarWeeks(
      [
        entry({ timestamp: at(2026, 11, 25, 9) }), // Wednesday, today
        entry({ timestamp: at(2026, 11, 25, 0) }),
        entry({ timestamp: at(2026, 11, 25, 23) }),
        entry({ timestamp: at(2026, 11, 23, 9) }), // Monday
        entry({ timestamp: at(2026, 11, 22, 9) }), // Sunday of last week
        entry({ timestamp: at(2026, 8, 10, 9) }), // first cell of the grid
        entry({ timestamp: at(2026, 8, 9, 9) }), // one day before the grid
      ],
      WEDNESDAY,
    );
    const lastColumn = columns[15];
    expect(lastColumn.map((cell) => cell.count)).toEqual([1, 0, 3, 0, 0, 0, 0]);
    expect(columns[14][6].count).toBe(1);
    expect(columns[0][0].count).toBe(1);
    const total = columns.flat().reduce((sum, cell) => sum + cell.count, 0);
    expect(total).toBe(6);
  });

  test("shows no count on future cells", () => {
    const columns = calendarWeeks(
      [entry({ timestamp: at(2026, 11, 27, 9) })],
      WEDNESDAY,
    );
    const friday = columns[15][4];
    expect(friday.future).toBe(true);
    expect(friday.count).toBe(0);
  });

  test("crosses a year boundary with Monday still in row 0", () => {
    const columns = calendarWeeks([], new Date(2027, 0, 1, 9), 2); // a Friday
    expect(columns.map((column) => dayKey(column[0].date))).toEqual([
      "2026-12-21",
      "2026-12-28",
    ]);
    expect(columns[1].map((cell) => cell.future)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });
});

describe("displayAppName", () => {
  test("capitalises every word of the app name", () => {
    expect(displayAppName("chrome")).toBe("Chrome");
    expect(displayAppName("google chrome")).toBe("Google Chrome");
    expect(displayAppName("  visual studio   code ")).toBe(
      "Visual Studio Code",
    );
  });
});

describe("splitHoursMinutes", () => {
  test("rounds to whole minutes and splits the hours off", () => {
    expect(splitHoursMinutes(0)).toEqual({ hours: 0, minutes: 0 });
    expect(splitHoursMinutes(12.4)).toEqual({ hours: 0, minutes: 12 });
    expect(splitHoursMinutes(59.6)).toEqual({ hours: 1, minutes: 0 });
    expect(splitHoursMinutes(125)).toEqual({ hours: 2, minutes: 5 });
    expect(splitHoursMinutes(-3)).toEqual({ hours: 0, minutes: 0 });
  });
});
