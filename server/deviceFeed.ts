/**
 * Canonical device-feed logic (server-owned, single source of truth).
 *
 * Pure module: no Node builtins, so the Vite app may re-export it for
 * tests via `src/device/`. The server build (`tsconfig.server.json`,
 * `rootDir: server`) can only include files under `server/`, which is why
 * the canonical copy lives here rather than under `src/`.
 */
export type EventColor = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'cyan';

/** API version. Bump when the response shape changes incompatibly. */
export const DEVICE_API_VERSION = 1;

/** One event instance as the device sees it (UTC ISO instants). */
export interface DeviceCalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  /** `YYYY-MM-DD` date of the event start in the response timezone. */
  date: string;
  color: EventColor;
  category?: string;
  source?: 'local' | 'external';
}

/** Device-friendly calendar payload. Deterministic key order, no extras. */
export interface DeviceCalendarResponse {
  version: typeof DEVICE_API_VERSION;
  generatedAt: string;
  /** IANA timezone the `date` fields were computed in. */
  timezone: string;
  range: { start: string; end: string };
  events: DeviceCalendarEvent[];
}

/** Upper bound for the `days` query parameter (keeps ESP32 payloads small). */
export const DEVICE_MAX_DAYS = 62;
/** Default window when `days` is omitted. */
export const DEVICE_DEFAULT_DAYS = 31;

const EVENT_COLORS: readonly EventColor[] = ['blue', 'green', 'amber', 'red', 'purple', 'cyan'];

/** `YYYY-MM-DD` of an instant in the given IANA timezone (en-CA = ISO order). */
export function dateInTimeZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

function wallHM(instant: Date, timeZone: string): { h: number; min: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? NaN);
  return { h: get('hour'), min: get('minute') };
}

/**
 * All-day heuristic: starts at local midnight and spans a whole number of
 * days (>= 24h). Matches ICS VALUE=DATE imports (midnight-to-midnight local).
 */
export function isAllDayEvent(start: Date, end: Date, timeZone: string): boolean {
  const s = wallHM(start, timeZone);
  const e = wallHM(end, timeZone);
  if (s.h !== 0 || s.min !== 0 || e.h !== 0 || e.min !== 0) return false;
  const ms = end.getTime() - start.getTime();
  return ms >= 24 * 60 * 60 * 1000 && ms % (24 * 60 * 60 * 1000) === 0;
}

/** Validate the `days` query parameter. Returns null when invalid. */
export function parseDaysParam(raw: string | null): number | null {
  if (raw === null || raw === '') return DEVICE_DEFAULT_DAYS;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > DEVICE_MAX_DAYS) return null;
  return n;
}

export interface DeviceFeedInput {
  events: unknown[];
  tasks: unknown[];
  rangeStart: Date;
  rangeEnd: Date;
  timezone: string;
  generatedAt?: Date;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
function toDeviceEvent(
  r: Record<string, unknown>,
  timezone: string,
  rangeStartMs: number,
  rangeEndMs: number,
): DeviceCalendarEvent | null {
  if (typeof r.id !== 'string' || typeof r.title !== 'string') return null;
  if (typeof r.start !== 'string' || typeof r.end !== 'string') return null;
  const start = new Date(r.start);
  const end = new Date(r.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end.getTime() <= start.getTime()) return null;
  if (end.getTime() <= rangeStartMs || start.getTime() >= rangeEndMs) return null;
  const color = EVENT_COLORS.includes(r.color as EventColor) ? (r.color as EventColor) : 'blue';
  const ev: DeviceCalendarEvent = {
    id: r.id,
    title: r.title,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: isAllDayEvent(start, end, timezone),
    date: dateInTimeZone(start, timezone),
    color,
  };
  if (typeof r.category === 'string' && r.category.length > 0) ev.category = r.category;
  if (r.source === 'local' || r.source === 'external') ev.source = r.source;
  return ev;
}

/** Build the deterministic device payload from raw stored data. */
export function buildDeviceFeed(input: DeviceFeedInput): DeviceCalendarResponse {
  const rangeStartMs = input.rangeStart.getTime();
  const rangeEndMs = input.rangeEnd.getTime();
  const events: DeviceCalendarEvent[] = [];

  for (const raw of input.events) {
    const r = asRecord(raw);
    if (!r) continue;
    const ev = toDeviceEvent(r, input.timezone, rangeStartMs, rangeEndMs);
    if (ev) events.push(ev);
  }

  for (const raw of input.tasks) {
    const r = asRecord(raw);
    if (!r || typeof r.id !== 'string' || typeof r.title !== 'string') continue;
    if (r.completed === true) continue;
    if (typeof r.dueDate !== 'string') continue;
    const due = new Date(r.dueDate);
    if (Number.isNaN(due.getTime())) continue;
    const t = due.getTime();
    if (t < rangeStartMs || t >= rangeEndMs) continue;
    const color = EVENT_COLORS.includes(r.color as EventColor) ? (r.color as EventColor) : 'amber';
    const ev: DeviceCalendarEvent = {
      id: `task:${r.id}`,
      title: r.title,
      start: due.toISOString(),
      end: new Date(t + 30 * 60_000).toISOString(),
      allDay: false,
      date: dateInTimeZone(due, input.timezone),
      color,
    };
    if (typeof r.category === 'string' && r.category.length > 0) ev.category = r.category;
    events.push(ev);
  }

  events.sort((a, b) => {
    const s = new Date(a.start).getTime() - new Date(b.start).getTime();
    if (s !== 0) return s;
    const e = new Date(a.end).getTime() - new Date(b.end).getTime();
    if (e !== 0) return e;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return {
    version: DEVICE_API_VERSION,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    timezone: input.timezone,
    range: { start: input.rangeStart.toISOString(), end: input.rangeEnd.toISOString() },
    events,
  };
}

/** One cell of the 7-column month grid (Monday-first, shared with firmware). */
export interface MonthCell {
  year: number;
  month: number;
  day: number;
  /** `YYYY-MM-DD` key used to join events onto days. */
  key: string;
  /** True for leading/trailing filler days from adjacent months. */
  outside: boolean;
}

/**
 * 6 rows x 7 cols of cells covering the given month (Monday-first).
 * Always 42 cells so the LVGL grid has a fixed layout.
 * Reference for the C++ port in `firmware/test/`.
 */
export function monthCells(year: number, month: number): MonthCell[] {
  const first = new Date(year, month - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month - 1, 1 - lead);
  const pad2 = (n: number): string => String(n).padStart(2, '0');
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    cells.push({
      year: y,
      month: m,
      day,
      key: `${y}-${pad2(m)}-${pad2(day)}`,
      outside: m !== month,
    });
  }
  return cells;
}

