// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRequest } from '../server.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

function makeReq(url: string, method = 'GET', headers: Record<string, string> = {}): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  (req as unknown as { url: string }).url = url;
  (req as unknown as { method: string }).method = method;
  const lowered: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
  (req as unknown as { headers: Record<string, string> }).headers = lowered;
  return req as IncomingMessage;
}

function makeRes(): ServerResponse & { statusCode: number; body(): string } {
  const chunks: Buffer[] = [];
  const res = {
    statusCode: 0,
    writeHead(status: number): ServerResponse {
      res.statusCode = status;
      return res as unknown as ServerResponse;
    },
    end(chunk?: string | Buffer): ServerResponse {
      if (chunk !== undefined) chunks.push(Buffer.from(chunk));
      return res as unknown as ServerResponse;
    },
  } as unknown as ServerResponse & { statusCode: number; body(): string };
  (res as { body(): string }).body = () => Buffer.concat(chunks).toString('utf-8');
  return res;
}

function seedStorage(events: unknown[], tasks: unknown[]): void {
  const file = join(mkdtempSync(join(tmpdir(), 'cal-device-')), 'data.json');
  writeFileSync(file, JSON.stringify({ events, tasks, feedUrl: null }));
  vi.stubEnv('STORAGE_PATH', file);
}

// Fixture dates are relative to *today* (Amsterdam) so the 31-day feed range
// — which starts at local midnight today — always includes e1/e2 and never
// the long-past "old" event, regardless of when the suite runs.
function amsterdamDayOffset(offsetDays: number): string {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}

const EVENTS = [
  { id: 'e1', title: 'Math', start: `${amsterdamDayOffset(0)}T08:30:00+02:00`, end: `${amsterdamDayOffset(0)}T09:20:00+02:00`, color: 'blue', category: 'School', source: 'external', externalId: 'magister:1' },
  { id: 'e2', title: 'Holiday', start: `${amsterdamDayOffset(1)}T00:00:00+02:00`, end: `${amsterdamDayOffset(2)}T00:00:00+02:00`, color: 'green' },
  { id: 'old', title: 'Old', start: `${amsterdamDayOffset(-400)}T10:00:00+01:00`, end: `${amsterdamDayOffset(-400)}T11:00:00+01:00`, color: 'blue' },
];

describe('GET /api/v1/calendar', () => {
  beforeEach(() => {
    vi.stubEnv('DEVICE_TOKEN', '');
    seedStorage(EVENTS, []);
  });

  it('returns the device feed with default 31-day range', async () => {
    const res = makeRes();
    await handleRequest(makeReq('/api/v1/calendar'), res);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body());
    expect(body.version).toBe(1);
    expect(body.timezone).toBe('Europe/Amsterdam');
    // Range starts at local midnight Amsterdam: 22:00Z (CEST) or 23:00Z (CET).
    expect(new Date(body.range.start).getTime()).toBeLessThanOrEqual(Date.now());
    const ms = new Date(body.range.end).getTime() - new Date(body.range.start).getTime();
    expect(ms).toBe(31 * 24 * 60 * 60 * 1000);
    const ids = (body.events as { id: string }[]).map((e) => e.id);
    expect(ids).toContain('e1');
    expect(ids).toContain('e2');
    expect(ids).not.toContain('old');
  });

  it('honors ?days=7', async () => {
    const res = makeRes();
    await handleRequest(makeReq('/api/v1/calendar?days=7'), res);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body());
    const ms = new Date(body.range.end).getTime() - new Date(body.range.start).getTime();
    expect(ms).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('returns 400 for an invalid days parameter', async () => {
    const res = makeRes();
    await handleRequest(makeReq('/api/v1/calendar?days=banana'), res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for days=0 and days=999', async () => {
    for (const days of ['0', '999']) {
      const res = makeRes();
      await handleRequest(makeReq(`/api/v1/calendar?days=${days}`), res);
      expect(res.statusCode).toBe(400);
    }
  });

  it('returns 405 for POST', async () => {
    const res = makeRes();
    await handleRequest(makeReq('/api/v1/calendar', 'POST'), res);
    expect(res.statusCode).toBe(405);
  });

  it('returns 200 with an empty calendar', async () => {
    seedStorage([], []);
    const res = makeRes();
    await handleRequest(makeReq('/api/v1/calendar'), res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body()).events).toEqual([]);
  });

  it('requires the device token when DEVICE_TOKEN is set', async () => {
    vi.stubEnv('DEVICE_TOKEN', 'secret-device-token');
    const anon = makeRes();
    await handleRequest(makeReq('/api/v1/calendar'), anon);
    expect(anon.statusCode).toBe(401);

    const authed = makeRes();
    await handleRequest(makeReq('/api/v1/calendar', 'GET', { Authorization: 'Bearer secret-device-token' }), authed);
    expect(authed.statusCode).toBe(200);

    const viaQuery = makeRes();
    await handleRequest(makeReq('/api/v1/calendar?token=secret-device-token'), viaQuery);
    expect(viaQuery.statusCode).toBe(200);
  });
});
