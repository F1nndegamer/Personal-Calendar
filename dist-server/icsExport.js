/**
 * Builds an RFC 5545 iCalendar (.ics) feed from the app's stored events.
 *
 * Pure module: no Node builtins, so it can be tested and reused without
 * pulling in the server's file-system or HTTP layer.
 *
 * The feed is public by design: calendar services (Google Calendar, Apple
 * Calendar, Outlook) fetch subscription URLs anonymously and cannot present
 * a session cookie. Anyone who knows the URL can read the events, so treat
 * the subscription URL as shared, not secret.
 */
/** RFC 5545: fold content lines at 75 octets; continuation lines start with SP. */
function foldLine(content) {
    const MAX = 75;
    if (Buffer.byteLength(content, 'utf8') <= MAX)
        return content;
    const out = [];
    let remaining = content;
    while (Buffer.byteLength(remaining, 'utf8') > MAX) {
        let cut = MAX;
        // Never split inside a multi-byte UTF-8 sequence (continuation bytes
        // have the high bits 10xxxxxx).
        while (cut > 0 && (remaining.charCodeAt(cut) & 0xc0) === 0x80)
            cut--;
        out.push(remaining.slice(0, cut));
        remaining = ' ' + remaining.slice(cut);
    }
    out.push(remaining);
    return out.join('\r\n');
}
function escapeText(text) {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '');
}
function pad2(n) {
    return String(n).padStart(2, '0');
}
/** UTC instant as `YYYYMMDDTHHMMSSZ`. */
function formatUtc(instant) {
    return (instant.getUTCFullYear() +
        pad2(instant.getUTCMonth() + 1) +
        pad2(instant.getUTCDate()) +
        'T' +
        pad2(instant.getUTCHours()) +
        pad2(instant.getUTCMinutes()) +
        pad2(instant.getUTCSeconds()) +
        'Z');
}
/** Calendar date as `YYYYMMDD`. */
function formatDate(instant) {
    return (instant.getUTCFullYear() +
        pad2(instant.getUTCMonth() + 1) +
        pad2(instant.getUTCDate()));
}
/** All-day heuristic: midnight-to-midnight spanning whole days (in UTC). */
function isAllDay(start, end) {
    if (start.getUTCHours() !== 0 || start.getUTCMinutes() !== 0 || start.getUTCSeconds() !== 0)
        return false;
    if (end.getUTCHours() !== 0 || end.getUTCMinutes() !== 0 || end.getUTCSeconds() !== 0)
        return false;
    const ms = end.getTime() - start.getTime();
    return ms >= 24 * 60 * 60 * 1000 && ms % (24 * 60 * 60 * 1000) === 0;
}
/** Render the lines of one VEVENT (without the CRLF terminators). */
function eventLines(ev, nowUtc) {
    const start = new Date(ev.start);
    const end = new Date(ev.end);
    const allDay = isAllDay(start, end);
    const lines = [];
    lines.push(`UID:${ev.id}@personal-calendar.app`);
    lines.push(`DTSTAMP:${nowUtc}`);
    if (allDay) {
        lines.push(`DTSTART;VALUE=DATE:${formatDate(start)}`);
        lines.push(`DTEND;VALUE=DATE:${formatDate(end)}`);
    }
    else {
        lines.push(`DTSTART:${formatUtc(start)}`);
        lines.push(`DTEND:${formatUtc(end)}`);
    }
    lines.push(`SUMMARY:${escapeText(ev.title)}`);
    if (ev.description)
        lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    if (ev.room)
        lines.push(`LOCATION:${escapeText(ev.room)}`);
    if (ev.category)
        lines.push(`CATEGORIES:${escapeText(ev.category)}`);
    return lines;
}
/**
 * Serialize `events` as an iCalendar string terminated with CRLF.
 *
 * `options.prodId` overrides the product identifier; `options.calendarName`
 * sets `X-WR-CALNAME` (some clients show this as the calendar's title).
 */
export function buildIcs(events, options = {}) {
    const lines = [];
    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push(`PRODID:${options.prodId ?? '-//Personal Calendar//personal-calendar.app'}`);
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    lines.push(`X-WR-CALNAME:${escapeText(options.calendarName ?? 'Personal Calendar')}`);
    lines.push('X-WR-TIMEZONE:UTC');
    const nowUtc = formatUtc(new Date());
    for (const ev of events) {
        lines.push('BEGIN:VEVENT');
        lines.push(...eventLines(ev, nowUtc));
        lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
}
