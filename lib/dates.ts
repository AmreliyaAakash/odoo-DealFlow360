/**
 * Date helpers shared by every dashboard's aggregation.
 *
 * These were copied into four `data.ts` files before this existed. They are
 * deliberately local-time, not UTC: a dashboard that buckets "today" by UTC
 * shows an Indian user the wrong day for the first five and a half hours of it.
 */

/** `YYYY-MM-DD` in local time — the key every daily bucket is grouped by. */
export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Midnight at the start of `date`, local time. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Monday of the week `date` falls in. */
export function startOfWeek(date: Date): Date {
  const monday = startOfDay(date);
  // getDay() is Sunday-based; shift so Monday is 0.
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Midnight `days` ago, as a timestamp for a `gte` filter. */
export function daysAgoIso(days: number): string {
  return addDays(startOfDay(new Date()), -days).toISOString();
}

/** Whole days between two dates, ignoring clock time. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round(
    (startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000,
  );
}

/** The last `count` week-start Mondays, oldest first. */
export function recentWeekStarts(count: number): Date[] {
  const thisMonday = startOfWeek(new Date());
  return Array.from({ length: count }, (_, index) =>
    addDays(thisMonday, -(count - 1 - index) * 7),
  );
}

/** The last `count` days at midnight, oldest first. */
export function recentDays(count: number): Date[] {
  const today = startOfDay(new Date());
  return Array.from({ length: count }, (_, index) =>
    addDays(today, -(count - 1 - index)),
  );
}

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

export const DATE_LOCALE = "en-IN";

/** "12 Aug" — the short form chart axes and tables use. */
export function formatDayMonth(date: Date | string): string {
  return new Date(date).toLocaleDateString(DATE_LOCALE, {
    day: "numeric",
    month: "short",
  });
}

/** "12 Aug 2026" — the long form for a cell a person reads once. */
export function formatDate(date: Date | string | null): string {
  if (date === null) return "—";
  return new Date(date).toLocaleDateString(DATE_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "12 Aug, 4:05 pm" — for a timestamp where the time of day matters. */
export function formatDateTime(date: Date | string | null): string {
  if (date === null) return "—";
  return new Date(date).toLocaleString(DATE_LOCALE, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Mon 12" — weekday axes. */
export function formatWeekday(date: Date | string): string {
  return new Date(date).toLocaleDateString(DATE_LOCALE, {
    weekday: "short",
    day: "numeric",
  });
}

/**
 * "3h ago" — how long ago an ISO timestamp was.
 *
 * Coarse on purpose: an activity feed is read to answer "is this fresh", and a
 * second-accurate string invites the reader to compare two entries that a
 * database write order already settled. Anything past a week gets the date,
 * because "23d ago" is not something anyone converts in their head.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);

  if (!Number.isFinite(seconds)) return "";
  if (seconds < 0) return "just now";
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;

  return formatDayMonth(then);
}
