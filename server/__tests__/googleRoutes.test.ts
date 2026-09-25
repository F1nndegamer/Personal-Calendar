// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleGoogleRequest, isGooglePath, setPushInFlight } from '../googleRoutes.js';
import { contentKey } from '../googlePush.js';
import type { GoogleAuthData } from '../googleStore.js';

function makeReq(url: string, method = 'GET', headers: Record<string, string> = {}): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  (req as unknown as { url: string }).url = url;
  (req as unknown as { method: string }).method = method;
  const lowered: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
  (req as unknown as { headers: Record<string, string> }).headers = lowered;
  (req as unknown as { destroy(): void }).destroy = () => undefined;
  return req as IncomingMessage;
}

function makeRes(): ServerResponse & {
  statusCode: number;
  headers: Record<string, string>;
  body(): string;
} {
  const ee = new EventEmitter();
  const chunks: Buffer[] = [];
  const res = Object.assign(ee, {
    statusCode: 0,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string | number): void {
      res.headers[name.toLowerCase()] = String(value);
    },
    getHeader(name: string): string | undefined {
      return res.headers[name.toLowerCase()];
    },
    removeHeader(name: string): void {
      delete res.headers[name.toLowerCase()];
    },
    getHeaderNames(): string[] {
      return Object.keys(res.headers);
    },
    writeHead(status: number, headers?: Record<string, string | number>): ServerResponse {
      res.statusCode = status;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          res.headers[k.toLowerCase()] = String(v);
        }
      }
      return res;
    },
    write(chunk: string | Buffer): boolean {
      chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk?: string | Buffer): ServerResponse {
      if (chunk !== undefined) chunks.push(Buffer.from(chunk));
      return res;
    },
    body(): string {
      return Buffer.concat(chunks).toString('utf-8');
    },
  }) as unknown as ServerResponse & {
    statusCode: number;
    headers: Record<string, string>;
    body(): string;
  };
  return res;
}

const ENV_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:5173/api/google/callback';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function connectedAuth(): GoogleAuthData {
  return {
    tokens: {
      accessToken: 'access-token',
      expiresAt: Date.now() + 3_600_000,
      refreshToken: 'refresh-token',
    },
    email: 'me@example.com',
  };
}

/** POST a JSON payload through `handleGoogleRequest` (body via microtask). */
async function postJson(
  url: string,
  payload: unknown,
  deps?: Parameters<typeof handleGoogleRequest>[3],
): Promise<ReturnType<typeof makeRes>> {
  const res = makeRes();
  const req = makeReq(url, 'POST', { 'Content-Type': 'application/json' });
  queueMicrotask(() => {
    req.emit('data', Buffer.from(JSON.stringify(payload)));
    req.emit('end');
  });
  await handleGoogleRequest(req, res, url, deps);
  await new Promise((r) => setTimeout(r, 10));
  return res;
}

/** Calendar-list + events fetch mock for push routes. */
function pushFetch(accessRole = 'owner'): { fetchImpl: typeof fetch; posts: string[] } {
  const posts: string[] = [];
  const fetchImpl = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u.includes('/users/me/calendarList')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          items: [{ id: 'primary', summary: 'My primary calendar', primary: true, accessRole }],
        }),
      };
    }
    if (method === 'POST' && u.includes('/calendars/primary/events')) {
      posts.push(u);
      return { ok: true, status: 201, json: async () => ({ id: 'g-new' }) };
    }
    if (method === 'PATCH' && u.includes('/calendars/primary/events/')) {
      posts.push(u);
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (method === 'DELETE' && u.includes('/calendars/primary/events/')) {
      posts.push(u);
      return { ok: true, status: 204, json: async () => ({}) };
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, posts };
}

describe('isGooglePath', () => {
  it('recognises exactly the Google endpoints', () => {
    for (const p of [
      '/api/google/status',
      '/api/google/login',
      '/api/google/callback?code=x&state=y',
      '/api/google/logout',
      '/api/google/selection',
      '/api/google/events?timeMin=a&timeMax=b',
      '/api/google/push',
      '/api/google/push-target',
    ]) {
      expect(isGooglePath(p)).toBe(true);
    }
    expect(isGooglePath('/api/storage')).toBe(false);
    expect(isGooglePath('/api/googlex')).toBe(false);
  });
});

describe('handleGoogleRequest', () => {
  it('answers 200 with an explanatory error on status when OAuth is not configured', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const res = makeRes();
    const handled = await handleGoogleRequest(
      makeReq('/api/google/status'), res, '/api/google/status',
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body()) as { connected: boolean; error?: string };
    expect(body.connected).toBe(false);
    expect(body.error).toMatch(/not configured/i);
  });

  it('answers 501 on login when OAuth is not configured', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const res = makeRes();
    await handleGoogleRequest(makeReq('/api/google/login'), res, '/api/google/login');
    expect(res.statusCode).toBe(501);
  });

  it('returns connected status with calendars and a default selection', async () => {
    const writeAuth = vi.fn();
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/users/me/calendarList')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: 'primary', summary: 'My primary calendar', primary: true, accessRole: 'owner' },
              { id: 'work@example.com', summary: 'Work' },
            ],
          }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const res = makeRes();
    const handled = await handleGoogleRequest(
      makeReq('/api/google/status'), res, '/api/google/status',
      { readAuth: () => connectedAuth(), writeAuth, fetchImpl },
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body()) as {
      connected: boolean;
      email?: string;
      calendars: { id: string }[];
      selectedCalendarIds: string[];
    };
    expect(body.connected).toBe(true);
    expect(body.email).toBe('me@example.com');
    expect(body.calendars.map((c) => c.id)).toEqual(['primary', 'work@example.com']);
    expect(body.selectedCalendarIds).toEqual(['primary']);
    expect(writeAuth).not.toHaveBeenCalled();
  });

  it('reports disconnected when no tokens are stored', async () => {
    const res = makeRes();
    await handleGoogleRequest(
      makeReq('/api/google/status'), res, '/api/google/status',
      { readAuth: () => ({ tokens: null }), writeAuth: vi.fn() },
    );
    const body = JSON.parse(res.body()) as { connected: boolean; calendars: unknown[] };
    expect(body.connected).toBe(false);
    expect(body.calendars).toEqual([]);
  });

  it('answers 401 on events when Google is not connected', async () => {
    const res = makeRes();
    const url = '/api/google/events?timeMin=2026-09-07T00:00:00Z&timeMax=2026-09-14T00:00:00Z';
    await handleGoogleRequest(makeReq(url), res, url, {
      readAuth: () => ({ tokens: null }),
      writeAuth: vi.fn(),
    });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/not connected/i);
  });

  it('rejects events requests with an invalid range', async () => {
    const res = makeRes();
    const url = '/api/google/events?timeMin=nope&timeMax=2026-09-14T00:00:00Z';
    await handleGoogleRequest(makeReq(url), res, url, {
      readAuth: () => connectedAuth(),
      writeAuth: vi.fn(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('serves events for the selected calendars and records the sync', async () => {
    const auth: GoogleAuthData = { ...connectedAuth(), selectedCalendarIds: ['cal-1'] };
    const writeAuth = vi.fn();
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/calendars/cal-1/events')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: 'e1',
                summary: 'Wiskunde',
                start: { dateTime: '2026-09-08T08:00:00Z' },
                end: { dateTime: '2026-09-08T09:00:00Z' },
              },
            ],
          }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const res = makeRes();
    const url = '/api/google/events?timeMin=2026-09-07T00:00:00Z&timeMax=2026-09-14T00:00:00Z';
    await handleGoogleRequest(makeReq(url), res, url, {
      readAuth: () => auth,
      writeAuth,
      fetchImpl,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body()) as {
      ok: boolean;
      events: { externalId: string; subject: string }[];
    };
    expect(body.ok).toBe(true);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].externalId).toBe('cal-1:e1');
    expect(body.events[0].subject).toBe('Wiskunde');
    expect(writeAuth).toHaveBeenCalledWith(
      expect.objectContaining({ lastSyncAt: expect.any(Number) }),
    );
  });

  it('saves a calendar selection', async () => {
    const writeAuth = vi.fn();
    const res = makeRes();
    const payload = JSON.stringify({ calendarIds: ['a', 'b'] });
    const req = makeReq('/api/google/selection', 'POST', { 'Content-Type': 'application/json' });
    queueMicrotask(() => {
      req.emit('data', Buffer.from(payload));
      req.emit('end');
    });

    const handled = await handleGoogleRequest(req, res, '/api/google/selection', {
      readAuth: () => connectedAuth(),
      writeAuth,
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(writeAuth).toHaveBeenCalledWith(
      expect.objectContaining({ selectedCalendarIds: ['a', 'b'] }),
    );
  });

  it('rejects an invalid calendar selection', async () => {
    const res = makeRes();
    const req = makeReq('/api/google/selection', 'POST', { 'Content-Type': 'application/json' });
    queueMicrotask(() => {
      req.emit('data', Buffer.from(JSON.stringify({ calendarIds: 42 })));
      req.emit('end');
    });
    await handleGoogleRequest(req, res, '/api/google/selection', {
      readAuth: () => connectedAuth(),
      writeAuth: vi.fn(),
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(res.statusCode).toBe(400);
  });

  it('clears tokens on logout', async () => {
    const writeAuth = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const res = makeRes();
    await handleGoogleRequest(
      makeReq('/api/google/logout', 'POST'), res, '/api/google/logout',
      {
        readAuth: () => connectedAuth(),
        writeAuth,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body())).toEqual({ ok: true });
    expect(writeAuth).toHaveBeenCalledWith({ tokens: null, email: undefined });
  });

  it('redirects to Google with a CSRF state on login', async () => {
    const res = makeRes();
    await handleGoogleRequest(makeReq('/api/google/login'), res, '/api/google/login', {
      readAuth: () => ({ tokens: null }),
      writeAuth: vi.fn(),
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location ?? '';
    expect(location).toContain('accounts.google.com');
    expect(location).toContain('state=');
    expect(location).toContain('test-client-id');
  });

  it('redirects to the frontend with an error on a callback with an unknown state', async () => {
    const res = makeRes();
    const url = '/api/google/callback?code=abc&state=stale';
    await handleGoogleRequest(
      makeReq(url, 'GET', { host: 'localhost:5173' }), res, url,
      { readAuth: () => ({ tokens: null }), writeAuth: vi.fn() },
    );
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/?google=error');
  });

  it('rejects a push with an invalid body', async () => {
    const res = await postJson('/api/google/push', { events: 'nope' }, {
      readAuth: () => connectedAuth(), writeAuth: vi.fn(),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body()).error).toMatch(/events must be an array/);
  });

  it('answers 401 on push when Google is not connected', async () => {
    const res = await postJson('/api/google/push', { events: [] }, {
      readAuth: () => ({ tokens: null }), writeAuth: vi.fn(),
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body()).error).toMatch(/not connected/i);
  });

  it('no-ops an empty push without touching Google', async () => {
    const { fetchImpl } = pushFetch();
    const res = await postJson('/api/google/push', { events: [] }, {
      readAuth: () => connectedAuth(), writeAuth: vi.fn(), fetchImpl,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body())).toMatchObject({ ok: true, created: 0, deleted: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('creates pushed events and stores mapping + target + timestamp', async () => {
    const { fetchImpl, posts } = pushFetch();
    const writeAuth = vi.fn();
    const event = { id: 'a', title: 'Wiskunde', start: '2026-09-08T08:00:00Z', end: '2026-09-08T09:00:00Z' };
    const res = await postJson('/api/google/push', { events: [event] }, {
      readAuth: () => connectedAuth(), writeAuth, fetchImpl,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body())).toMatchObject({ ok: true, created: 1, skipped: 0 });
    expect(posts).toHaveLength(1);
    expect(writeAuth).toHaveBeenCalledWith(expect.objectContaining({
      pushCalendarId: 'primary',
      lastPushAt: expect.any(Number),
      lastPushError: undefined,
      pushed: expect.objectContaining({
        a: { calendarId: 'primary', eventId: 'g-new', key: expect.any(String) },
      }),
    }));
  });

  it('skips unchanged events on push', async () => {
    const { fetchImpl, posts } = pushFetch();
    const event = { id: 'a', title: 'Wiskunde', start: '2026-09-08T08:00:00Z', end: '2026-09-08T09:00:00Z' };
    const auth: GoogleAuthData = {
      ...connectedAuth(),
      pushed: { a: { calendarId: 'primary', eventId: 'g-9', key: contentKey(event) } },
    };
    const res = await postJson('/api/google/push', { events: [event] }, {
      readAuth: () => auth, writeAuth: vi.fn(), fetchImpl,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body())).toMatchObject({ ok: true, created: 0, skipped: 1 });
    expect(posts).toHaveLength(0);
  });

  it('deletes mapped events missing from the payload', async () => {
    const { fetchImpl, posts } = pushFetch();
    const auth: GoogleAuthData = {
      ...connectedAuth(),
      pushed: { gone: { calendarId: 'primary', eventId: 'g-del', key: 'k' } },
    };
    const res = await postJson('/api/google/push', { events: [] }, {
      readAuth: () => auth, writeAuth: vi.fn(), fetchImpl,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body())).toMatchObject({ ok: true, deleted: 1 });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain('/events/g-del');
  });

  it('answers 403 when the push target calendar is read-only', async () => {
    const { fetchImpl } = pushFetch('reader');
    const event = { id: 'a', title: 'X', start: '2026-09-08T08:00:00Z', end: '2026-09-08T09:00:00Z' };
    const res = await postJson('/api/google/push', { events: [event] }, {
      readAuth: () => connectedAuth(), writeAuth: vi.fn(), fetchImpl,
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body()).error).toMatch(/read-only/i);
  });

  it('answers 429 while another push is running and recovers after', async () => {
    setPushInFlight(true);
    try {
      const res = await postJson('/api/google/push', { events: [] }, {
        readAuth: () => connectedAuth(), writeAuth: vi.fn(),
      });
      expect(res.statusCode).toBe(429);
    } finally {
      setPushInFlight(false);
    }
    const res2 = await postJson('/api/google/push', { events: [] }, {
      readAuth: () => connectedAuth(), writeAuth: vi.fn(),
    });
    expect(res2.statusCode).toBe(200);
  });

  it('saves a writable push target calendar', async () => {
    const { fetchImpl } = pushFetch();
    const writeAuth = vi.fn();
    const res = await postJson('/api/google/push-target', { calendarId: 'primary' }, {
      readAuth: () => connectedAuth(), writeAuth, fetchImpl,
    });
    expect(res.statusCode).toBe(200);
    expect(writeAuth).toHaveBeenCalledWith(expect.objectContaining({ pushCalendarId: 'primary' }));
  });

  it('rejects a missing or read-only push target', async () => {
    const missing = await postJson('/api/google/push-target', { calendarId: 'nope@cal' }, {
      readAuth: () => connectedAuth(), writeAuth: vi.fn(), fetchImpl: pushFetch().fetchImpl,
    });
    expect(missing.statusCode).toBe(400);
    const bad = await postJson('/api/google/push-target', { calendarId: 42 }, {
      readAuth: () => connectedAuth(), writeAuth: vi.fn(),
    });
    expect(bad.statusCode).toBe(400);
    const readOnly = await postJson('/api/google/push-target', { calendarId: 'primary' }, {
      readAuth: () => connectedAuth(), writeAuth: vi.fn(), fetchImpl: pushFetch('reader').fetchImpl,
    });
    expect(readOnly.statusCode).toBe(403);
  });

  it('excludes pushed events from imports', async () => {
    const auth: GoogleAuthData = {
      ...connectedAuth(),
      selectedCalendarIds: ['cal-1'],
      pushed: { a: { calendarId: 'cal-1', eventId: 'e1', key: 'k' } },
    };
    const fetchImpl = vi.fn().mockImplementation(async () => ({
      ok: true, status: 200,
      json: async () => ({
        items: [{
          id: 'e1', summary: 'Wiskunde',
          start: { dateTime: '2026-09-08T08:00:00Z' },
          end: { dateTime: '2026-09-08T09:00:00Z' },
        }],
      }),
    })) as unknown as typeof fetch;
    const res = makeRes();
    const url = '/api/google/events?timeMin=2026-09-07T00:00:00Z&timeMax=2026-09-14T00:00:00Z';
    await handleGoogleRequest(makeReq(url), res, url, {
      readAuth: () => auth, writeAuth: vi.fn(), fetchImpl,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body()).events).toEqual([]);
  });

  it('preserves the push mapping and selection on logout', async () => {
    const pushed = { a: { calendarId: 'primary', eventId: 'g-1', key: 'k' } };
    const auth: GoogleAuthData = {
      ...connectedAuth(), selectedCalendarIds: ['x'], pushCalendarId: 'primary', pushed,
    };
    const writeAuth = vi.fn();
    const res = makeRes();
    await handleGoogleRequest(makeReq('/api/google/logout', 'POST'), res, '/api/google/logout', {
      readAuth: () => auth, writeAuth,
      fetchImpl: (vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }) as unknown as typeof fetch),
    });
    expect(res.statusCode).toBe(200);
    expect(writeAuth).toHaveBeenCalledWith(expect.objectContaining({
      tokens: null, selectedCalendarIds: ['x'], pushCalendarId: 'primary', pushed,
    }));
  });

  it('exposes push state on status', async () => {
    const auth: GoogleAuthData = {
      ...connectedAuth(), pushCalendarId: 'primary', lastPushAt: 123, lastPushError: 'boom',
    };
    const res = makeRes();
    await handleGoogleRequest(makeReq('/api/google/status'), res, '/api/google/status', {
      readAuth: () => auth, writeAuth: vi.fn(), fetchImpl: pushFetch().fetchImpl,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body())).toMatchObject({
      connected: true, pushCalendarId: 'primary', lastPushAt: 123, lastPushError: 'boom',
    });
  });
});

