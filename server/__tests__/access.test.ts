// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRequest } from '../server.js';
import {
  accessEnabled,
  clearCookieHeader,
  clearSessions,
  clientIp,
  isThrottled,
  issueSession,
  readUnlockCookie,
  recordFailure,
  requiresUnlock,
  resetThrottle,
  sessionValid,
  unlockCookieHeader,
  verifyPassword,
} from '../access.js';

/**
 * The password lock: the pure logic in access.ts, plus the three routes the
 * app depends on (`/api/session`, `/api/unlock`, `/api/lock`) and the gate in
 * front of the browser routes.
 *
 * Every test runs against a temp STORAGE_PATH, so session files never touch
 * the real data directory.
 */

let storageDir = '';

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), 'pc-access-'));
  process.env.STORAGE_PATH = join(storageDir, 'data.json');
  process.env.APP_PASSWORD = 'correct horse';
  resetThrottle();
});

afterEach(() => {
  delete process.env.APP_PASSWORD;
  delete process.env.STORAGE_PATH;
  resetThrottle();
  rmSync(storageDir, { recursive: true, force: true });
});

function makeReq(
  url: string,
  method = 'GET',
  headers: Record<string, string> = {},
): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  (req as unknown as { url: string }).url = url;
  (req as unknown as { method: string }).method = method;
  const lowered: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
  (req as unknown as { headers: Record<string, string> }).headers = lowered;
  (req as unknown as { socket: object }).socket = { remoteAddress: '10.0.0.9' };
  (req as unknown as { destroy(): void }).destroy = () => undefined;
  return req as IncomingMessage;
}

function emitBody(req: IncomingMessage, body: string): Promise<void> {
  return new Promise((done) => {
    setImmediate(() => {
      (req as unknown as EventEmitter).emit('data', Buffer.from(body));
      (req as unknown as EventEmitter).emit('end');
      setImmediate(done);
    });
  });
}

function makeRes(): ServerResponse & {
  statusCode: number;
  headers: Record<string, string>;
  chunks: Buffer[];
  body(): string;
} {
  const res = Object.assign(new EventEmitter(), {
    statusCode: 0,
    headers: {} as Record<string, string>,
    chunks: [] as Buffer[],
    writeHead(status: number, headers?: Record<string, string | number>): ServerResponse {
      res.statusCode = status;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) res.headers[k.toLowerCase()] = String(v);
      }
      return res;
    },
    write(chunk: string | Buffer): boolean {
      res.chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk?: string | Buffer): ServerResponse {
      if (chunk !== undefined) res.chunks.push(Buffer.from(chunk));
      return res;
    },
  }) as unknown as ServerResponse & {
    statusCode: number;
    headers: Record<string, string>;
    chunks: Buffer[];
  };
  const out = res as ServerResponse & { body(): string };
  out.body = () => Buffer.concat(out.chunks).toString('utf-8');
  return out;
}

/** Run one request through the real router. */
async function call(
  url: string,
  method = 'GET',
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const req = makeReq(url, method, headers);
  const res = makeRes();
  const done =
    body === undefined ? Promise.resolve() : emitBody(req, body);
  await handleRequest(req, res);
  await done;
  return { status: res.statusCode, body: res.body(), headers: res.headers };
}

describe('accessEnabled', () => {
  it('is off without a password and on with one', () => {
    delete process.env.APP_PASSWORD;
    expect(accessEnabled()).toBe(false);
    process.env.APP_PASSWORD = 'x';
    expect(accessEnabled()).toBe(true);
    process.env.APP_PASSWORD = '';
    expect(accessEnabled()).toBe(false);
  });
});

describe('verifyPassword', () => {
  it('accepts only the exact password', () => {
    expect(verifyPassword('correct horse')).toBe(true);
    expect(verifyPassword('correct hors')).toBe(false);
    expect(verifyPassword('correct horse ')).toBe(false);
    expect(verifyPassword('CORRECT HORSE')).toBe(false);
  });

  it('rejects non-strings and never matches while disabled', () => {
    expect(verifyPassword(undefined)).toBe(false);
    expect(verifyPassword(42)).toBe(false);
    expect(verifyPassword({ toString: () => 'correct horse' })).toBe(false);
    delete process.env.APP_PASSWORD;
    expect(verifyPassword('anything')).toBe(false);
  });
});

describe('sessions', () => {
  it('issues a token that validates, and stores only its hash', () => {
    const token = issueSession();
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(sessionValid(token)).toBe(true);
    const stored = JSON.parse(
      readFileSync(join(storageDir, 'access-sessions.json'), 'utf-8'),
    ) as { sessions: { hash: string }[]; fingerprint: string };
    expect(stored.sessions[0].hash).not.toBe(token);
    expect(stored.fingerprint).not.toBe('');
  });

  it('rejects unknown, empty and expired tokens', () => {
    const token = issueSession();
    expect(sessionValid('nope')).toBe(false);
    expect(sessionValid('')).toBe(false);
    expect(sessionValid(null)).toBe(false);
    expect(sessionValid(token, Date.now() + 181 * 24 * 3_600_000)).toBe(false);
  });

  it('keeps several browsers unlocked at once', () => {
    const a = issueSession();
    const b = issueSession();
    expect(sessionValid(a)).toBe(true);
    expect(sessionValid(b)).toBe(true);
  });

  it('logs everyone out when the password changes', () => {
    const token = issueSession();
    process.env.APP_PASSWORD = 'a different one';
    expect(sessionValid(token)).toBe(false);
  });

  it('clearSessions revokes every token', () => {
    const token = issueSession();
    clearSessions();
    expect(sessionValid(token)).toBe(false);
  });
});

describe('cookies', () => {
  it('reads the token out of a mixed Cookie header', () => {
    expect(readUnlockCookie('a=1; pc_unlock=abc123; b=2')).toBe('abc123');
    expect(readUnlockCookie('pc_unlock=only')).toBe('only');
    expect(readUnlockCookie('pc_unlock=')).toBeNull();
    expect(readUnlockCookie('other=abc')).toBeNull();
    expect(readUnlockCookie(undefined)).toBeNull();
    expect(readUnlockCookie('')).toBeNull();
  });

  it('sets an HttpOnly, SameSite, long-lived cookie — Secure only over TLS', () => {
    const secure = unlockCookieHeader('tok', true);
    expect(secure).toContain('pc_unlock=tok');
    expect(secure).toContain('HttpOnly');
    expect(secure).toContain('SameSite=Strict');
    expect(secure).toContain('Path=/');
    expect(secure).toContain('Max-Age=15552000');
    expect(secure).toContain('Secure');
    expect(unlockCookieHeader('tok', false)).not.toContain('Secure');
  });

  it('clears the cookie with Max-Age=0', () => {
    expect(clearCookieHeader(true)).toContain('Max-Age=0');
  });
});

describe('requiresUnlock', () => {
  it('gates the browser routes', () => {
    expect(requiresUnlock('/api/storage')).toBe(true);
    expect(requiresUnlock('/api/google/push')).toBe(true);
    expect(requiresUnlock('/ics')).toBe(true);
    expect(requiresUnlock('/nope')).toBe(true);
  });

  it('leaves the lock endpoints, the OAuth callback and token routes open', () => {
    expect(requiresUnlock('/api/session')).toBe(false);
    expect(requiresUnlock('/api/unlock')).toBe(false);
    expect(requiresUnlock('/api/lock')).toBe(false);
    expect(requiresUnlock('/api/google/callback')).toBe(false);
    expect(requiresUnlock('/api/webhook/task')).toBe(false);
    expect(requiresUnlock('/api/v1/calendar')).toBe(false);
  });
});

describe('throttling', () => {
  it('blocks an IP after too many wrong attempts, and lets a good one through', () => {
    for (let i = 0; i < 7; i += 1) recordFailure('1.2.3.4');
    expect(isThrottled('1.2.3.4')).toBe(false);
    recordFailure('1.2.3.4');
    expect(isThrottled('1.2.3.4')).toBe(true);
    expect(isThrottled('1.2.3.5')).toBe(false);
    // …and the block expires on its own.
    expect(isThrottled('1.2.3.4', Date.now() + 6 * 60_000)).toBe(false);
  });

  it('counts the failures inside a moving window', () => {
    const t0 = 1_000_000;
    recordFailure('2.2.2.2', t0);
    recordFailure('2.2.2.2', t0 + 60_000);
    // A gap longer than the window starts a fresh count.
    recordFailure('2.2.2.2', t0 + 20 * 60_000);
    expect(isThrottled('2.2.2.2', t0 + 20 * 60_000)).toBe(false);
  });

  it('reads the client IP from the proxy headers', () => {
    expect(clientIp(makeReq('/api/unlock', 'POST', { 'x-real-ip': '5.5.5.5' }))).toBe('5.5.5.5');
    expect(
      clientIp(makeReq('/api/unlock', 'POST', { 'x-forwarded-for': '6.6.6.6, 10.0.0.1' })),
    ).toBe('6.6.6.6');
    expect(clientIp(makeReq('/api/unlock', 'POST'))).toBe('10.0.0.9');
  });
});


describe('GET /api/session', () => {
  it('reports a locked-out browser', async () => {
    const r = await call('/api/session');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ ok: true, required: true, unlocked: false });
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('reports an unlocked browser', async () => {
    const token = issueSession();
    const r = await call('/api/session', 'GET', { cookie: `pc_unlock=${token}` });
    expect(JSON.parse(r.body)).toMatchObject({ required: true, unlocked: true });
  });

  it('reports "not required" when no password is configured', async () => {
    delete process.env.APP_PASSWORD;
    const r = await call('/api/session');
    expect(JSON.parse(r.body)).toMatchObject({ required: false, unlocked: true });
  });
});

describe('POST /api/unlock', () => {
  it('sets a session cookie for the right password', async () => {
    const r = await call(
      '/api/unlock',
      'POST',
      { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
      JSON.stringify({ password: 'correct horse' }),
    );
    expect(r.status).toBe(200);
    const cookie = r.headers['set-cookie'];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    const token = readUnlockCookie(cookie);
    expect(token).not.toBeNull();
    expect(sessionValid(token)).toBe(true);
  });

  it('refuses a wrong password without setting a cookie', async () => {
    const r = await call(
      '/api/unlock',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ password: 'wrong' }),
    );
    expect(r.status).toBe(401);
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(JSON.parse(r.body)).toMatchObject({ ok: false });
  });

  it('rejects a malformed body', async () => {
    const r = await call('/api/unlock', 'POST', {}, 'not json');
    expect(r.status).toBe(400);
  });

  it('answers with 429 once an IP burned through its attempts', async () => {
    for (let i = 0; i < 8; i += 1) {
      await call('/api/unlock', 'POST', {}, JSON.stringify({ password: 'wrong' }));
    }
    const r = await call('/api/unlock', 'POST', {}, JSON.stringify({ password: 'correct horse' }));
    expect(r.status).toBe(429);
  });

  it('is a no-op success while no password is configured', async () => {
    delete process.env.APP_PASSWORD;
    const r = await call('/api/unlock', 'POST', {}, JSON.stringify({ password: '' }));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ ok: true, required: false });
  });

  it('only accepts POST', async () => {
    expect((await call('/api/unlock')).status).toBe(405);
  });
});

describe('POST /api/lock', () => {
  it('clears the cookie', async () => {
    const r = await call('/api/lock', 'POST');
    expect(r.status).toBe(200);
    expect(r.headers['set-cookie']).toContain('Max-Age=0');
  });
});

describe('the gate on browser routes', () => {
  it('answers 401 for storage without a session', async () => {
    const r = await call('/api/storage');
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body)).toMatchObject({ ok: false, error: 'locked' });
  });

  it('lets a valid cookie through', async () => {
    const token = issueSession();
    const r = await call('/api/storage', 'GET', { cookie: `pc_unlock=${token}` });
    expect(r.status).toBe(200);
  });

  it('rejects a stale session (password changed) and a garbage cookie', async () => {
    const token = issueSession();
    process.env.APP_PASSWORD = 'rotated';
    expect((await call('/api/storage', 'GET', { cookie: `pc_unlock=${token}` })).status).toBe(401);
    expect((await call('/api/storage', 'GET', { cookie: 'pc_unlock=nope' })).status).toBe(401);
  });

  it('gates /ics too — the feed is personal data', async () => {
    const r = await call('/ics?url=' + encodeURIComponent('https://example.com/a.ics'));
    expect(r.status).toBe(401);
  });

  it('leaves the Google OAuth callback reachable (it carries no cookie)', async () => {
    // No code/state → the route answers with its own error, never with 401.
    const r = await call('/api/google/callback');
    expect(r.status).not.toBe(401);
  });

  it('leaves the Bearer-token routes to their own authentication', async () => {
    // The task webhook is disabled without WEBHOOK_TOKEN (404 by design) and
    // the device feed skips auth when DEVICE_TOKEN is unset (200) — neither
    // may be turned into a password prompt.
    const webhook = await call('/api/webhook/task', 'POST', {}, JSON.stringify({ title: 'x' }));
    expect(webhook.status).toBe(404);
    expect(webhook.body).not.toContain('locked');
    const device = await call('/api/v1/calendar?days=1');
    expect(device.status).toBe(200);
    expect(device.body).not.toContain('locked');
  });

  it('changes nothing while no password is configured', async () => {
    delete process.env.APP_PASSWORD;
    expect((await call('/api/storage')).status).toBe(200);
  });
});

