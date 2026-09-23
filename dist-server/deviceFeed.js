/** API version. Bump when the response shape changes incompatibly. */
export const DEVICE_API_VERSION = 1;
/** Upper bound for the `days` query parameter (keeps ESP32 payloads small). */
export const DEVICE_MAX_DAYS = 62;
/** Default window when `days` is omitted. */
export const DEVICE_DEFAULT_DAYS = 31;
const EVENT_COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'cyan'];
/** `YYYY-MM-DD` of an instant in the given IANA timezone (en-CA = ISO order). */
export function dateInTimeZone(instant, timeZone) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(instant);
}
function wallHM(instant, timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(instant);
    const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
    return { h: get('hour'), min: get('minute') };
}
/**
 * All-day heuristic: starts at local midnight and spans a whole number of
 * days (>= 24h). Matches ICS VALUE=DATE imports (midnight-to-midnight local).
 */
export function isAllDayEvent(start, end, timeZone) {
    const s = wallHM(start, timeZone);
    const e = wallHM(end, timeZone);
    if (s.h !== 0 || s.min !== 0 || e.h !== 0 || e.min !== 0)
        return false;
    const ms = end.getTime() - start.getTime();
    return ms >= 24 * 60 * 60 * 1000 && ms % (24 * 60 * 60 * 1000) === 0;
}
/** Validate the `days` query parameter. Returns null when invalid. */
export function parseDaysParam(raw) {
    if (raw === null || raw === '')
        return DEVICE_DEFAULT_DAYS;
    if (!/^\d+$/.test(raw))
        return null;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 1 || n > DEVICE_MAX_DAYS)
        return null;
    return n;
}
function asRecord(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
        ? v
        : null;
}
function toDeviceEvent(r, timezone, rangeStartMs, rangeEndMs) {
    if (typeof r.id !== 'string' || typeof r.title !== 'string')
        return null;
    if (typeof r.start !== 'string' || typeof r.end !== 'string')
        return null;
    const start = new Date(r.start);
    const end = new Date(r.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
        return null;
    if (end.getTime() <= start.getTime())
        return null;
    if (end.getTime() <= rangeStartMs || start.getTime() >= rangeEndMs)
        return null;
    const color = EVENT_COLORS.includes(r.color) ? r.color : 'blue';
    const ev = {
        id: r.id,
        title: r.title,
        start: start.toISOString(),
        end: end.toISOString(),
        allDay: isAllDayEvent(start, end, timezone),
        date: dateInTimeZone(start, timezone),
        color,
    };
    if (typeof r.category === 'string' && r.category.length > 0)
        ev.category = r.category;
    if (r.source === 'local' || r.source === 'external')
        ev.source = r.source;
    return ev;
}
/** Build the deterministic device payload from raw stored data. */
export function buildDeviceFeed(input) {
    const rangeStartMs = input.rangeStart.getTime();
    const rangeEndMs = input.rangeEnd.getTime();
    const events = [];
    for (const raw of input.events) {
        const r = asRecord(raw);
        if (!r)
            continue;
        const ev = toDeviceEvent(r, input.timezone, rangeStartMs, rangeEndMs);
        if (ev)
            events.push(ev);
    }
    for (const raw of input.tasks) {
        const r = asRecord(raw);
        if (!r || typeof r.id !== 'string' || typeof r.title !== 'string')
            continue;
        if (r.completed === true)
            continue;
        if (typeof r.dueDate !== 'string')
            continue;
        const due = new Date(r.dueDate);
        if (Number.isNaN(due.getTime()))
            continue;
        const t = due.getTime();
        if (t < rangeStartMs || t >= rangeEndMs)
            continue;
        const color = EVENT_COLORS.includes(r.color) ? r.color : 'amber';
        const ev = {
            id: `task:${r.id}`,
            title: r.title,
            start: due.toISOString(),
            end: new Date(t + 30 * 60_000).toISOString(),
            allDay: false,
            date: dateInTimeZone(due, input.timezone),
            color,
        };
        if (typeof r.category === 'string' && r.category.length > 0)
            ev.category = r.category;
        events.push(ev);
    }
    events.sort((a, b) => {
        const s = new Date(a.start).getTime() - new Date(b.start).getTime();
        if (s !== 0)
            return s;
        const e = new Date(a.end).getTime() - new Date(b.end).getTime();
        if (e !== 0)
            return e;
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
/**
 * 6 rows x 7 cols of cells covering the given month (Monday-first).
 * Always 42 cells so the LVGL grid has a fixed layout.
 * Reference for the C++ port in `firmware/test/`.
 */
export function monthCells(year, month) {
    const first = new Date(year, month - 1, 1);
    const lead = (first.getDay() + 6) % 7;
    const start = new Date(year, month - 1, 1 - lead);
    const pad2 = (n) => String(n).padStart(2, '0');
    const cells = [];
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
