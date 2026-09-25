// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  contentKey,
  parsePushBody,
  pushErrorSummary,
  pushResponse,
  syncPushedEvents,
  MAX_PUSH_EVENTS,
} from '../googlePush.js';
import type { GooglePushEvent } from '../googleTypes.js';
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
});
