import type { CalendarEvent } from './types';

export const HOUR_HEIGHT = 56;
export const SNAP_MINUTES = 5;

export function startOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

export function startOfWeek(d: Date): Date {
  const n = startOfDay(d);
  // week starts Monday
  const day = (n.getDay() + 6) % 7;
  n.setDate(n.getDate() - day);
  return n;
}

export function addDays(d: Date, days: number): Date {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function sameDateTime(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

export function minutesFromDayStart(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function snapMinutes(min: number): number {
  return Math.round(min / SNAP_MINUTES) * SNAP_MINUTES;
}

export function formatTime(d: Date): string {
  return d
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    .replace(':00', '');
}

export function formatTimeFull(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatDayLabel(d: Date): string {
  return d.toLocaleDateString([], { weekday: 'short' });
}

export function formatDayNumber(d: Date): string {
  return String(d.getDate());
}

export function formatWeekRange(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
  const fmt: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };
  const monthYear = weekStart.toLocaleDateString([], fmt);
  if (sameMonth) {
    return `${monthYear} ${weekStart.getDate()} – ${weekEnd.getDate()}`;
  }
  return `${weekStart.getDate()} ${monthYear} – ${weekEnd.getDate()} ${weekEnd.toLocaleDateString(
    [],
    fmt,
  )}`;
}

export function eventEnd(e: CalendarEvent): Date {
  return new Date(e.end);
}

/** Clamp a value between min and max */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

interface Positioned {
  event: CalendarEvent;
  /** 0-based column index among overlapping events */
  column: number;
  /** total columns in the overlap group */
  columns: number;
}

/**
 * Simple overlap layout: events that overlap in time share a horizontal group;
 * each event gets a column index and the group width is distributed evenly.
 */
export function layoutEvents(events: CalendarEvent[]): Positioned[] {
  const sorted = [...events].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
  const result: Positioned[] = [];
  let group: CalendarEvent[] = [];
  let groupEnd = -Infinity;

  const flush = () => {
    if (group.length === 0) return;
    const columns = group.length;
    group.forEach((event, column) => result.push({ event, column, columns }));
    group = [];
    groupEnd = -Infinity;
  };

  for (const e of sorted) {
    const s = new Date(e.start).getTime();
    if (s >= groupEnd) flush();
    group.push(e);
    groupEnd = Math.max(groupEnd, new Date(e.end).getTime());
  }
  flush();
  return result;
}
