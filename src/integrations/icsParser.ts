import ICAL from 'ical.js';
import type { DateRange, ExternalScheduleEvent } from './types';

/**
 * iCalendar (ICS) parsing into normalized `ExternalScheduleEvent`s.
 *
 * Parsing (folded lines, escaped text, value types) is delegated to ical.js,
 * a well-maintained RFC 5545 implementation. On top of that this module:
 * - extracts the commonly used Magister fields: UID, DTSTART, DTEND,
 *   SUMMARY, DESCRIPTION, LOCATION, DTSTAMP, LAST-MODIFIED, RRULE
 * - handles UTC timestamps, floating/local timestamps, timezone-aware
 *   timestamps (embedded VTIMEZONE via ical.js, bare TZIDs via Intl) and
 *   all-day (VALUE=DATE) events
 * - expands RRULE occurrences within the requested range (bounded)
 * - skips events that are missing required fields (UID or DTSTART)
 *
 * Throws on a structurally malformed ICS document — callers translate that
 * into a typed `ProviderError`.
 */

/** Hard cap on recurring-expansion iterations to avoid pathological feeds. */
const MAX_RECURSION_OCCURRENCES = 400;

interface ParsedTimeInfo {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  tzid?: string;
  isDate: boolean;
  isUtc: boolean;
}

function tzOffsetMinutes(tzid: string, near: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tzid, timeZoneName: 'longOffset' });
  const part = dtf.formatToParts(near).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(part);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? '0'));
}

/**
 * Converts an iCalendar time to an ISO instant, honoring:
 * UTC ('Z'), floating/local times, all-day dates and TZIDs — including
 * TZIDs that only exist as a parameter without an embedded VTIMEZONE
 * (resolved via the Intl timezone database).
 */
function timeToIso(info: ParsedTimeInfo): string {
  if (info.isDate) {
    // all-day: treat as local midnight
    return new Date(info.year, info.month - 1, info.day, 0, 0, 0).toISOString();
  }

  if (info.isUtc) {
    return new Date(
      Date.UTC(info.year, info.month - 1, info.day, info.hour, info.minute, info.second),
    ).toISOString();
  }

  if (info.tzid) {
    // try the Intl database first (covers e.g. Europe/Amsterdam)
    try {
      const asUtc = Date.UTC(info.year, info.month - 1, info.day, info.hour, info.minute, info.second);
      const offset = tzOffsetMinutes(info.tzid, new Date(asUtc));
      return new Date(asUtc - offset * 60_000).toISOString();
    } catch {
      // fall through to local interpretation for unknown timezone ids
    }
  }

  // floating (local) times — constructed directly from wall clock
  return new Date(
    info.year,
    info.month - 1,
    info.day,
    info.hour,
    info.minute,
    info.second,
  ).toISOString();
}

function describeTime(prop: ICAL.Property | null): ParsedTimeInfo | null {
  if (!prop) return null;
  let value: ICAL.Time;
  try {
    value = prop.getFirstValue() as ICAL.Time;
  } catch {
    return null;
  }
  if (!value || typeof value.year !== 'number') return null;
  // UTC detection: raw ICS representation ends with 'Z' (e.g. 20260907T073000Z)
  const isUtc = /Z$/.test(value.toString());
  const tzidParam = prop.getParameter('tzid');
  return {
    year: value.year,
    month: value.month,
    day: value.day,
    hour: value.hour,
    minute: value.minute,
    second: value.second,
    isDate: value.isDate,
    isUtc,
    tzid: typeof tzidParam === 'string' && tzidParam.length > 0 ? tzidParam : undefined,
  };
}

function firstString(vevent: ICAL.Component, prop: string): string | undefined {
  const value = vevent.getFirstPropertyValue(prop);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Date-valued properties (DTSTAMP, LAST-MODIFIED) as ISO instants. */
function firstIsoString(vevent: ICAL.Component, prop: string): string | undefined {
  const info = describeTime(vevent.getFirstProperty(prop));
  return info ? timeToIso(info) : undefined;
}

function overlaps(startIso: string, endIso: string, range?: DateRange): boolean {
  if (!range) return true;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return start < range.to.getTime() && end > range.from.getTime();
}

/**
 * Parses an ICS document into normalized external schedule events.
 * Throws when the document as a whole is malformed.
 */
export function parseIcs(text: string, range?: DateRange): ExternalScheduleEvent[] {
  const jCal = ICAL.parse(text);
  const root = new ICAL.Component(jCal);
  const vevents = root.getAllSubcomponents('vevent');
  const events: ExternalScheduleEvent[] = [];

  for (const vevent of vevents) {
    const uid = firstString(vevent, 'uid');
    const startInfo = describeTime(vevent.getFirstProperty('dtstart'));
    if (!uid || !startInfo) continue; // missing required fields

    const event = new ICAL.Event(vevent);

    // duration in ms from DTSTART → DTEND (DURATION handled by ical.js)
    let durationMs = 0;
    try {
      const endInfo = describeTime(vevent.getFirstProperty('dtend'));
      if (endInfo) {
        durationMs =
          new Date(timeToIso(endInfo)).getTime() - new Date(timeToIso(startInfo)).getTime();
      } else {
        const duration = event.duration; // DURATION property, if present
        if (duration) durationMs = duration.toSeconds() * 1000;
      }
      if (!Number.isFinite(durationMs) || durationMs < 0) durationMs = 0;
    } catch {
      durationMs = 0;
    }

    const startIso0 = timeToIso(startInfo);

    // occurrence starts (expansion only for recurring events within range)
    let starts: string[] = [];
    if (event.isRecurring() && range) {
      try {
        const iterator = event.iterator();
        const occurrences: string[] = [];
        let count = 0;
        while (count < MAX_RECURSION_OCCURRENCES) {
          const occ = iterator.next();
          if (!occ) break; // expansion exhausted
          count++;
          const info: ParsedTimeInfo = {
            year: occ.year,
            month: occ.month,
            day: occ.day,
            hour: occ.hour,
            minute: occ.minute,
            second: occ.second,
            isDate: startInfo.isDate,
            isUtc: startInfo.isUtc,
            tzid: startInfo.tzid,
          };
          if (
            typeof info.year !== 'number' ||
            Number.isNaN(new Date(timeToIso(info)).getTime())
          ) {
            continue;
          }
          const iso = timeToIso(info);
          if (new Date(iso).getTime() > range.to.getTime()) break;
          occurrences.push(iso);
        }
        starts = occurrences.filter((iso) =>
          overlaps(iso, new Date(new Date(iso).getTime() + durationMs).toISOString(), range),
        );
      } catch {
        starts = []; // unusable RRULE — fall back to the base occurrence
      }
    }
    if (starts.length === 0) starts = [startIso0];

    const description = firstString(vevent, 'description');
    const location = firstString(vevent, 'location');
    const lastModified = firstIsoString(vevent, 'last-modified');
    const dtStamp = firstIsoString(vevent, 'dtstamp');

    for (const startIso of starts) {
      const endIso = new Date(new Date(startIso).getTime() + durationMs).toISOString();
      if (!overlaps(startIso, endIso, range)) continue;
      events.push({
        externalId: uid, // namespacing ("magister:<UID>") happens in normalization
        subject: firstString(vevent, 'summary') ?? '(no title)',
        start: startIso,
        end: endIso,
        room: location,
        description: description ?? undefined,
        category: 'School',
        lastModified,
        dtStamp,
      });
    }
  }

  return events;
}
