import { describe, expect, it } from 'vitest';
import { GOOGLE_PROVIDER_ID, withoutDuplicateMirrors } from '../duplicates';
import type { CalendarEvent } from '../../calendar/types';
import type { ExternalScheduleEvent } from '../types';

const START = '2026-09-21T08:30:00.000Z';
const END = '2026-09-21T09:15:00.000Z';

/** A Magister lesson as it lives in the local event list. */
const lesson: CalendarEvent = {
  id: 'ext-magister:1',
  title: '3 Nat - LOO',
  start: START,
  end: END,
  color: 'blue',
  category: 'School',
  source: 'external',
  externalId: 'magister:1',
};

/** The same lesson as a Google *import* (different times format, same moment). */
const googleImport = (title = '3 Nat - LOO'): CalendarEvent => ({
  id: 'ext-google:cal:abc',
  title,
  start: '2026-09-21T08:30:00Z',
  end: '2026-09-21T09:15:00Z',
  color: 'blue',
  source: 'external',
  externalId: 'google:cal:abc',
});

/** What the Google provider returns for one of our own pushed copies. */
const incomingMirror = (over: Partial<ExternalScheduleEvent> = {}): ExternalScheduleEvent => ({
  externalId: 'cal:abc',
  subject: '3 nat - loo',
  start: '2026-09-21T08:30:00.000Z',
  end: '2026-09-21T09:15:00.000Z',
  ...over,
});

describe('withoutDuplicateMirrors', () => {
  it('drops a Google event that mirrors a Magister lesson', () => {
    expect(withoutDuplicateMirrors([lesson], [incomingMirror()])).toEqual([]);
  });

  it('drops a mirror of a manual event, ignoring case and Z/.000Z spelling', () => {
    const manual: CalendarEvent = {
      id: 'ev-1',
      title: 'Untitled event',
      start: '2026-10-08T20:05:00.000Z',
      end: '2026-10-08T21:05:00.000Z',
      color: 'blue',
    };
    const incoming = incomingMirror({
      subject: 'Untitled Event',
      start: '2026-10-08T20:05:00Z',
      end: '2026-10-08T21:05:00Z',
    });
    expect(withoutDuplicateMirrors([manual], [incoming])).toEqual([]);
  });

  it('keeps Google events with different times or a different title', () => {
    const other = incomingMirror({ subject: 'Huiswerk inleveren' });
    const shifted = incomingMirror({ start: '2026-09-21T09:30:00.000Z' });
    expect(withoutDuplicateMirrors([lesson], [other, shifted])).toHaveLength(2);
  });

  it('never dedupes Google against Google (other imports stay)', () => {
    const incoming = incomingMirror();
    expect(withoutDuplicateMirrors([googleImport()], [incoming])).toEqual([incoming]);
  });

  it('uses the reference set from the same sync round', () => {
    // First sync ever: the Magister lesson is not in the local list yet, but it
    // is part of this round's payload from the other provider.
    const magisterRound: ExternalScheduleEvent[] = [incomingMirror({
      externalId: 'magister:1',
      subject: '3 Nat - LOO',
    })];
    expect(withoutDuplicateMirrors([], [incomingMirror()], magisterRound)).toEqual([]);
  });

  it('returns the incoming events untouched when nothing is owned', () => {
    const incoming = [incomingMirror(), incomingMirror({ externalId: 'cal:def' })];
    expect(withoutDuplicateMirrors([], incoming)).toEqual(incoming);
    // …and the provider id is the Google one.
    expect(GOOGLE_PROVIDER_ID).toBe('google');
  });
});
