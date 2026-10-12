// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRequest } from '../server.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createTask,
  deleteTask,
  parseCreateTask,
  parseUpdateTask,
  toDeviceTask,
  updateTask,
} from '../deviceTasks.js';

// ---- HTTP harness (mirrors deviceCalendar.test.ts) ----
function makeReq(url: string, method = 'GET', headers: Record<string, string> = {}, body?: string): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  (req as unknown as { url: string }).url = url;
  (req as unknown as { method: string }).method = method;
  const lowered: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
  (req as unknown as { headers: Record<string, string> }).headers = lowered;
  if (body !== undefined) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(body));
      req.emit('end');
    });
  }
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

const TOKEN = 'secret-device-token';
const authHeader = { Authorization: `Bearer ${TOKEN}` };

function seedStorage(tasks: unknown[]): void {
  const file = join(mkdtempSync(join(tmpdir(), 'cal-device-tasks-')), 'data.json');
  writeFileSync(file, JSON.stringify({ events: [], tasks, feedUrl: null }));
  vi.stubEnv('STORAGE_PATH', file);
}

describe('deviceTasks pure logic', () => {
  const base = { events: [], tasks: [], feedUrl: null };

  it('parseCreateTask requires a title', () => {
    expect(parseCreateTask({}).ok).toBe(false);
    expect(parseCreateTask({ title: '  ' }).ok).toBe(false);
    expect(parseCreateTask({ title: 'ok' }).ok).toBe(true);
  });

  it('parseCreateTask rejects bad enum/dueDate', () => {
    expect(parseCreateTask({ title: 'x', priority: 'urgent' }).ok).toBe(false);
    expect(parseCreateTask({ title: 'x', color: 'puce' }).ok).toBe(false);
    expect(parseCreateTask({ title: 'x', dueDate: 'not-a-date' }).ok).toBe(false);
    expect(parseCreateTask({ title: 'x', dueDate: '2026-09-23T17:00:00Z' }).ok).toBe(true);
  });

  it('createTask is idempotent for a supplied id', () => {
    const first = createTask(base, { id: 't1', title: 'A' }, new Date('2026-01-01T00:00:00Z'));
    expect(first.duplicate).toBe(false);
    const second = createTask(first.data, { id: 't1', title: 'A' }, new Date('2026-01-02T00:00:00Z'));
    expect(second.duplicate).toBe(true);
    expect(second.data.tasks).toHaveLength(1);
  });

  it('updateTask patches fields, stamps updatedAt, and detects conflicts', () => {
    const created = createTask(base, { id: 't1', title: 'A' }, new Date('2026-01-01T00:00:00Z'));
    const seen = created.task.updatedAt;
    const completed = updateTask(created.data, 't1', { completed: true }, new Date('2026-01-02T00:00:00Z'));
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.task.completed).toBe(true);
    expect(completed.task.updatedAt).not.toBe(seen);

    const conflict = updateTask(completed.data, 't1', { title: 'B' }, new Date(), seen);
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.status).toBe(409);

    const fresh = updateTask(completed.data, 't1', { title: 'B' }, new Date(), completed.task.updatedAt);
    expect(fresh.ok).toBe(true);
  });

  it('updateTask clears a field with null', () => {
    const created = createTask(base, { id: 't1', title: 'A', dueDate: '2026-09-23T17:00:00Z' });
    const cleared = updateTask(created.data, 't1', { dueDate: null });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.task.dueDate).toBeUndefined();
  });

  it('updateTask returns 404 for a missing task', () => {
    const res = updateTask(base, 'nope', { title: 'x' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(404);
  });

  it('deleteTask is idempotent', () => {
    const created = createTask(base, { id: 't1', title: 'A' });
    const deleted = deleteTask(created.data, 't1');
    expect(deleted.deleted).toBe(true);
    expect(deleted.data.tasks).toHaveLength(0);
    const again = deleteTask(deleted.data, 't1');
    expect(again.deleted).toBe(false);
  });

  it('toDeviceTask normalises legacy tasks (defaults + missing updatedAt)', () => {
    const t = toDeviceTask({ id: 'x', title: 'X' });
    expect(t?.priority).toBe('medium');
    expect(t?.color).toBe('blue');
    expect(t?.completed).toBe(false);
    expect(t?.updatedAt).toBe(new Date(0).toISOString());
    expect(toDeviceTask(null)).toBeNull();
  });

  it('parseUpdateTask rejects wrong types', () => {
    expect(parseUpdateTask({ completed: 'yes' }).ok).toBe(false);
    expect(parseUpdateTask({ priority: 'urgent' }).ok).toBe(false);
    expect(parseUpdateTask({ title: 'new' }).ok).toBe(true);
  });
});

describe('HTTP: /api/v1/tasks', () => {
  beforeEach(() => {
    vi.stubEnv('DEVICE_TOKEN', '');
    seedStorage([]);
  });

  it('404s when DEVICE_TOKEN is unset', async () => {
    const res = makeRes();
    await handleRequest(makeReq('/api/v1/tasks'), res);
    expect(res.statusCode).toBe(404);
  });

  describe('with DEVICE_TOKEN', () => {
    beforeEach(() => {
      vi.stubEnv('DEVICE_TOKEN', TOKEN);
      seedStorage([]);
    });

    it('rejects unauthenticated requests', async () => {
      const res = makeRes();
      await handleRequest(makeReq('/api/v1/tasks'), res);
      expect(res.statusCode).toBe(401);
    });

    it('creates, lists, updates, and deletes a task', async () => {
      const created = makeRes();
      await handleRequest(
        makeReq('/api/v1/tasks', 'POST', authHeader, JSON.stringify({ id: 't1', title: 'Buy milk', category: 'Groceries' })),
        created,
      );
      expect(created.statusCode).toBe(201);
      const createdTask = JSON.parse(created.body()).task;
      expect(createdTask.id).toBe('t1');
      expect(createdTask.category).toBe('Groceries');

      const list = makeRes();
      await handleRequest(makeReq('/api/v1/tasks', 'GET', authHeader), list);
      expect(list.statusCode).toBe(200);
      expect(JSON.parse(list.body()).tasks).toHaveLength(1);

      const patched = makeRes();
      await handleRequest(
        makeReq(`/api/v1/tasks?id=t1&baseUpdatedAt=${encodeURIComponent(createdTask.updatedAt)}`, 'PATCH', authHeader, JSON.stringify({ completed: true })),
        patched,
      );
      expect(patched.statusCode).toBe(200);
      expect(JSON.parse(patched.body()).task.completed).toBe(true);

      const del = makeRes();
      await handleRequest(makeReq('/api/v1/tasks?id=t1', 'DELETE', authHeader), del);
      expect(del.statusCode).toBe(200);
      expect(JSON.parse(del.body()).deleted).toBe(true);
    });

    it('POST is idempotent (repost returns 200 duplicate, no second task)', async () => {
      const body = JSON.stringify({ id: 't1', title: 'A' });
      const first = makeRes();
      await handleRequest(makeReq('/api/v1/tasks', 'POST', authHeader, body), first);
      expect(first.statusCode).toBe(201);
      const second = makeRes();
      await handleRequest(makeReq('/api/v1/tasks', 'POST', authHeader, body), second);
      expect(second.statusCode).toBe(200);
      expect(JSON.parse(second.body()).duplicate).toBe(true);

      const list = makeRes();
      await handleRequest(makeReq('/api/v1/tasks', 'GET', authHeader), list);
      expect(JSON.parse(list.body()).tasks).toHaveLength(1);
    });

    it('PATCH without baseUpdatedAt ignores conflicts', async () => {
      await handleRequest(makeReq('/api/v1/tasks', 'POST', authHeader, JSON.stringify({ id: 't1', title: 'A' })), makeRes());
      const patched = makeRes();
      await handleRequest(makeReq('/api/v1/tasks?id=t1', 'PATCH', authHeader, JSON.stringify({ title: 'Renamed' })), patched);
      expect(patched.statusCode).toBe(200);
      expect(JSON.parse(patched.body()).task.title).toBe('Renamed');
    });

    it('PATCH with a stale baseUpdatedAt returns 409', async () => {
      await handleRequest(makeReq('/api/v1/tasks', 'POST', authHeader, JSON.stringify({ id: 't1', title: 'A' })), makeRes());
      const patched = makeRes();
      await handleRequest(
        makeReq(`/api/v1/tasks?id=t1&baseUpdatedAt=${encodeURIComponent(new Date(0).toISOString())}`, 'PATCH', authHeader, JSON.stringify({ title: 'X' })),
        patched,
      );
      expect(patched.statusCode).toBe(409);
    });

    it('returns 404 for PATCH of a missing task and 400 without id', async () => {
      const missing = makeRes();
      await handleRequest(makeReq('/api/v1/tasks?id=nope', 'PATCH', authHeader, JSON.stringify({ title: 'X' })), missing);
      expect(missing.statusCode).toBe(404);

      const delMissing = makeRes();
      await handleRequest(makeReq('/api/v1/tasks?id=nope', 'DELETE', authHeader), delMissing);
      expect(delMissing.statusCode).toBe(200);
      expect(JSON.parse(delMissing.body()).deleted).toBe(false);

      const noId = makeRes();
      await handleRequest(makeReq('/api/v1/tasks', 'PATCH', authHeader, JSON.stringify({ title: 'X' })), noId);
      expect(noId.statusCode).toBe(400);
    });

    it('rejects invalid create bodies with 400', async () => {
      const res = makeRes();
      await handleRequest(makeReq('/api/v1/tasks', 'POST', authHeader, JSON.stringify({ title: '' })), res);
      expect(res.statusCode).toBe(400);
    });
  });
});
