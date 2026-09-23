import { tokenMatches } from './webhook.js';
import { readStorage } from './storage.js';
import { buildDeviceFeed, parseDaysParam, DEVICE_DEFAULT_DAYS } from './deviceFeed.js';
const SERVER_TIMEZONE = process.env.CALENDAR_TIMEZONE || 'Europe/Amsterdam';
function midnightLocalToday(tz, now) {
    // Wall-clock date of `now` in tz, then midnight of that date as an instant.
    const ymd = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
    const [y, m, d] = ymd.split('-').map(Number);
    // Interpret midnight wall-clock in tz by round-tripping through Intl offset.
    // Compute the UTC instant whose wall clock in tz equals y/m/d 00:00.
    // Start from a UTC guess, then correct by the zone offset at that guess.
    const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
    const offsetMin = tzOffsetMinutes(tz, new Date(guess));
    return new Date(guess - offsetMin * 60_000);
}
function tzOffsetMinutes(tz, near) {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
    const part = dtf.formatToParts(near).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const match = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(part);
    if (!match)
        return 0;
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3] ?? '0'));
}
function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
}
/** True when the path is exactly /api/v1/calendar (query string allowed). */
export function isDeviceCalendarPath(url) {
    const path = url.split('?')[0];
    return path === '/api/v1/calendar';
}
export function handleDeviceCalendarRequest(req, res, url, now = new Date()) {
    if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET' });
        res.end('Method Not Allowed');
        return;
    }
    const qs = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?')) : '');
    const expected = process.env.DEVICE_TOKEN;
    if (expected) {
        const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? null;
        if (!tokenMatches(bearer ?? qs.get('token'), expected)) {
            json(res, 401, { ok: false, error: 'Unauthorized' });
            return;
        }
    }
    const days = parseDaysParam(qs.get('days'));
    if (days === null) {
        const d = DEVICE_DEFAULT_DAYS;
        json(res, 400, { ok: false, error: `Invalid "days" parameter (expected 1..62, default ${d})` });
        return;
    }
    const rangeStart = midnightLocalToday(SERVER_TIMEZONE, now);
    const rangeEnd = new Date(rangeStart.getTime() + days * 24 * 60 * 60 * 1000);
    const stored = readStorage();
    const payload = buildDeviceFeed({
        events: stored.events,
        tasks: stored.tasks,
        rangeStart,
        rangeEnd,
        timezone: SERVER_TIMEZONE,
        generatedAt: now,
    });
    json(res, 200, payload);
}
