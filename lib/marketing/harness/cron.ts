/**
 * Five-field cron (minute hour day-of-month month day-of-week), evaluated in
 * an IANA timezone. Supports *, lists (1,15), ranges (1-5), steps (*\/15,
 * 9-17/2) and 0 or 7 for Sunday. Day-of-month and day-of-week combine with OR
 * when both are restricted (classic cron). Pure.
 */

interface Parsed {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
}

function field(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`bad cron field "${part}"`);
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) throw new Error(`bad cron step "${part}"`);
    const range: number[] = m[1] === "*" ? [min, max] : m[1].split("-").map(Number);
    const lo = range[0];
    const hi = range[1] ?? (m[2] ? max : lo);
    if (lo < min || hi > max || lo > hi) throw new Error(`cron value out of range in "${part}" (${min}-${max})`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): Parsed {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("cron needs 5 fields: minute hour day-of-month month day-of-week");
  const dow = field(parts[4], 0, 7);
  if (dow.has(7)) dow.add(0);
  return { minute: field(parts[0], 0, 59), hour: field(parts[1], 0, 23), dom: field(parts[2], 1, 31), month: field(parts[3], 1, 12), dow, domAny: parts[2] === "*", dowAny: parts[4] === "*" };
}

export function validCron(expr: string): string | null {
  try {
    parseCron(expr);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "invalid cron";
  }
}

/** Wall-clock fields of `date` in `timeZone`. */
function local(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday) };
}

/** The first matching minute strictly after `after`, or null within ~13 months. */
export function nextRun(expr: string, after: Date, timeZone = "Asia/Kolkata"): Date | null {
  const c = parseCron(expr);
  const t = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
  const limit = after.getTime() + 400 * 86_400_000;
  while (t.getTime() <= limit) {
    const l = local(t, timeZone);
    const dayOk = c.domAny && c.dowAny ? true : c.domAny ? c.dow.has(l.dow) : c.dowAny ? c.dom.has(l.day) : c.dom.has(l.day) || c.dow.has(l.dow);
    if (!c.month.has(l.month) || !dayOk) {
      // Skip to the next local midnight (approximately; the loop re-checks).
      t.setTime(t.getTime() + ((23 - l.hour) * 60 + (60 - l.minute)) * 60_000);
      continue;
    }
    if (!c.hour.has(l.hour)) {
      t.setTime(t.getTime() + (60 - l.minute) * 60_000);
      continue;
    }
    if (c.minute.has(l.minute)) return t;
    t.setTime(t.getTime() + 60_000);
  }
  return null;
}
