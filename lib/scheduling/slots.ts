import type { VisitRecord, VisitSettings } from "../store/types";
import { istDayKey, istParts, istToUtc } from "./time";

/**
 * SITE-VISIT SLOTS. Generated from the desk's visit settings (IST hours,
 * slot length, closed weekdays, notice period) minus what's already booked
 * at that property (capacity per slot). Pure.
 */

export const DEFAULT_VISIT_SETTINGS: VisitSettings = {
  daysAhead: 14,
  startHour: 10,
  endHour: 18,
  slotMinutes: 60,
  capacityPerSlot: 2,
  closedWeekdays: [],
  minNoticeHours: 3,
};

export interface Slot {
  /** ISO instant. */
  start: string;
  dayKey: string;
  remaining: number;
}

export interface SlotDay {
  dayKey: string;
  /** The day's first instant, for labelling. */
  date: string;
  slots: Slot[];
}

const ACTIVE: VisitRecord["status"][] = ["scheduled", "confirmed"];

export function availableSlots(now: Date, settings: VisitSettings, propertyId: string, booked: VisitRecord[], excludeVisitId?: string): SlotDay[] {
  const taken = new Map<string, number>();
  for (const v of booked) {
    if (v.propertyId !== propertyId || !ACTIVE.includes(v.status) || v.visitId === excludeVisitId) continue;
    const key = new Date(v.slot).toISOString();
    taken.set(key, (taken.get(key) ?? 0) + 1);
  }
  const earliest = now.getTime() + settings.minNoticeHours * 3_600_000;
  const today = istParts(now);
  const days: SlotDay[] = [];
  for (let offset = 0; offset < settings.daysAhead; offset += 1) {
    const dayStart = istToUtc(today.year, today.month, today.day + offset, 0);
    const weekday = istParts(dayStart).weekday;
    if (settings.closedWeekdays.includes(weekday)) continue;
    const slots: Slot[] = [];
    for (let minutes = settings.startHour * 60; minutes + settings.slotMinutes <= settings.endHour * 60; minutes += settings.slotMinutes) {
      const p = istParts(dayStart);
      const start = istToUtc(p.year, p.month, p.day, Math.floor(minutes / 60), minutes % 60);
      if (start.getTime() < earliest) continue;
      const iso = start.toISOString();
      const remaining = settings.capacityPerSlot - (taken.get(iso) ?? 0);
      if (remaining > 0) slots.push({ start: iso, dayKey: istDayKey(start), remaining });
    }
    if (slots.length) days.push({ dayKey: istDayKey(dayStart), date: dayStart.toISOString(), slots });
  }
  return days;
}

/** Is this exact instant a bookable slot right now? (Server-side re-check — never trust the page.) */
export function isBookable(slotIso: string, now: Date, settings: VisitSettings, propertyId: string, booked: VisitRecord[], excludeVisitId?: string): boolean {
  return availableSlots(now, settings, propertyId, booked, excludeVisitId).some((d) => d.slots.some((s) => s.start === new Date(slotIso).toISOString()));
}
