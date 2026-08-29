import { toJalali } from "./jalaali";
import { dowOfParts, type ZonedParts } from "./tz";

export const JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

/** Weekday names, index 0 = شنبه (Saturday) .. 6 = جمعه (Friday). */
export const WEEKDAYS_FA = ["شنبه", "یک‌شنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه"];

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export function toFa(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

export function weekdayIndexSat(dow: number): number {
  // JS dow (0=Sun..6=Sat) → index with 0=Saturday
  return (dow - 6 + 7) % 7;
}

export interface DateParts {
  y: number;
  m: number;
  d: number;
}

export function jalaliOf(p: DateParts) {
  return toJalali(p.y, p.m, p.d);
}

/** «۶ شهریور ۱۴۰۵» */
export function faDate(p: DateParts, opts?: { withYear?: boolean; withWeekday?: boolean }): string {
  const { jy, jm, jd } = jalaliOf(p);
  let s = `${toFa(jd)} ${JALALI_MONTHS[jm - 1]}`;
  if (opts?.withYear !== false) s += ` ${toFa(jy)}`;
  if (opts?.withWeekday) s = `${WEEKDAYS_FA[weekdayIndexSat(dowOfParts(p))]} ${s}`;
  return s;
}

/** «مهر ۱۴۰۵» */
export function faMonth(jy: number, jm: number): string {
  return `${JALALI_MONTHS[jm - 1]} ${toFa(jy)}`;
}

/**
 * Natural Persian date range, collapsing the shared month/year:
 *   same month  → «۷ تا ۱۳ شهریور ۱۴۰۵»
 *   cross month → «۳۱ مرداد تا ۶ شهریور ۱۴۰۵»
 *   cross year  → «۲۹ اسفند ۱۴۰۴ تا ۵ فروردین ۱۴۰۵»
 */
export function faDateRange(a: DateParts, b: DateParts): string {
  const ja = jalaliOf(a);
  const jb = jalaliOf(b);
  if (ja.jy === jb.jy && ja.jm === jb.jm) {
    return `${toFa(ja.jd)} تا ${toFa(jb.jd)} ${JALALI_MONTHS[ja.jm - 1]} ${toFa(ja.jy)}`;
  }
  if (ja.jy === jb.jy) {
    return `${toFa(ja.jd)} ${JALALI_MONTHS[ja.jm - 1]} تا ${toFa(jb.jd)} ${JALALI_MONTHS[jb.jm - 1]} ${toFa(ja.jy)}`;
  }
  return `${toFa(ja.jd)} ${JALALI_MONTHS[ja.jm - 1]} ${toFa(ja.jy)} تا ${toFa(jb.jd)} ${JALALI_MONTHS[jb.jm - 1]} ${toFa(jb.jy)}`;
}

/** Minutes since midnight → "02:30" (Latin digits, tabular). */
export function clockOf(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "02:30" → minutes since midnight */
export function minutesOfClock(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/** Duration in minutes → compact Latin format (owner decision): "1h 15 min" / "2h" / "45 min". */
export function fmtDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  if (rest === 0) return `${h}h`;
  return `${h}h ${rest} min`;
}

/** Duration entry is handled by the DurationInput component ([ h ] [ min ] boxes). */

/** Estimate/logged pair → "1h 15 min / 2h" (slash form; bare logged if no estimate). */
export function fmtEstimateLogged(loggedMin: number, estimateMin: number | null): string {
  const logged = fmtDuration(loggedMin);
  if (!estimateMin) return logged;
  return `${logged} / ${fmtDuration(estimateMin)}`;
}

export function faPercent(p: number): string {
  return `${toFa(Math.round(p))}٪`;
}

export function todayParts(tz: string): DateParts {
  const now = new Date();
  const p: ZonedParts = (() => {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const parts = dtf.formatToParts(now);
    const map: Record<string, number> = {};
    for (const part of parts) if (part.type !== "literal") map[part.type] = parseInt(part.value, 10);
    return { y: map.year, m: map.month, d: map.day, h: map.hour % 24, min: map.minute, dow: 0 };
  })();
  return { y: p.y, m: p.m, d: p.d };
}

export const PRIORITY_FA: Record<string, string> = {
  high: "زیاد",
  medium: "متوسط",
  low: "کم",
};

export const STATUS_FA: Record<string, string> = {
  backlog: "بک‌لاگ",
  open: "باز",
  in_progress: "در حال انجام",
  closed: "انجام شد",
};

export const STATUS_COLORS: Record<string, string> = {
  backlog: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  open: "bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300",
  in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300",
  closed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300",
};

export function gregorianYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
