/**
 * Production iCalendar proxy + data storage server.
 *
 * Routes:
 *   GET  /api/session            → { required, unlocked } (password lock state)
 *   POST /api/unlock             → password → session cookie
 *   POST /api/lock               → clears the session cookie
 *   GET  /ics?url=…              → proxies to Magister
 *   GET  /api/storage            → returns { events, tasks, feedUrl }
 *   PUT  /api/storage            → saves { events, tasks, feedUrl }
 *   POST /api/webhook/task       → appends a task (Bearer token; disabled
 *                                  unless WEBHOOK_TOKEN is set)
 *   GET  /api/v1/calendar?days=N → read-only device feed for the ESP32 wall
 *                                  calendar (Bearer DEVICE_TOKEN when set)
 *   GET  /api/google/status      → Google connection + calendars + selection
 *   GET  /api/google/login       → 302 redirect to Google OAuth consent
 *   GET  /api/google/callback    → token exchange, redirect back to "/"
 *   POST /api/google/logout      → revoke + clear tokens
 *   POST /api/google/selection   → saves { calendarIds }
 *   GET  /api/google/events      → events for the selected calendars
 *   POST /api/google/events      → create an event on Google Calendar
 *   POST /api/google/push        → mirror the local event set (diffed)
 *   POST /api/google/push-target → choose the push target calendar
 *
 * Everything the browser reaches (everything above except the Bearer-token
 * routes) requires an unlocked session once APP_PASSWORD is set — see
 * access.ts.
 *
 * STORAGE_PATH env var controls where data is saved.
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { validateProxyUrl } from './proxyCore.js';
import { readStorage, writeStorage, type StoredData } from './storage.js';
import {
  accessEnabled,
  clearCookieHeader,
  clearFailures,
  clientIp,
  isThrottled,
  issueSession,
  readUnlockCookie,
  recordFailure,
  requiresUnlock,
  sessionValid,
  unlockCookieHeader,
  verifyPassword,
  SESSION_TTL_MS,
} from './access.js';
import { handleDeviceCalendarRequest, isDeviceCalendarPath } from './deviceCalendar.js';
import { handleGoogleRequest, isGooglePath } from './googleRoutes.js';
import {
  appendWebhookTask,
  parseWebhookTask,
  tokenMatches,
} from './webhook.js';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;

function handleStorageRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const path = req.url?.split('?')[0] ?? '';

  if (req.method === 'GET' && path === '/api/storage') {
    try {
      const data = readStorage();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(err instanceof Error ? err.message : 'Read failed');
    }
    return;
  }

  if (req.method === 'PUT' && path === '/api/storage') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body) as Partial<StoredData>;
        const current = readStorage();
        const next: StoredData = {
          events: Array.isArray(parsed.events) ? parsed.events : current.events,
          tasks: Array.isArray(parsed.tasks) ? parsed.tasks : current.tasks,
          feedUrl: typeof parsed.feedUrl === 'string' ? parsed.feedUrl : current.feedUrl,
        };
        writeStorage(next);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(err instanceof Error ? err.message : 'Write failed');
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

export async function handleIcsRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = req.url ?? '/';
  const pathAndQuery = url.split('?')[0];
  if (pathAndQuery !== '/ics') return;

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain', Allow: 'GET' });
    res.end('Method Not Allowed');
    return;
  }

  const qs = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?')) : '');
  const rawUrl = qs.get('url') ?? '';
  const validation = validateProxyUrl(rawUrl);
  if (!validation.ok) {
    res.writeHead(validation.status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(validation.message);
    return;
  }

  let upstreamResponse: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    upstreamResponse = await fetch(validation.httpsUrl, {
      headers: { Accept: 'text/calendar' },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const msg =
      err instanceof Error && err.name === 'AbortError'
        ? 'Upstream request timed out after 30s'
        : err instanceof Error ? err.message : 'Upstream request failed';
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Upstream network error: ${msg}`);
    return;
  } finally {
    clearTimeout(timeout);
  }

  if (!upstreamResponse.ok) {
    const body = await upstreamResponse.text().catch(() => '');
    res.writeHead(upstreamResponse.status, {
      'Content-Type':
        upstreamResponse.headers.get('content-type') || 'text/plain; charset=utf-8',
    });
    res.end(body);
    return;
  }

  const contentType =
    upstreamResponse.headers.get('content-type') || 'text/calendar; charset=utf-8';
  const body = await upstreamResponse.text();
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

/**
 * POST /api/webhook/task — remote task creation.
 * Auth: `Authorization: Bearer <token>` or `?token=`; enabled only when the
 * WEBHOOK_TOKEN env var is configured.
 */
export async function handleWebhookTaskRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
): Promise<void> {
  const expected = process.env.WEBHOOK_TOKEN;
  if (!expected) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  const qs = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?')) : '');
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? null;
  if (!tokenMatches(bearer ?? qs.get('token'), expected)) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
    return;
  }

  let body = '';
  let overflow = false;
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString();
    if (body.length > 64 * 1024) {
      overflow = true;
      req.destroy();
    }
  });
  req.on('end', () => {
    if (overflow) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Body must be valid JSON' }));
      return;
    }
    const check = parseWebhookTask(parsed);
    if (!check.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: check.message }));
      return;
    }
    try {
      const result = appendWebhookTask(readStorage(), check.input);
      writeStorage(result.data);
      res.writeHead(result.duplicate ? 200 : 201, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify({ ok: true, id: result.id, duplicate: result.duplicate }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : 'Write failed',
      }));
    }
  });
}

/** Whether the request reached us over TLS (directly or via Nginx). */
function isSecureRequest(req: http.IncomingMessage): boolean {
  const proto = req.headers['x-forwarded-proto'];
  const value = (Array.isArray(proto) ? proto[0] : proto)?.split(',')[0]?.trim().toLowerCase();
  if (value) return value === 'https';
  return (req.socket as { encrypted?: boolean } | undefined)?.encrypted === true;
}

/** Read + parse a small JSON body. Rejects with `{status, message}`. */
function readJsonBody(
  req: http.IncomingMessage,
  limit = 4 * 1024,
): Promise<{ ok: true; value: unknown } | { ok: false; status: number; message: string }> {
  return new Promise((resolve) => {
    let body = '';
    let overflow = false;
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > limit) {
        overflow = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (overflow) {
        resolve({ ok: false, status: 413, message: 'Body too large' });
        return;
      }
      try {
        resolve({ ok: true, value: JSON.parse(body) });
      } catch {
        resolve({ ok: false, status: 400, message: 'Body must be valid JSON' });
      }
    });
  });
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
  cookie?: string,
): void {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}

/**
 * The password lock's own endpoints: check the state, exchange a password for
 * a session cookie, and forget the cookie again. Always reachable — the app
 * cannot know whether it is locked without them.
 */
async function handleAccessRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string,
): Promise<void> {
  const secure = isSecureRequest(req);
  const required = accessEnabled();
  const unlocked = !required || sessionValid(readUnlockCookie(req.headers.cookie));

  if (path === '/api/session' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, required, unlocked });
    return;
  }

  if (path === '/api/unlock') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
      return;
    }
    // Nothing to unlock while the lock is off — answer like a success so a
    // stale lock screen never gets stuck.
    if (!required) {
      sendJson(res, 200, { ok: true, required: false });
      return;
    }
    const ip = clientIp(req);
    if (isThrottled(ip)) {
      sendJson(res, 429, { ok: false, error: 'Too many attempts' });
      return;
    }
    const body = await readJsonBody(req);
    if (!body.ok) {
      sendJson(res, body.status, { ok: false, error: body.message });
      return;
    }
    const password =
      typeof body.value === 'object' && body.value !== null
        ? (body.value as Record<string, unknown>).password
        : undefined;
    if (!verifyPassword(password)) {
      recordFailure(ip);
      sendJson(res, 401, { ok: false, error: 'Incorrect password' });
      return;
    }
    clearFailures(ip);
    sendJson(
      res,
      200,
      { ok: true, expiresInDays: Math.round(SESSION_TTL_MS / 86_400_000) },
      unlockCookieHeader(issueSession(), secure),
    );
    return;
  }

  if (path === '/api/lock') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
      return;
    }
    sendJson(res, 200, { ok: true }, clearCookieHeader(secure));
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not Found' });
}

export async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = req.url ?? '';
  const path = url.split('?')[0];

  if (path === '/api/session' || path === '/api/unlock' || path === '/api/lock') {
    await handleAccessRequest(req, res, path);
    return;
  }

  // Password lock: the browser routes all need a live session cookie. The
  // Bearer-token routes and the Google callback are exempt (see access.ts).
  if (accessEnabled() && requiresUnlock(path) && !sessionValid(readUnlockCookie(req.headers.cookie))) {
    sendJson(res, 401, { ok: false, error: 'locked' });
    return;
  }

  if (path === '/api/storage') {
    handleStorageRequest(req, res);
    return;
  }

  if (path === '/api/webhook/task') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'POST' });
      res.end('Method Not Allowed');
      return;
    }
    await handleWebhookTaskRequest(req, res, url);
    return;
  }

  if (path === '/api/v1/calendar' || isDeviceCalendarPath(url)) {
    handleDeviceCalendarRequest(req, res, url);
    return;
  }

  if (isGooglePath(url)) {
    await handleGoogleRequest(req, res, url);
    return;
  }

  if (path === '/ics' || path.startsWith('/ics?')) {
    await handleIcsRequest(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

function startListener(): void {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      const msg = err instanceof Error ? err.message : 'Internal server error';
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end(`Internal server error: ${msg}`);
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`Calendar server listening on http://${HOST}:${PORT}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startListener();
}
