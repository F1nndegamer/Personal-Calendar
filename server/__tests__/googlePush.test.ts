// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  contentKey,
  parsePushBody,
  pushErrorSummary,
  pushResponse,
  sweepOwnCopies,
  syncPushedEvents,
  MAX_PUSH_EVENTS,
} from '../googlePush.js';
import type { GoogleApiEvent, GooglePushEvent } from '../googleTypes.js';
import { eventInstant, toGoogleEventBody } from '../googleOAuth.js';
import type { PushedEventMap } from '../googleStore.js';

const ev = (id: string, over: Partial<GooglePushEvent> = {}): GooglePushEvent => ({
  id,
  title: `Event ${id}`,
  start: '2026-09-08T08:00:00.000Z',
  end: '2026-09-08T09:00:00.000Z',
  ...over,
});

/** Fake Calendar API: POST creates, PATCH updates, DELETE removes. */
function fakeFetch(opts: { onPatch?: () => { status: number } } = {}) {
  let seq = 0;
  return vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST') {
      seq += 1;
      return { ok: true, status: 201, json: async () => ({ id: `g-${seq}` }) };
    }
    if (method === 'PATCH') {
      const r = opts.onPatch?.();
      if (r && r.status >= 400) {
        return { ok: false, status: r.status, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (method === 'DELETE') {
      return { ok: true, status: 204, json: async () => ({}) };
    }
    throw new Error(`unexpected ${method} ${_url}`);
  }) as unknown as typeof fetch;
}

const noSleep = () => Promise.resolve();

describe('contentKey', () => {
  it('is stable for identical content and changes with content', () => {
    expect(contentKey(ev('a'))).toBe(contentKey(ev('a')));
    expect(contentKey(ev('a'))).not.toBe(contentKey(ev('a', { title: 'Other' })));
    expect(contentKey(ev('a'))).not.toBe(contentKey(ev('a', { start: '2026-09-09T08:00:00.000Z' })));
    expect(contentKey(ev('a'))).not.toBe(contentKey(ev('a', { description: 'x' })));
  });
});

describe('parsePushBody', () => {
  it('rejects non-objects and a missing/invalid events array', () => {
    expect(parsePushBody(null).ok).toBe(false);
    expect(parsePushBody([]).ok).toBe(false);
    expect(parsePushBody({}).ok).toBe(false);
    expect(parsePushBody({ events: 'nope' }).ok).toBe(false);
  });

  it('rejects more than MAX_PUSH_EVENTS items', () => {
    const events = Array.from({ length: MAX_PUSH_EVENTS + 1 }, (_, i) => ev(`e${i}`));
    const r = parsePushBody({ events });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at most/);
  });

  it('rejects invalid events with a specific message', () => {
    const badId = parsePushBody({ events: [{ ...ev('a'), id: '' }] });
    const badTitle = parsePushBody({ events: [{ ...ev('a'), title: '  ' }] });
    const badDate = parsePushBody({ events: [{ ...ev('a'), start: 'nope' }] });
    expect(badId.ok).toBe(false);
    expect(badTitle.ok).toBe(false);
    expect(badDate.ok).toBe(false);
    if (!badDate.ok) expect(badDate.error).toContain('start/end');
  });

  it('accepts valid events, trimming titles and capping descriptions', () => {
    const r = parsePushBody({
      events: [{ id: 'a', title: '  Wiskunde  ', start: '2026-09-08T08:00:00Z', end: '2026-09-08T09:00:00Z', description: 'x'.repeat(3000) }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.events[0].title).toBe('Wiskunde');
      expect(r.events[0].description).toHaveLength(2000);
    }
  });

  it('accepts an all-day (date-only) payload from a mirrored task', () => {
    const r = parsePushBody({
      events: [{ id: 'task:t1', title: '✓ Math homework', start: '2026-09-30', end: '2026-10-01' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.events[0]).toEqual({
      id: 'task:t1', title: '✓ Math homework', start: '2026-09-30', end: '2026-10-01',
    });
  });
});

describe('toGoogleEventBody', () => {
  it('uses `date` (never `dateTime`) for an all-day task payload', () => {
    const body = toGoogleEventBody({
      id: 'task:t1', title: 'Math homework', start: '2026-09-30', end: '2026-10-01',
    });
    expect(body).toMatchObject({
      summary: 'Math homework',
      start: { date: '2026-09-30' },
      end: { date: '2026-10-01' },
      extendedProperties: { private: { pcApp: 'personal-calendar', pcLocalId: 'task:t1' } },
    });
  });

  it('normalizes timed payloads to UTC dateTimes', () => {
    const body = toGoogleEventBody({
      id: 'e1',
      title: 'Wiskunde',
      start: '2026-09-30T08:00:00+02:00',
      end: '2026-09-30T09:00:00+02:00',
    });
    expect(body.start).toEqual({ dateTime: '2026-09-30T06:00:00.000Z' });
    expect(body.end).toEqual({ dateTime: '2026-09-30T07:00:00.000Z' });
  });

  it('treats a date-only marker as midnight UTC when it lands in a dateTime', () => {
    expect(eventInstant('2026-09-30')).toBe('2026-09-30T00:00:00.000Z');
  });
});

describe('syncPushedEvents', () => {
  const input = (events: GooglePushEvent[], pushed: PushedEventMap = {}, fetchImpl = fakeFetch()) => ({
    accessToken: 'tok',
    calendarId: 'primary',
    events,
    pushed,
    fetchImpl,
    sleep: noSleep,
  });

  it('creates new events and records them in the mapping', async () => {
    const fetchImpl = fakeFetch();
    const r = await syncPushedEvents(input([ev('a')], {}, fetchImpl));
    expect(r.stats.created).toBe(1);
    expect(r.stats.errors).toEqual([]);
    expect(r.pushed.a).toMatchObject({ calendarId: 'primary', eventId: 'g-1' });
    expect(r.pushed.a.key).toBe(contentKey(ev('a')));
  });

  it('skips unchanged events without calling the API', async () => {
    const fetchImpl = fakeFetch();
    const pushed: PushedEventMap = { a: { calendarId: 'primary', eventId: 'g-9', key: contentKey(ev('a')) } };
    const r = await syncPushedEvents(input([ev('a')], pushed, fetchImpl));
    expect(r.stats).toMatchObject({ created: 0, updated: 0, deleted: 0, skipped: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('patches changed events and keeps the mapping entry', async () => {
    const fetchImpl = fakeFetch();
    const pushed: PushedEventMap = { a: { calendarId: 'primary', eventId: 'g-9', key: contentKey(ev('a')) } };
    const changed = ev('a', { title: 'Changed' });
    const r = await syncPushedEvents(input([changed], pushed, fetchImpl));
    expect(r.stats.updated).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/calendars/primary/events/g-9');
    expect(r.pushed.a).toMatchObject({ eventId: 'g-9' });
    expect(r.pushed.a.key).toBe(contentKey(changed));
  });

  it('deletes mapped events that are no longer in the desired state', async () => {
    const fetchImpl = fakeFetch();
    const pushed: PushedEventMap = { gone: { calendarId: 'primary', eventId: 'g-5', key: 'k' } };
    const r = await syncPushedEvents(input([], pushed, fetchImpl));
    expect(r.stats.deleted).toBe(1);
    expect(r.pushed.gone).toBeUndefined();
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/events/g-5');
  });

  it('moves events when the target calendar changes', async () => {
    const fetchImpl = fakeFetch();
    const pushed: PushedEventMap = { a: { calendarId: 'old@cal', eventId: 'g-1', key: contentKey(ev('a')) } };
    const r = await syncPushedEvents({ ...input([ev('a')], pushed, fetchImpl), calendarId: 'new@cal' });
    // A move counts as one create (new copy) + one delete (old copy).
    expect(r.stats).toMatchObject({ created: 1, updated: 0, deleted: 1, skipped: 0, errors: [] });
    expect(r.pushed.a).toMatchObject({ calendarId: 'new@cal', eventId: 'g-1' });
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/calendars/new%40cal/events'))).toBe(true);
    expect(urls.some((u) => u.includes('/calendars/old%40cal/events/g-1'))).toBe(true);
  });

  it('records a 404 on update and drops the stale mapping entry', async () => {
    const fetchImpl = fakeFetch({ onPatch: () => ({ status: 404 }) });
    const pushed: PushedEventMap = { a: { calendarId: 'primary', eventId: 'g-9', key: 'old' } };
    const r = await syncPushedEvents(input([ev('a', { title: 'Changed' })], pushed, fetchImpl));
    expect(r.stats.updated).toBe(0);
    expect(r.stats.errors).toHaveLength(1);
    expect(r.pushed.a).toBeUndefined();
  });

  it('retries once with backoff on 429', async () => {
    let calls = 0;
    const sleep = vi.fn();
    const fetchImpl = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 429, json: async () => ({}) };
      return { ok: true, status: 201, json: async () => ({ id: 'g-ok' }) };
    }) as unknown as typeof fetch;
    const r = await syncPushedEvents({ ...input([ev('a')], {}, fetchImpl), sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(r.stats.created).toBe(1);
    expect(r.stats.errors).toEqual([]);
    expect(r.pushed.a.eventId).toBe('g-ok');
  });

  it('throws on 401 so the route can refresh the token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }) as unknown as typeof fetch;
    await expect(syncPushedEvents(input([ev('a')], {}, fetchImpl))).rejects.toThrow(/401/);
  });
});

describe('push summaries', () => {
  it('summarizes errors and builds the response body', () => {
    const stats = { created: 1, updated: 2, deleted: 0, skipped: 3, errors: [] };
    expect(pushErrorSummary(stats)).toBeUndefined();
    expect(pushResponse(stats)).toEqual({ ok: true, created: 1, updated: 2, deleted: 0, skipped: 3, errors: [] });
    const failed = { ...stats, errors: [{ id: 'a', error: 'Event create failed with HTTP 500' }] };
    expect(pushErrorSummary(failed)).toMatch(/Push failed for 1 event/);
    expect(pushResponse(failed).ok).toBe(false);
  });

  it('reports swept copies and omits the field when there were none', () => {
    const stats = { created: 0, updated: 0, deleted: 0, skipped: 1, errors: [] };
    expect(pushResponse(stats, 3)).toMatchObject({ swept: 3 });
    expect(pushResponse(stats)).not.toHaveProperty('swept');
  });
});

/**
 * A failed push run used to lose the copies it had already created (the
 * mapping was only written after the whole run), so the token-refresh retry
 * created them a second time — and those untracked copies came back through
 * the import as duplicates of the event they mirror.
 */
describe('syncPushedEvents progress persistence', () => {
  /** POSTs succeed until `failOn` (1-based), from where they return 401. */
  function flakyFetch(failOn: number) {
    let posts = 0;
    return vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        posts += 1;
        const n = posts;
        if (n >= failOn) return { ok: false, status: 401, json: async () => ({}) };
        return { ok: true, status: 201, json: async () => ({ id: `g-${n}` }) };
      }
      return { ok: true, status: 204, json: async () => ({}) };
    }) as unknown as typeof fetch;
  }

  const push = (
    events: GooglePushEvent[],
    pushed: PushedEventMap,
    fetchImpl: typeof fetch,
    persist: (next: PushedEventMap) => void,
  ) => ({
    accessToken: 'tok', calendarId: 'primary', events, pushed, fetchImpl, sleep: noSleep, persist,
  });

  it('persists the copies created before a mid-run failure', async () => {
    const persisted: PushedEventMap[] = [];
    await expect(
      syncPushedEvents(push([ev('a'), ev('b'), ev('c')], {}, flakyFetch(3), (p) => persisted.push({ ...p }))),
    ).rejects.toThrow(/401/);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ a: { eventId: 'g-1' }, b: { eventId: 'g-2' } });
    expect(persisted[0].c).toBeUndefined();
  });

  it('lets the retry reuse those copies instead of duplicating them', async () => {
    const persisted: PushedEventMap = {};
    await expect(
      syncPushedEvents(push([ev('a'), ev('b')], {}, flakyFetch(2), (p) => Object.assign(persisted, p))),
    ).rejects.toThrow(/401/);
    expect(persisted.a).toBeDefined();

    const fetchImpl = fakeFetch();
    const r = await syncPushedEvents(push([ev('a'), ev('b')], { ...persisted }, fetchImpl, () => undefined));
    expect(r.stats).toMatchObject({ created: 1, skipped: 1, deleted: 0 });
    expect(r.pushed.a).toEqual(persisted.a);
  });

  it('does not write when a batch changed nothing', async () => {
    const persist = vi.fn();
    const pushed: PushedEventMap = { a: { calendarId: 'primary', eventId: 'g-9', key: contentKey(ev('a')) } };
    await syncPushedEvents(push([ev('a')], pushed, fakeFetch(), persist));
    expect(persist).not.toHaveBeenCalled();
  });
});

/** Repair pass for copies older pushes left behind in imported calendars. */
describe('sweepOwnCopies', () => {
  const payload = (over: Partial<GooglePushEvent> = {}): GooglePushEvent => ({
    id: 'local-1',
    title: '3 Nat - LOO',
    start: '2026-09-21T08:30:00.000Z',
    end: '2026-09-21T09:15:00.000Z',
    description: ' · Lokaal z023',
    ...over,
  });

  const item = (over: Partial<GoogleApiEvent> = {}): GoogleApiEvent => ({
    id: 'stray',
    summary: '3 Nat - LOO',
    description: '· Lokaal z023',
    start: { dateTime: '2026-09-21T08:30:00Z' },
    end: { dateTime: '2026-09-21T09:15:00Z' },
    ...over,
  });

  const tagged = (over: Partial<GoogleApiEvent> = {}): GoogleApiEvent =>
    item({ extendedProperties: { private: { pcApp: 'personal-calendar' } }, ...over });

  /** Mapping evidence: we know this local event has a copy in the target. */
  const mapped: PushedEventMap = {
    'local-1': { calendarId: 'websync', eventId: 'g-1', key: 'k' },
  };

  function sweepFetch(
    byCalendar: Record<string, GoogleApiEvent[]>,
    opts: { deleteStatus?: number; listStatus?: number } = {},
  ) {
    const calls: { method: string; url: string }[] = [];
    const fetchImpl = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ method, url: u });
      if (method === 'DELETE') {
        if (opts.deleteStatus && opts.deleteStatus >= 400) {
          return { ok: false, status: opts.deleteStatus, json: async () => ({}) };
        }
        return { ok: true, status: 204, json: async () => ({}) };
      }
      if (opts.listStatus && opts.listStatus >= 400) {
        return { ok: false, status: opts.listStatus, json: async () => ({}) };
      }
      const calId = decodeURIComponent(/\/calendars\/([^/?]+)\/events/.exec(u)?.[1] ?? '');
      return { ok: true, status: 200, json: async () => ({ items: byCalendar[calId] ?? [] }) };
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  const sweep = (
    fetchImpl: typeof fetch,
    over: Partial<Parameters<typeof sweepOwnCopies>[0]> = {},
  ) => sweepOwnCopies({
    accessToken: 'tok',
    pushCalendarId: 'websync',
    calendarIds: ['websync', 'primary'],
    events: [payload()],
    pushed: mapped,
    fetchImpl,
    ...over,
  });

  it('deletes tagged copies from imported calendars but never touches the target', async () => {
    const { fetchImpl, calls } = sweepFetch({ primary: [tagged()], websync: [tagged()] });
    expect(await sweep(fetchImpl)).toEqual({ deleted: 1, errors: [] });
    const lists = calls.filter((c) => c.method === 'GET');
    expect(lists).toHaveLength(1);
    expect(lists[0].url).toContain('/calendars/primary/events');
    expect(
      calls.some((c) => c.method === 'DELETE' && c.url.includes('/calendars/primary/events/stray')),
    ).toBe(true);
  });

  it('deletes an untagged copy whose content matches a mapped local event', async () => {
    // The Google description is trimmed, the local one keeps its leading space.
    const { fetchImpl } = sweepFetch({ primary: [item()] });
    expect(await sweep(fetchImpl)).toEqual({ deleted: 1, errors: [] });
  });

  it('matches an all-day copy of a mirrored task (date-only payload)', async () => {
    const taskPayload = payload({
      id: 'task:t1',
      title: '✓ Math homework',
      start: '2026-09-30',
      end: '2026-10-01',
      description: '— Personal Calendar task',
    });
    const allDayCopy = item({
      id: 'task-copy',
      summary: '✓ Math homework',
      description: '— Personal Calendar task',
      start: { date: '2026-09-30' },
      end: { date: '2026-10-01' },
    });
    const { fetchImpl, calls } = sweepFetch({ primary: [allDayCopy] });
    const r = await sweep(fetchImpl, {
      events: [taskPayload],
      pushed: { 'task:t1': { calendarId: 'websync', eventId: 'g-2', key: 'k' } },
    });
    expect(r).toEqual({ deleted: 1, errors: [] });
    expect(
      calls.some((c) => c.method === 'DELETE' && c.url.includes('/events/task-copy')),
    ).toBe(true);
  });

  it('keeps copies it cannot prove are ours', async () => {
    const noEvidence = sweepFetch({ primary: [item()] });
    expect(await sweep(noEvidence.fetchImpl, { pushed: {} })).toEqual({ deleted: 0, errors: [] });

    const otherDescription = sweepFetch({ primary: [item({ description: 'Iets anders' })] });
    expect(await sweep(otherDescription.fetchImpl)).toEqual({ deleted: 0, errors: [] });

    const otherTitle = sweepFetch({ primary: [item({ summary: 'Ander vak' })] });
    expect(await sweep(otherTitle.fetchImpl)).toEqual({ deleted: 0, errors: [] });

    expect(noEvidence.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('leaves foreign events in imported calendars alone', async () => {
    const foreign = item({
      id: 'tandarts',
      summary: 'Tandarts',
      description: undefined,
      start: { dateTime: '2026-09-22T13:00:00Z' },
      end: { dateTime: '2026-09-22T13:30:00Z' },
    });
    const { fetchImpl, calls } = sweepFetch({ primary: [foreign] });
    expect(await sweep(fetchImpl)).toEqual({ deleted: 0, errors: [] });
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('collects failures instead of throwing', async () => {
    const failingDelete = sweepFetch({ primary: [tagged()] }, { deleteStatus: 403 });
    const r = await sweep(failingDelete.fetchImpl);
    expect(r.deleted).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].id).toBe('primary:stray');
    expect(r.errors[0].error).toContain('403');

    const failingList = sweepFetch({}, { listStatus: 500 });
    const listResult = await sweep(failingList.fetchImpl);
    expect(listResult.deleted).toBe(0);
    expect(listResult.errors.map((e) => e.id)).toEqual(['primary']);
  });

  it('does nothing without a payload or without another calendar', async () => {
    const noPayload = sweepFetch({ primary: [tagged()] });
    expect(await sweep(noPayload.fetchImpl, { events: [] })).toEqual({ deleted: 0, errors: [] });

    const targetOnly = sweepFetch({ primary: [tagged()] });
    expect(await sweep(targetOnly.fetchImpl, { calendarIds: ['websync'] }))
      .toEqual({ deleted: 0, errors: [] });

    expect(noPayload.calls).toHaveLength(0);
    expect(targetOnly.calls).toHaveLength(0);
  });
});
