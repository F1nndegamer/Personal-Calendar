// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleGoogleRequest, isGooglePath } from '../googleRoutes.js';
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

describe('isGooglePath', () => {
  it('recognises exactly the Google endpoints', () => {
    for (const p of [
      '/api/google/status',
      '/api/google/login',
      '/api/google/callback?code=x&state=y',
      '/api/google/logout',
      '/api/google/selection',
      '/api/google/events?timeMin=a&timeMax=b',
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
});
