import { describe, expect, it } from 'vitest';
import { parseIcs } from '../icsParser';
import { normalizeExternalEvent } from '../normalizeExternalEvent';
import { createMagisterProvider } from '../magisterProvider';
import { buildRequestUrl, normalizeFeedUrl } from '../webcal';
import { syncExternalEvents } from '../sync';
import type { CalendarEvent } from '../../calendar/types';
import { MALFORMED_ICS, RANGE, SAMPLE_ICS } from './fixtures';

// ---------------------------------------------------------------- parsing

describe('parseIcs', () => {
  const events = parseIcs(SAMPLE_ICS, RANGE);

  it('parses multiple events and skips events missing required fields', () => {
    // 4 base events, of which the recurring one expands to 3 occurrences;
    // the two invalid events are dropped
    const uids = events.map((e) => e.externalId);
    expect(uids).not.toContain('orphan@magister.test');
    expect(events.length).toBe(7);
  });

  it('extracts UID as externalId (stable, un-namespaced at parser level)', () => {
    expect(events.find((e) => e.externalId === 'les-1001@magister.test')).toBeDefined();
  });

  it('parses DTSTART/DTEND (UTC) and SUMMARY', () => {
    const base = events.find((e) => e.externalId === 'les-1001@magister.test')!;
    expect(base.subject).toBe('Nederlands');
    expect(base.start).toBe('2026-09-07T07:30:00.000Z');
    expect(base.end).toBe('2026-09-07T08:15:00.000Z');
  });

  it('parses DESCRIPTION and LOCATION', () => {
    const base = events.find((e) => e.externalId === 'les-1001@magister.test')!;
    expect(base.description).toBe('Huiswerk: lees hoofdstuk 4');
    expect(base.room).toBe('B102');
  });

  it('unescapes commas, semicolons and newlines, and unfolds folded lines', () => {
    const wiskunde = events.find((e) => e.externalId === 'les-1002@magister.test')!;
    expect(wiskunde.description).toBe(
      'Opgaven 12, 13; 14\nEn een tweede regel met een heel lang aanvullend stuk tekst',
    );
  });

  it('handles timezone-aware timestamps via TZID', () => {
    const gym = events.find((e) => e.externalId === 'les-1003@magister.test')!;
    // 13:00 Amsterdam (CEST, UTC+2) in summer 2026
    expect(gym.start).toBe('2026-09-07T11:00:00.000Z');
    expect(gym.end).toBe('2026-09-07T11:45:00.000Z');
  });

  it('handles all-day events (VALUE=DATE)', () => {
    const studiedag = events.filter((e) => e.externalId === 'studiedag-1@magister.test');
    expect(studiedag.length).toBe(1);
    const day = 24 * 60 * 60 * 1000;
    expect(new Date(studiedag[0].end).getTime() - new Date(studiedag[0].start).getTime()).toBe(day);
  });

  it('expands RRULE occurrences within the range', () => {
    const occurrences = events.filter((e) => e.externalId === 'roosterwijziging@magister.test');
    expect(occurrences.length).toBe(3);
    expect(occurrences[0].start).toBe('2026-09-08T12:00:00.000Z');
    expect(occurrences[2].start).toBe('2026-09-10T12:00:00.000Z');
  });

  it('reads DTSTAMP and LAST-MODIFIED when present', () => {
    const base = events.find((e) => e.externalId === 'les-1001@magister.test')!;
    expect(base.dtStamp).toBe('2026-08-30T06:00:00.000Z');
    expect(base.lastModified).toBe('2026-08-29T12:00:00.000Z');
  });

  it('throws on malformed ICS', () => {
    expect(() => parseIcs(MALFORMED_ICS, RANGE)).toThrow();
  });
});

// ---------------------------------------------------------------- normalizing

describe('normalizeExternalEvent', () => {
  it('namespaces the UID as a stable magister:<UID> external id', () => {
    const events = parseIcs(SAMPLE_ICS, RANGE);
    const normalized = normalizeExternalEvent(events[0], 'magister', '2026-08-30T00:00:00Z');
    expect(normalized.source).toBe('external');
    expect(normalized.externalId).toBe('magister:les-1001@magister.test');
    expect(normalized.lastSyncedAt).toBe('2026-08-30T00:00:00Z');
    expect(normalized.title).toBe(events[0].subject);
  });

  it('produces identical ids for repeated imports (idempotent key)', () => {
    const a = parseIcs(SAMPLE_ICS, RANGE)[0];
    const b = parseIcs(SAMPLE_ICS, RANGE)[0];
    expect(normalizeExternalEvent(a, 'magister', 't1').externalId).toBe(
      normalizeExternalEvent(b, 'magister', 't2').externalId,
    );
  });
});

// ---------------------------------------------------------------- provider

describe('createMagisterProvider', () => {
  const okIcsResponse = () =>
    new Response(SAMPLE_ICS, { status: 200, headers: { 'Content-Type': 'text/calendar' } });

  it('fetches the feed over HTTPS, parses it and normalizes external ids', async () => {
    let requestedUrl = '';
    const provider = createMagisterProvider({
      feedUrl: 'webcal://calendar.magister.net/api/icalendar/feeds/synthetic-test-id',
      fetchImpl: async (input) => {
        requestedUrl = String(input);
        return okIcsResponse();
      },
    });

    const result = await provider.fetchSchedule(RANGE);
    expect(requestedUrl.startsWith('https://calendar.magister.net/')).toBe(true);
    expect(requestedUrl).not.toContain('webcal');
    expect(result.error).toBeUndefined();
    expect(result.providerId).toBe('magister');
    expect(result.events.length).toBeGreaterThan(0);
    const normalized = normalizeExternalEvent(result.events[0], result.providerId, result.fetchedAt);
    expect(normalized.externalId).toMatch(/^magister:/);
  });

  it('maps HTTP 401/403 to an auth error', async () => {
    const provider = createMagisterProvider({
      feedUrl: 'https://calendar.magister.net/api/icalendar/feeds/x',
      fetchImpl: async () => new Response('denied', { status: 403 }),
    });
    const result = await provider.fetchSchedule(RANGE);
    expect(result.error?.code).toBe('auth');
    expect(result.events).toEqual([]);
  });

  it('maps HTTP 429 to a rate-limit error', async () => {
    const provider = createMagisterProvider({
      feedUrl: 'https://calendar.magister.net/api/icalendar/feeds/x',
      fetchImpl: async () => new Response('slow down', { status: 429 }),
    });
    const result = await provider.fetchSchedule(RANGE);
    expect(result.error?.code).toBe('rate-limit');
  });

  it('maps network failures to a network error', async () => {
    const provider = createMagisterProvider({
      feedUrl: 'https://calendar.magister.net/api/icalendar/feeds/x',
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });
    const result = await provider.fetchSchedule(RANGE);
    expect(result.error?.code).toBe('network');
  });

  it('maps a malformed feed to a parse error', async () => {
    const provider = createMagisterProvider({
      feedUrl: 'https://calendar.magister.net/api/icalendar/feeds/x',
      fetchImpl: async () => new Response(MALFORMED_ICS, { status: 200 }),
    });
    const result = await provider.fetchSchedule(RANGE);
    expect(result.error?.code).toBe('parse');
  });
});

// ---------------------------------------------------------------- webcal handling

describe('webcal normalization', () => {
  it('converts webcal:// to https:// for the allowlisted host', () => {
    const r = normalizeFeedUrl('webcal://calendar.magister.net/api/icalendar/feeds/abc');
    expect(r).toEqual({
      ok: true,
      httpsUrl: 'https://calendar.magister.net/api/icalendar/feeds/abc',
    });
  });

  it('accepts https:// directly', () => {
    expect(normalizeFeedUrl('https://calendar.magister.net/x').ok).toBe(true);
  });

  it('rejects other protocols and non-allowlisted hosts', () => {
    expect(normalizeFeedUrl('http://calendar.magister.net/x').ok).toBe(false);
    expect(normalizeFeedUrl('ftp://calendar.magister.net/x').ok).toBe(false);
    expect(normalizeFeedUrl('webcal://evil.example.com/feed').ok).toBe(false);
    expect(normalizeFeedUrl('not a url').ok).toBe(false);
  });

  it('builds a proxied request URL without exposing a bare webcal scheme', () => {
    const r = buildRequestUrl(
      'webcal://calendar.magister.net/api/icalendar/feeds/abc',
      'https://proxy.example.com/ics',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.httpsUrl.startsWith('https://proxy.example.com/ics?url=')).toBe(true);
      expect(r.httpsUrl).toContain('https%3A%2F%2Fcalendar.magister.net');
    }
  });
});

// ---------------------------------------------------------------- sync integration

describe('syncExternalEvents with Magister ICS data', () => {
  const fetchedAt = '2026-08-30T00:00:00Z';
  const external = () => parseIcs(SAMPLE_ICS, RANGE);
  const manual: CalendarEvent = {
    id: 'manual-1',
    title: 'Mijn eigen afspraak',
    start: '2026-09-07T19:00:00.000Z',
    end: '2026-09-07T20:00:00.000Z',
    color: 'cyan',
  };

  it('imports events once; re-importing does not duplicate', () => {
    const first = syncExternalEvents([manual], external(), 'magister', fetchedAt);
    expect(first.added).toBeGreaterThan(0);
    expect(first.events.filter((e) => e.source === 'external').length).toBe(first.added);

    const second = syncExternalEvents(first.events, external(), 'magister', fetchedAt);
    expect(second.added).toBe(0);
    expect(second.updated).toBe(first.added);
    expect(second.removed).toBe(0);
    expect(second.events.length).toBe(first.events.length);
  });

  it('updates an existing imported event in place, preserving the local id and task link', () => {
    const first = syncExternalEvents([manual], external(), 'magister', fetchedAt);
    const importedId = first.events.find((e) => e.source === 'external')!.id;

    // link a task to it manually
    const linked = first.events.map((e) =>
      e.id === importedId ? { ...e, taskId: 'task-9' } : e,
    );

    // upstream now reports a changed summary for that event
    const changed = external().map((e) =>
      e.externalId === 'les-1001@magister.test' ? { ...e, subject: 'Nederlands (gewijzigd)' } : e,
    );
    const second = syncExternalEvents(linked, changed, 'magister', fetchedAt);

    const updated = second.events.find((e) => e.id === importedId)!;
    expect(updated.title).toBe('Nederlands (gewijzigd)');
    expect(updated.taskId).toBe('task-9');
    expect(second.updated).toBeGreaterThan(0);
    expect(second.added).toBe(0);
  });

  it('removes only the corresponding imported event when it disappears upstream', () => {
    const first = syncExternalEvents([manual], external(), 'magister', fetchedAt);
    const importedCount = first.events.filter((e) => e.source === 'external').length;

    const upstream = external().filter((e) => e.externalId !== 'les-1001@magister.test');
    const second = syncExternalEvents(first.events, upstream, 'magister', fetchedAt);

    expect(second.removed).toBe(1);
    expect(second.events.filter((e) => e.source === 'external').length).toBe(importedCount - 1);
    // manual event survived
    expect(second.events.some((e) => e.id === 'manual-1')).toBe(true);
  });

  it('never modifies manually-created events', () => {
    const result = syncExternalEvents([manual], external(), 'magister', fetchedAt);
    expect(result.events.find((e) => e.id === 'manual-1')).toEqual(manual);
  });
});
