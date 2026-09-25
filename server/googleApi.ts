/**
 * Server-side Google Calendar pure mapping helpers (dependency-free).
 *
 * This module translates raw Calendar API shapes (see `googleTypes.ts`)
 * into plain external-event objects the frontend can normalize with its
 * existing `normalizeExternalEvent` pipeline. No sockets here — network
 * calls live in `googleOAuth.ts` with an injectable `fetchImpl`.
 */

import type {
  GoogleApiCalendarListEntry,
  GoogleApiEvent,
  GoogleCalendarRef,
} from './googleTypes.js';

/** Server-side external event shape (mirrors the frontend's ExternalScheduleEvent). */
export interface GoogleExternalEvent {
  /** Stable id namespaced by calendar: "<calendarId>:<eventId>" (raw ids, not encoded) */
  externalId: string;
  subject: string;
  /** ISO date-time */
  start: string;
  /** ISO date-time */
  end: string;
  description?: string;
  /** `updated` timestamp from Google, if present */
  updated?: string;
}

function pickInstant(
  value: { date?: string; dateTime?: string } | undefined,
  fallbackEnd: boolean,
): string | null {
  if (!value) return null;
  if (typeof value.dateTime === 'string' && value.dateTime.length > 0) {
    const t = new Date(value.dateTime).getTime();
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  if (typeof value.date === 'string' && value.date.length > 0) {
    // All-day `date` ("YYYY-MM-DD") → midnight UTC start / +24h end.
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.date);
    if (!m) return null;
    const startMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date(fallbackEnd ? startMs + 24 * 60 * 60_000 : startMs).toISOString();
  }
  return null;
}

/**
 * Map one Calendar API event to the external-event shape.
 * Returns `null` for cancelled events or events without usable times.
 */
export function mapGoogleEventToExternal(
  event: GoogleApiEvent,
  calendarId: string,
): GoogleExternalEvent | null {
  if (!event || typeof event.id !== 'string' || event.id.length === 0) return null;
  if (event.status === 'cancelled') return null;
  const start = pickInstant(event.start, false);
  const end = pickInstant(event.end, true);
  if (!start || !end) return null;
  const out: GoogleExternalEvent = {
    externalId: `${calendarId}:${event.id}`,
    subject:
      typeof event.summary === 'string' && event.summary.trim().length > 0
        ? event.summary.trim()
        : '(No title)',
    start,
    end,
  };
  if (typeof event.description === 'string' && event.description.trim().length > 0) {
    out.description = event.description.trim().slice(0, 2000);
  }
  if (typeof event.updated === 'string' && event.updated.length > 0) {
    out.updated = event.updated;
  }
  return out;
}

/** Map a `calendarList.list` entry to the lightweight ref the UI shows. */
export function mapCalendarEntryToRef(entry: GoogleApiCalendarListEntry): GoogleCalendarRef {
  return {
    id: entry.id,
    summary:
      typeof entry.summary === 'string' && entry.summary.trim().length > 0
        ? entry.summary
        : entry.id,
    accessRole: entry.accessRole,
    primary: entry.primary,
    backgroundColor: entry.backgroundColor,
  };
}

/** True when the role allows creating events (owner/writer). */
export function isWritableRole(role: string | undefined): boolean {
  return role === 'owner' || role === 'writer';
}
