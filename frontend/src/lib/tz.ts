/**
 * Timezone-aware helpers built on Intl (IANA zones, e.g. Asia/Tehran).
 * All grid math works on "zoned wall-clock parts" so week/month boundaries are
 * correct in the user's timezone regardless of the browser's own zone.
 */

export interface ZonedParts {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
  h: number;
  min: number;
  dow: number; // 0=Sunday .. 6=Saturday (JS convention)
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function getDtf(tz: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    dtfCache.set(tz, dtf);
  }
  return dtf;
}

export function utcToZonedParts(date: Date, tz: string): ZonedParts {
  const parts = getDtf(tz).formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = parseInt(p.value, 10);
  }
  const y = map.year;
  const m = map.month;
  const d = map.day;
  const h = map.hour % 24;
  const min = map.minute;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, h, min, dow };
}

export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = utcToZonedParts(date, tz);
  const asUTC = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  return (asUTC - (date.getTime() - (date.getTime() % 60000))) / 60000;
}

/** Convert zoned wall-clock parts in `tz` to the equivalent UTC instant. */
export function zonedPartsToUtc(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  tz: string
): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let offset = tzOffsetMinutes(new Date(guess), tz);
  let ts = guess - offset * 60000;
  offset = tzOffsetMinutes(new Date(ts), tz);
  return new Date(guess - offset * 60000);
}

/** Add n days to wall-clock date parts (pure UTC-midnight date math). */
export function addDaysToParts(p: { y: number; m: number; d: number }, n: number) {
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Day of week (0=Sunday..6=Saturday) for wall-clock date parts. */
export function dowOfParts(p: { y: number; m: number; d: number }): number {
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

/** Saturday 00:00 that contains the given instant, as a UTC Date, in `tz`. */
export function zonedWeekStart(date: Date, tz: string): Date {
  const p = utcToZonedParts(date, tz);
  const daysSinceSaturday = (p.dow - 6 + 7) % 7;
  const sat = addDaysToParts({ y: p.y, m: p.m, d: p.d }, -daysSinceSaturday);
  return zonedPartsToUtc(sat.y, sat.m, sat.d, 0, 0, tz);
}

/** The 7 wall-clock dates of the week containing `date`, starting Saturday. */
export function weekDayParts(date: Date, tz: string) {
  const p = utcToZonedParts(date, tz);
  const daysSinceSaturday = (p.dow - 6 + 7) % 7;
  const sat = addDaysToParts({ y: p.y, m: p.m, d: p.d }, -daysSinceSaturday);
  return Array.from({ length: 7 }, (_, i) => addDaysToParts(sat, i));
}

export function sameDay(a: { y: number; m: number; d: number }, b: { y: number; m: number; d: number }) {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

export function ymdOf(p: { y: number; m: number; d: number }): string {
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
