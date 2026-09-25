/**
 * Duplicate-import guard for Google Calendar imports.
 *
 * The push feature mirrors local + Magister events into a Google calendar. The
 * server filters its own copies out of the import, but a copy that it can no
 * longer recognise — created by a push run that died before the mapping was
 * saved — came back as an ordinary Google event, so the same lesson showed up
 * twice in the app.
 *
 * Content is the ground truth here: a Google event that is not one of our
 * Google imports and exactly matches a manual or Magister event (title + start
 * + end) is a copy of data we already own. It is dropped, and the non-Google
 * event stays the single source of truth — the app never shows the same thing
 * twice. Google-vs-Google collisions (two calendars publishing the same event)
 * are left alone: those are the user's own imports.
 */
import type { CalendarEvent } from '../calendar/types';
import type { ExternalScheduleEvent } from './types';

/** Matches `createGoogleProvider().id` in googleProvider.ts. */
export const GOOGLE_PROVIDER_ID = 'google';

/** Namespace prefix of imported events, e.g. `google:<calendarId>:<eventId>`. */
const GOOGLE_PROVIDER_PREFIX = `${GOOGLE_PROVIDER_ID}:`;

/** ISO instant for comparisons — tolerates `Z` vs `.000Z` and bad input. */
function instant(iso: string): string {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? iso : new Date(t).toISOString();
}

/** Identity of an event for "is this the same thing?" comparisons. */
function signature(title: string, start: string, end: string): string {
  return `${title.trim().toLowerCase()}\u0000${instant(start)}\u0000${instant(end)}`;
}

/** True for events that were imported FROM Google. */
function isGoogleImport(ev: CalendarEvent): boolean {
  return (
    ev.source === 'external' &&
    typeof ev.externalId === 'string' &&
    ev.externalId.startsWith(GOOGLE_PROVIDER_PREFIX)
  );
}

/**
 * Remove incoming Google events that mirror an event the app already has from a
 * non-Google source. `current` is the merged state before this provider is
 * applied; `alsoKnown` carries the other providers of the *same* sync round, so
 * the very first sync is covered too (provider order never matters).
 */
export function withoutDuplicateMirrors(
  current: readonly CalendarEvent[],
  incoming: readonly ExternalScheduleEvent[],
  alsoKnown: readonly ExternalScheduleEvent[] = [],
): ExternalScheduleEvent[] {
  const owned = new Set<string>();
  for (const ev of current) {
    if (isGoogleImport(ev)) continue;
    owned.add(signature(ev.title, ev.start, ev.end));
  }
  for (const ext of alsoKnown) {
    owned.add(signature(ext.subject, ext.start, ext.end));
  }
  if (owned.size === 0) return [...incoming];
  return incoming.filter((ext) => !owned.has(signature(ext.subject, ext.start, ext.end)));
}
