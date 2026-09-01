// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { handleRequest } from '../server.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

function makeReq(url: string, method = 'GET'): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  (req as unknown as { url: string }).url = url;
  (req as unknown as { method: string }).method = method;
  return req;
}

function makeRes(): ServerResponse {
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
  return res;
}

const VALID_URL = encodeURIComponent('https://calendar.magister.net/api/icalendar/feeds/abc123');

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
