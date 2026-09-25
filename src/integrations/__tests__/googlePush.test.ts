import { describe, expect, it, vi } from 'vitest';
import { collectPushEvents, pushToGoogle, setPushTarget } from '../googlePush';
import type { CalendarEvent } from '../../calendar/types';

function local(id: string, over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    title: 'Event',
    start: '2026-09-08T08:00:00.000Z',
    end: '2026-09-08T09:00:00.000Z',
    color: 'blue',
    source: 'local',
    ...over,
  };
}

describe('collectPushEvents', () => {
  it('includes manual and Magister events but never Google-sourced ones', () => {
    const manual = local('m1');
    const magister = local('x1', { source: 'external', externalId: 'magister:123' });
    const google = local('g1', { source: 'external', externalId: 'google:abc' });
    const out = collectPushEvents([manual, magister, google]);
    expect(out.map((e) => e.id)).toEqual(['m1', 'x1']);
  });

  it('normalizes titles and only sends descriptions that exist', () => {
    const out = collectPushEvents([local('a', { title: '  ', description: 'room 4' })]);
    expect(out[0].title).toBe('Untitled event');
    expect(out[0].description).toBe('room 4');
    const plain = collectPushEvents([local('b')]);
    expect(plain[0]).not.toHaveProperty('description');
    expect(plain[0]).toMatchObject({ id: 'b', start: local('b').start, end: local('b').end });
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('pushToGoogle', () => {
  it('posts the full event list and maps the response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { ok: true, created: 2, updated: 1, deleted: 0, skipped: 3, errors: [] }),
    );
    const events = [{ id: 'a', title: 'T', start: '2026-09-08T08:00:00Z', end: '2026-09-08T09:00:00Z' }];
    const r = await pushToGoogle(events, fetchImpl);
    expect(r).toMatchObject({ ok: true, created: 2, updated: 1, skipped: 3, error: undefined });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/google/push');
    expect(JSON.parse(String(init.body))).toEqual({ events });
  });

  it('treats 429 as a benign busy signal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { ok: false, error: 'busy' }));
    const r = await pushToGoogle([], fetchImpl);
    expect(r).toMatchObject({ ok: true, busy: true });
  });

  it('surfaces HTTP and partial-failure errors', async () => {
    const fatal = vi.fn().mockResolvedValue(jsonResponse(500, { ok: false, error: 'server exploded' }));
    const r1 = await pushToGoogle([], fatal);
    expect(r1).toMatchObject({ ok: false, error: 'server exploded' });

    const partial = vi.fn().mockResolvedValue(jsonResponse(200, {
      ok: false, created: 1, updated: 0, deleted: 0, skipped: 0,
      errors: [{ id: 'a', error: 'Event create failed with HTTP 500' }],
    }));
    const r2 = await pushToGoogle([], partial);
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/HTTP 500/);
  });

  it('never throws on a network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const r = await pushToGoogle([], fetchImpl);
    expect(r).toMatchObject({ ok: false, error: 'offline' });
  });
});

describe('setPushTarget', () => {
  it('posts the calendar id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    await setPushTarget('work@example.com', fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/google/push-target');
    expect(JSON.parse(String(init.body))).toEqual({ calendarId: 'work@example.com' });
  });

  it('throws the server error message on failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { ok: false, error: 'That calendar is read-only' }));
    await expect(setPushTarget('primary', fetchImpl)).rejects.toThrow(/read-only/);
  });
});
