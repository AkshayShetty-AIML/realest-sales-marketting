/**
 * India Standard Time helpers. IST is UTC+05:30 with no daylight saving, so a
 * fixed offset is exact. Slots, reminders and quiet hours are all in IST.
 * Pure.
 */

export const IST_OFFSET_MS = 330 * 60_000;

export interface IstParts {
  year: number;
  /** 0-based. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday. */
  weekday: number;
}

export function istParts(at: Date | number): IstParts {
  const d = new Date((typeof at === "number" ? at : at.getTime()) + IST_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay() };
}

/** An IST wall-clock time → the instant. */
export function istToUtc(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(year, month, day, hour, minute) - IST_OFFSET_MS);
}

/** "2026-10-04" for the IST calendar day of an instant. */
export function istDayKey(at: Date | number): string {
  const p = istParts(at);
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function formatIst(at: Date | string, style: "long" | "time" | "day" = "long"): string {
  const d = typeof at === "string" ? new Date(at) : at;
  const opts: Intl.DateTimeFormatOptions =
    style === "time"
      ? { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }
      : style === "day"
        ? { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }
        : { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" };
  return d.toLocaleString("en-IN", opts);
}

/** Automated messages only go out 09:00–20:00 IST. */
export const QUIET_START_HOUR = 20;
export const QUIET_END_HOUR = 9;

/** The instant itself if it's inside sending hours, else the next 09:00 IST. */
export function nextSendable(at: Date): Date {
  const p = istParts(at);
  if (p.hour >= QUIET_END_HOUR && p.hour < QUIET_START_HOUR) return at;
  const base = p.hour >= QUIET_START_HOUR ? istToUtc(p.year, p.month, p.day + 1, QUIET_END_HOUR) : istToUtc(p.year, p.month, p.day, QUIET_END_HOUR);
  return base;
}

/** Check-in opens CHECKIN_OPEN_BEFORE_H before the slot and closes CHECKIN_CLOSE_AFTER_H after. */
export const CHECKIN_OPEN_BEFORE_H = 2;
export const CHECKIN_CLOSE_AFTER_H = 4;

export function checkInWindowOpen(slotIso: string, now: number = Date.now()): boolean {
  const slot = Date.parse(slotIso);
  return now >= slot - CHECKIN_OPEN_BEFORE_H * 3_600_000 && now <= slot + CHECKIN_CLOSE_AFTER_H * 3_600_000;
}
