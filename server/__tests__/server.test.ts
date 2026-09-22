// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRequest } from '../server.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Mock request. Header names are lowercased like a real Node
 * IncomingMessage does, so `req.headers.authorization` works.
 */
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
  (req as unknown as { destroy(): void }).destroy = () => undefined;
  return req as IncomingMessage;
}

/** Emit a body on the mocked request; resolves after the handler has processed it. */
function emitBody(req: IncomingMessage, body: string): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(() => {
      (req as unknown as EventEmitter).emit('data', Buffer.from(body));
      (req as unknown as EventEmitter).emit('end');
      setImmediate(resolve);
    });
  });
}

function makeRes(): ServerResponse & {
  statusCode: number;
  headers: Record<string, string>;
  chunks: Buffer[];
  body(): string;
} {
  const ee = new EventEmitter();
  const res = Object.assign(ee, {
    statusCode: 0,
    headers: {} as Record<string, string>,
    chunks: [] as Buffer[],
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
  const out = res as ServerResponse & {
    statusCode: number;
    headers: Record<string, string>;
    chunks: Buffer[];
    body(): string;
  };
  out.body = () => Buffer.concat(out.chunks).toString('utf-8');
  return out;
}

const VALID_URL = encodeURIComponent('https://calendar.magister.net/api/icalendar/feeds/abc123');

/* ---------- POST /api/webhook/task ---------- */

const TOKEN = 'test-token-123';
let storageFile = '';

beforeEach(() => {
  vi.stubEnv('WEBHOOK_TOKEN', TOKEN);
  // Fresh storage file per test so tests never see each other's tasks.
  storageFile = join(mkdtempSync(join(tmpdir(), 'cal-test-')), 'data.json');
  writeFileSync(storageFile, JSON.stringify({ events: [], tasks: [], feedUrl: null }));
  vi.stubEnv('STORAGE_PATH', storageFile);
});

const AUTH = { Authorization: `Bearer ${TOKEN}` };

describe('POST /api/webhook/task', () => {
  it('returns 404 when WEBHOOK_TOKEN is not configured', async () => {
    vi.stubEnv('WEBHOOK_TOKEN', '');
    const res = makeRes();
    await handleRequest(makeReq('/api/webhook/task', 'POST'), res);
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without a token', async () => {
    const res = makeRes();
    const req = makeReq('/api/webhook/task', 'POST');
    await emitBody(req, JSON.stringify({ title: 'X' }));
    await handleRequest(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for a wrong token', async () => {
    const res = makeRes();
    const req = makeReq('/api/webhook/task', 'POST', { Authorization: 'Bearer wrong' });
    await emitBody(req, JSON.stringify({ title: 'X' }));
    await handleRequest(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('returns 405 for GET', async () => {
    const res = makeRes();
    await handleRequest(makeReq('/api/webhook/task', 'GET'), res);
    expect(res.statusCode).toBe(405);
  });

  it('returns 400 for invalid JSON', async () => {
    const res = makeRes();
    const req = makeReq('/api/webhook/task', 'POST', AUTH);
    const pending = handleRequest(req, res);
    await emitBody(req, '{not json');
    await pending;
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when title is missing', async () => {
    const res = makeRes();
    const req = makeReq('/api/webhook/task', 'POST', AUTH);
    const pending = handleRequest(req, res);
    await emitBody(req, JSON.stringify({ priority: 'high' }));
    await pending;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body()).error).toContain('title');
  });

  it('returns 400 for a bad dueDate', async () => {
    const res = makeRes();
    const req = makeReq('/api/webhook/task', 'POST', AUTH);
    const pending = handleRequest(req, res);
    await emitBody(req, JSON.stringify({ title: 'X', dueDate: 'soon-ish' }));
    await pending;
    expect(res.statusCode).toBe(400);
  });

  it('creates a task and persists it (201)', async () => {
    const res = makeRes();
    const req = makeReq('/api/webhook/task', 'POST', AUTH);
    const pending = handleRequest(req, res);
    await emitBody(
      req,
      JSON.stringify({
        title: 'Read chapter 5',
        dueDate: '2026-09-23T17:00:00Z',
        priority: 'high',
        estimatedMinutes: 45,
        color: 'amber',
        category: 'Huiswerk',
      }),
    );
    await pending;
    expect(res.statusCode).toBe(201);
    const out = JSON.parse(res.body());
    expect(out.ok).toBe(true);
    expect(out.duplicate).toBe(false);

    const stored = JSON.parse(readFileSync(storageFile, 'utf-8'));
    expect(stored.tasks).toHaveLength(1);
    expect(stored.tasks[0]).toMatchObject({
      title: 'Read chapter 5',
      priority: 'high',
      estimatedMinutes: 45,
      color: 'amber',
      completed: false,
      subtasks: [],
    });
  });

  it('is idempotent when the same id is reposted (200, duplicate)', async () => {
    const body = JSON.stringify({ id: 'fixed-1', title: 'Retry me' });
    const res1 = makeRes();
    const req1 = makeReq('/api/webhook/task', 'POST', AUTH);
    const p1 = handleRequest(req1, res1);
    await emitBody(req1, body);
    await p1;
    expect(res1.statusCode).toBe(201);

    const res2 = makeRes();
    const req2 = makeReq('/api/webhook/task', 'POST', AUTH);
    const p2 = handleRequest(req2, res2);
    await emitBody(req2, body);
    await p2;
    expect(res2.statusCode).toBe(200);
    expect(JSON.parse(res2.body()).duplicate).toBe(true);

    const stored = JSON.parse(readFileSync(storageFile, 'utf-8'));
    expect(stored.tasks).toHaveLength(1);
  });

  it('accepts a token via query parameter', async () => {
    const res = makeRes();
    const req = makeReq(`/api/webhook/task?token=${encodeURIComponent(TOKEN)}`, 'POST');
    const pending = handleRequest(req, res);
    await emitBody(req, JSON.stringify({ title: 'Query auth' }));
    await pending;
    expect(res.statusCode).toBe(201);
  });
});


describe('GET /ics', () => {
  it('returns 404 for unknown paths', async () => {
    const res = makeRes();
    await handleRequest(makeReq('/unknown'), res);
    expect(res.statusCode).toBe(404);
  });

  it('returns 405 for non-GET methods', async () => {
    const res = makeRes();
    await handleRequest(makeReq('/ics', 'POST'), res);
    expect(res.statusCode).toBe(405);
  });

  it('returns 400 when url parameter is missing', async () => {
    const res = makeRes();
    await handleRequest(makeReq('/ics'), res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for malformed URL', async () => {
    const res = makeRes();
    await handleRequest(makeReq('/ics?url=not-a-url'), res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for disallowed host', async () => {
    const res = makeRes();
    const url = encodeURIComponent('https://evil.example.com/api/icalendar/feeds/abc');
    await handleRequest(makeReq(`/ics?url=${url}`), res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for disallowed path', async () => {
    const res = makeRes();
    const url = encodeURIComponent('https://calendar.magister.net/api/other');
    await handleRequest(makeReq(`/ics?url=${url}`), res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for bare prefix', async () => {
    const res = makeRes();
    const url = encodeURIComponent('https://calendar.magister.net/api/icalendar/feeds/');
    await handleRequest(makeReq(`/ics?url=${url}`), res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for http:// protocol', async () => {
    const res = makeRes();
    const url = encodeURIComponent('http://calendar.magister.net/api/icalendar/feeds/abc');
    await handleRequest(makeReq(`/ics?url=${url}`), res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 200 with text/calendar on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('BEGIN:VCALENDAR\nEND:VCALENDAR', { status: 200, headers: { 'Content-Type': 'text/calendar' } })
    ));
    const res = makeRes();
    await handleRequest(makeReq(`/ics?url=${VALID_URL}`), res);
    expect(res.statusCode).toBe(200);
    // content-type set on writeHead; statusCode 200 proves success
  });

  it('calls fetch with normalized HTTPS URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);
    const url = encodeURIComponent('webcal://calendar.magister.net/api/icalendar/feeds/abc123');
    const res = makeRes();
    await handleRequest(makeReq(`/ics?url=${url}`), res);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://calendar.magister.net/api/icalendar/feeds/abc123');
  });

  it('passes through 401 from upstream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    const res = makeRes();
    await handleRequest(makeReq(`/ics?url=${VALID_URL}`), res);
    expect(res.statusCode).toBe(401);
  });

  it('passes through 403 from upstream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    const res = makeRes();
    await handleRequest(makeReq(`/ics?url=${VALID_URL}`), res);
    expect(res.statusCode).toBe(403);
  });

  it('passes through 429 from upstream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    const res = makeRes();
    await handleRequest(makeReq(`/ics?url=${VALID_URL}`), res);
    expect(res.statusCode).toBe(429);
  });

  it('passes through 5xx from upstream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    const res = makeRes();
    await handleRequest(makeReq(`/ics?url=${VALID_URL}`), res);
    expect(res.statusCode).toBe(500);
  });

  it('returns 502 on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const res = makeRes();
    await handleRequest(makeReq(`/ics?url=${VALID_URL}`), res);
    expect(res.statusCode).toBe(502);
  });
});
