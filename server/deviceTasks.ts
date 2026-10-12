/**
 * Device task CRUD (ESP32 Daily Hub) — pure logic, no sockets.
 *
 * These operations back the idempotent `/api/v1/tasks` endpoints. They reuse
 * the same task shape and validation rules as `webhook.ts` so the device and
 * the webhook produce identical stored tasks. The device supplies the `id`,
 * which makes creates/retries idempotent (reposting the same id is a no-op).
 * Mutations stamp an `updatedAt` ISO instant so the device can detect
 * server-side (web) changes and avoid blind last-write-wins.
 *
 * "Lists" on the device are the free-text `category` field — there is no
 * separate list entity in the data model, matching the web app.
 *
 * Lives under `server/` (not `src/`) so the server build can include it and
 * vitest can import the pure parts for tests.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readStorage, writeStorage, type StoredData } from './storage.js';
import { tokenMatches } from './webhook.js';

export type Priority = 'low' | 'medium' | 'high';
export type TaskColor = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'cyan';

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

/** Canonical stored task, mirroring the web app's `src/tasks/types.ts`. */
export interface DeviceTask {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  priority: Priority;
  category?: string;
  color: TaskColor;
  /** ISO date-time, optional. */
  dueDate?: string;
  estimatedMinutes?: number;
  subtasks: Subtask[];
  eventId?: string;
  /** ISO instant of the last device mutation — used for sync/conflict checks. */
  updatedAt: string;
}

const PRIORITIES = ['low', 'medium', 'high'] as const;
const COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'cyan'] as const;
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string };

/** Coerce an unknown stored value into a {@link DeviceTask}, or null. */
export function toDeviceTask(raw: unknown): DeviceTask | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || typeof raw.title !== 'string') return null;
  const priority = PRIORITIES.includes(raw.priority as Priority) ? (raw.priority as Priority) : 'medium';
  const color = COLORS.includes(raw.color as TaskColor) ? (raw.color as TaskColor) : 'blue';
  const subtasks: Subtask[] = Array.isArray(raw.subtasks)
    ? raw.subtasks.flatMap((s) => {
        if (!isRecord(s) || typeof s.id !== 'string' || typeof s.title !== 'string') return [];
        return [{ id: s.id, title: s.title, completed: s.completed === true }];
      })
    : [];
  const task: DeviceTask = {
    id: raw.id,
    title: raw.title,
    completed: raw.completed === true,
    priority,
    color,
    subtasks,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
  };
  if (typeof raw.description === 'string') task.description = raw.description;
  if (typeof raw.category === 'string' && raw.category.length > 0) task.category = raw.category;
  if (typeof raw.dueDate === 'string') task.dueDate = raw.dueDate;
  if (typeof raw.estimatedMinutes === 'number') task.estimatedMinutes = raw.estimatedMinutes;
  if (typeof raw.eventId === 'string') task.eventId = raw.eventId;
  return task;
}

/** All stored tasks, normalised. */
export function listTasks(data: StoredData): DeviceTask[] {
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  return tasks.flatMap((t) => {
    const dt = toDeviceTask(t);
    return dt ? [dt] : [];
  });
}

function parseSubtasks(raw: unknown): ParseResult<Subtask[]> {
  if (raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, status: 400, message: '"subtasks" must be an array' };
  const out: Subtask[] = [];
  for (const s of raw) {
    if (!isRecord(s) || typeof s.id !== 'string' || typeof s.title !== 'string') {
      return { ok: false, status: 400, message: 'each subtask needs string "id" and "title"' };
    }
    out.push({ id: s.id, title: s.title, completed: s.completed === true });
  }
  return { ok: true, value: out };
}

export interface CreateTaskInput {
  id?: string;
  title: string;
  description?: string;
  completed?: boolean;
  priority?: Priority;
  category?: string;
  color?: TaskColor;
  dueDate?: string;
  estimatedMinutes?: number;
  subtasks?: Subtask[];
  eventId?: string;
}

/** Validate a create body. `title` required; everything else optional. */
export function parseCreateTask(body: unknown): ParseResult<CreateTaskInput> {
  if (!isRecord(body)) return { ok: false, status: 400, message: 'Body must be a JSON object' };
  const title = str(body.title)?.trim();
  if (!title) return { ok: false, status: 400, message: '"title" is required' };
  if (title.length > 200) return { ok: false, status: 400, message: '"title" too long (max 200 chars)' };

  const dueDate = str(body.dueDate);
  if (dueDate !== undefined) {
    const valid = ISO_DATE.test(dueDate) && !Number.isNaN(new Date(dueDate).getTime());
    if (!valid) return { ok: false, status: 400, message: '"dueDate" must be an ISO date or date-time' };
  }

  const priority = str(body.priority);
  if (priority !== undefined && !PRIORITIES.includes(priority as Priority)) {
    return { ok: false, status: 400, message: '"priority" must be low, medium or high' };
  }

  const color = str(body.color);
  if (color !== undefined && !COLORS.includes(color as TaskColor)) {
    return { ok: false, status: 400, message: `"color" must be one of ${COLORS.join(', ')}` };
  }

  const estimatedMinutes = body.estimatedMinutes;
  if (
    estimatedMinutes !== undefined &&
    (typeof estimatedMinutes !== 'number' || !Number.isInteger(estimatedMinutes) || estimatedMinutes < 1 || estimatedMinutes > 1440)
  ) {
    return { ok: false, status: 400, message: '"estimatedMinutes" must be an integer between 1 and 1440' };
  }

  const subtasks = parseSubtasks(body.subtasks);
  if (!subtasks.ok) return subtasks;

  const input: CreateTaskInput = { title };
  if (str(body.id)) input.id = str(body.id);
  if (typeof body.description === 'string') input.description = body.description;
  if (body.completed === true) input.completed = true;
  if (priority) input.priority = priority as Priority;
  if (typeof body.category === 'string' && body.category.length > 0) input.category = body.category;
  if (color) input.color = color as TaskColor;
  if (dueDate) input.dueDate = dueDate;
  if (typeof estimatedMinutes === 'number') input.estimatedMinutes = estimatedMinutes;
  if (subtasks.value.length) input.subtasks = subtasks.value;
  if (str(body.eventId)) input.eventId = str(body.eventId);
  return { ok: true, value: input };
}

export interface CreateResult {
  data: StoredData;
  task: DeviceTask;
  /** True when a task with the supplied id already existed (nothing changed). */
  duplicate: boolean;
}

/** Append a task (idempotent when `input.id` is supplied and already exists). */
export function createTask(data: StoredData, input: CreateTaskInput, now: Date = new Date()): CreateResult {
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  if (input.id !== undefined && tasks.some((t) => isRecord(t) && t.id === input.id)) {
    const existing = toDeviceTask(tasks.find((t) => isRecord(t) && t.id === input.id));
    return { data, task: existing as DeviceTask, duplicate: true };
  }
  const id = input.id ?? `dev-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const stored: Record<string, unknown> = {
    id,
    title: input.title,
    description: input.description,
    completed: input.completed === true,
    priority: input.priority ?? 'medium',
    category: input.category,
    color: input.color ?? 'blue',
    dueDate: input.dueDate,
    estimatedMinutes: input.estimatedMinutes,
    subtasks: input.subtasks ?? [],
    eventId: input.eventId,
    updatedAt: now.toISOString(),
  };
  return {
    data: { ...data, tasks: [...tasks, stored] },
    task: toDeviceTask(stored) as DeviceTask,
    duplicate: false,
  };
}

/** Fields a device may PATCH. Undefined = leave unchanged; null = clear. */
export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  completed?: boolean;
  priority?: Priority;
  category?: string | null;
  color?: TaskColor;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
  subtasks?: Subtask[];
  eventId?: string | null;
}

/** Validate a PATCH body (all fields optional). */
export function parseUpdateTask(body: unknown): ParseResult<UpdateTaskInput> {
  if (!isRecord(body)) return { ok: false, status: 400, message: 'Body must be a JSON object' };
  const patch: UpdateTaskInput = {};

  if (body.title !== undefined) {
    const title = str(body.title)?.trim();
    if (!title) return { ok: false, status: 400, message: '"title" must be a non-empty string' };
    if (title.length > 200) return { ok: false, status: 400, message: '"title" too long (max 200 chars)' };
    patch.title = title;
  }
  if (body.completed !== undefined) {
    if (typeof body.completed !== 'boolean') return { ok: false, status: 400, message: '"completed" must be a boolean' };
    patch.completed = body.completed;
  }
  if (body.priority !== undefined) {
    if (!PRIORITIES.includes(body.priority as Priority)) return { ok: false, status: 400, message: '"priority" must be low, medium or high' };
    patch.priority = body.priority as Priority;
  }
  if (body.color !== undefined) {
    if (!COLORS.includes(body.color as TaskColor)) return { ok: false, status: 400, message: `"color" must be one of ${COLORS.join(', ')}` };
    patch.color = body.color as TaskColor;
  }
  if (body.dueDate !== undefined) {
    if (body.dueDate !== null) {
      const v = str(body.dueDate);
      if (!v || !ISO_DATE.test(v) || Number.isNaN(new Date(v).getTime())) {
        return { ok: false, status: 400, message: '"dueDate" must be an ISO date or null' };
      }
      patch.dueDate = v;
    } else {
      patch.dueDate = null;
    }
  }
  if (body.estimatedMinutes !== undefined) {
    if (body.estimatedMinutes !== null) {
      const v = body.estimatedMinutes;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 1440) {
        return { ok: false, status: 400, message: '"estimatedMinutes" must be an integer 1..1440 or null' };
      }
      patch.estimatedMinutes = v;
    } else {
      patch.estimatedMinutes = null;
    }
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') {
      return { ok: false, status: 400, message: '"description" must be a string or null' };
    }
    patch.description = body.description as string | null;
  }
  if (body.category !== undefined) {
    if (body.category !== null && typeof body.category !== 'string') {
      return { ok: false, status: 400, message: '"category" must be a string or null' };
    }
    patch.category = body.category as string | null;
  }
  if (body.eventId !== undefined) {
    if (body.eventId !== null && typeof body.eventId !== 'string') {
      return { ok: false, status: 400, message: '"eventId" must be a string or null' };
    }
    patch.eventId = body.eventId as string | null;
  }
  if (body.subtasks !== undefined) {
    const subtasks = parseSubtasks(body.subtasks);
    if (!subtasks.ok) return subtasks;
    patch.subtasks = subtasks.value;
  }
  return { ok: true, value: patch };
}

export type UpdateResult =
  | { ok: true; data: StoredData; task: DeviceTask }
  | { ok: false; status: number; message: string };

/**
 * Apply a PATCH to the task with `id`. `baseUpdatedAt` (optional) enables
 * conflict detection: if the stored task was mutated after the device last
 * saw it, the write is rejected with 409 rather than clobbering the change.
 */
export function updateTask(
  data: StoredData,
  id: string,
  patch: UpdateTaskInput,
  now: Date = new Date(),
  baseUpdatedAt?: string,
): UpdateResult {
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const idx = tasks.findIndex((t) => isRecord(t) && t.id === id);
  if (idx === -1) return { ok: false, status: 404, message: 'Task not found' };

  const current = toDeviceTask(tasks[idx]) as DeviceTask;
  if (baseUpdatedAt !== undefined && current.updatedAt !== baseUpdatedAt) {
    return { ok: false, status: 409, message: 'Conflict: task changed on the server since your last sync' };
  }

  const next: Record<string, unknown> = { ...(tasks[idx] as Record<string, unknown>) };
  const set = (key: string, value: unknown): void => {
    if (value === null) delete next[key];
    else next[key] = value;
  };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.completed !== undefined) next.completed = patch.completed;
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.color !== undefined) next.color = patch.color;
  if (patch.dueDate !== undefined) set('dueDate', patch.dueDate);
  if (patch.estimatedMinutes !== undefined) set('estimatedMinutes', patch.estimatedMinutes);
  if (patch.description !== undefined) set('description', patch.description);
  if (patch.category !== undefined) set('category', patch.category);
  if (patch.eventId !== undefined) set('eventId', patch.eventId);
  if (patch.subtasks !== undefined) next.subtasks = patch.subtasks;
  next.updatedAt = now.toISOString();

  const nextTasks = tasks.slice();
  nextTasks[idx] = next;
  return { ok: true, data: { ...data, tasks: nextTasks }, task: toDeviceTask(next) as DeviceTask };
}

export interface DeleteResult {
  data: StoredData;
  deleted: boolean;
}

/** Remove the task with `id`. Idempotent: deleting a missing id is a no-op. */
export function deleteTask(data: StoredData, id: string): DeleteResult {
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const next = tasks.filter((t) => !(isRecord(t) && t.id === id));
  return { data: { ...data, tasks: next }, deleted: next.length !== tasks.length };
}

// ----------------------------------------------------------------- HTTP layer

/** True when the path is exactly /api/v1/tasks (query string allowed). */
export function isDeviceTasksPath(url: string): boolean {
  return url.split('?')[0] === '/api/v1/tasks';
}

function qs(url: string): URLSearchParams {
  return new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?')) : '');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Read + parse a small JSON body (16 KB cap). */
function readBody(
  req: IncomingMessage,
): Promise<{ ok: true; value: unknown } | { ok: false; status: number; message: string }> {
  return new Promise((resolve) => {
    let body = '';
    let overflow = false;
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 16 * 1024) {
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
        resolve({ ok: true, value: body ? JSON.parse(body) : undefined });
      } catch {
        resolve({ ok: false, status: 400, message: 'Body must be valid JSON' });
      }
    });
  });
}

/**
 * Handle `/api/v1/tasks` (GET/POST/PATCH/DELETE).
 *
 * Auth: identical to the calendar feed — when DEVICE_TOKEN is set, require
 * `Authorization: Bearer <token>` or `?token=<token>`; when unset, the route
 * 404s (nothing is exposed by default).
 */
export async function handleDeviceTasksRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
): Promise<void> {
  const expected = process.env.DEVICE_TOKEN;
  if (!expected) {
    json(res, 404, { ok: false, error: 'Not Found' });
    return;
  }

  const params = qs(url);
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? null;
  if (!tokenMatches(bearer ?? params.get('token'), expected)) {
    json(res, 401, { ok: false, error: 'Unauthorized' });
    return;
  }

  const method = req.method ?? 'GET';

  if (method === 'GET') {
    json(res, 200, { ok: true, tasks: listTasks(readStorage()) });
    return;
  }

  if (method === 'POST') {
    const body = await readBody(req);
    if (!body.ok) {
      json(res, body.status, { ok: false, error: body.message });
      return;
    }
    const parsed = parseCreateTask(body.value);
    if (!parsed.ok) {
      json(res, parsed.status, { ok: false, error: parsed.message });
      return;
    }
    try {
      const result = createTask(readStorage(), parsed.value);
      writeStorage(result.data);
      json(res, result.duplicate ? 200 : 201, {
        ok: true,
        task: result.task,
        duplicate: result.duplicate,
      });
    } catch (err) {
      json(res, 500, { ok: false, error: err instanceof Error ? err.message : 'Write failed' });
    }
    return;
  }

  if (method === 'PATCH' || method === 'DELETE') {
    const id = params.get('id');
    if (!id) {
      json(res, 400, { ok: false, error: '"id" query parameter is required' });
      return;
    }

    if (method === 'DELETE') {
      try {
        const result = deleteTask(readStorage(), id);
        writeStorage(result.data);
        json(res, 200, { ok: true, id, deleted: result.deleted });
      } catch (err) {
        json(res, 500, { ok: false, error: err instanceof Error ? err.message : 'Write failed' });
      }
      return;
    }

    // PATCH
    const body = await readBody(req);
    if (!body.ok) {
      json(res, body.status, { ok: false, error: body.message });
      return;
    }
    const parsed = parseUpdateTask(body.value);
    if (!parsed.ok) {
      json(res, parsed.status, { ok: false, error: parsed.message });
      return;
    }
    const baseUpdatedAt = params.get('baseUpdatedAt') ?? undefined;
    try {
      const result = updateTask(readStorage(), id, parsed.value, new Date(), baseUpdatedAt);
      if (!result.ok) {
        json(res, result.status, { ok: false, error: result.message });
        return;
      }
      writeStorage(result.data);
      json(res, 200, { ok: true, task: result.task });
    } catch (err) {
      json(res, 500, { ok: false, error: err instanceof Error ? err.message : 'Write failed' });
    }
    return;
  }

  res.writeHead(405, {
    'Content-Type': 'text/plain; charset=utf-8',
    Allow: 'GET, POST, PATCH, DELETE',
  });
  res.end('Method Not Allowed');
}
