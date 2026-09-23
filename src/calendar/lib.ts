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

export function startOfMonth(d: Date): Date {
  const n = startOfDay(d);
  n.setDate(1);
  return n;
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function addYears(d: Date, years: number): Date {
  const n = new Date(d);
  n.setFullYear(n.getFullYear() + years);
  return n;
}

export function addDays(d: Date, days: number): Date {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}

/**
 * Move `months` months, clamping the day-of-month to the target month's length
 * (31 Jan + 1 → 28/29 Feb). Without the clamp, `setMonth` would overflow into
 * the month after next and paging would silently skip a month.
 */
export function addMonths(d: Date, months: number): Date {
  const n = startOfDay(d);
  const dayOfMonth = n.getDate();
  n.setDate(1);
  n.setMonth(n.getMonth() + months);
  const daysInMonth = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
  n.setDate(Math.min(dayOfMonth, daysInMonth));
  return n;
}

/** Week rows the month grid always renders — a frame that never re-sizes. */
export const MONTH_GRID_WEEKS = 6;
export const MONTH_GRID_DAYS = MONTH_GRID_WEEKS * 7;

/**
 * The whole-week cells covering `anchor`'s month, Monday first.
 *
 * Always 42 cells: some months only need five rows, but keeping the frame
 * fixed means the grid never changes height while paging through months.
 */
export function monthGrid(anchor: Date): Date[] {
  const first = startOfWeek(startOfMonth(anchor));
  return Array.from({ length: MONTH_GRID_DAYS }, (_, i) => addDays(first, i));
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

/** e.g. "September 2026" — the month-view toolbar label. */
export function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString([], { month: 'long', year: 'numeric' });
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

/* ---------- Pointer gesture thresholds ---------- */

/** Maximum pointer travel (px) for a gesture to still count as a tap. */
export const TAP_SLOP_PX = 10;
/** Maximum duration (ms) for a gesture to still count as a tap. */
export const TAP_MAX_MS = 700;
/** Minimum horizontal travel (px) for a gesture to count as a swipe. */
export const SWIPE_MIN_PX = 56;

export interface Point {
  x: number;
  y: number;
}

/**
 * Whether a pointer gesture was a deliberate tap rather than the beginning of
 * a scroll or a drag.
 *
 * Both conditions must hold: the pointer stayed within `slop` px of where it
 * went down (so a scroll never qualifies), and the gesture was shorter than
 * `maxMs` (so a long-press reserved for event dragging never qualifies).
 */
export function isTap(
  start: Point,
  end: Point,
  durationMs: number,
  slop: number = TAP_SLOP_PX,
  maxMs: number = TAP_MAX_MS,
): boolean {
  if (durationMs < 0 || durationMs > maxMs) return false;
  return Math.abs(end.x - start.x) <= slop && Math.abs(end.y - start.y) <= slop;
}

/**
 * Horizontal swipe direction for a gesture, or `0` when the gesture is not a
 * swipe.
 *
 * A gesture only counts as a swipe when it travels at least `minPx` px
 * horizontally *and* is clearly more horizontal than vertical. The 1.5× ratio
 * keeps vertical scrolling in the time grid from ever triggering navigation.
 *
 * Returns `1` to advance (swipe left) and `-1` to go back (swipe right).
 */
export function swipeDirection(
  start: Point,
  end: Point,
  minPx: number = SWIPE_MIN_PX,
): -1 | 0 | 1 {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < minPx) return 0;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx > 0 ? -1 : 1;
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
