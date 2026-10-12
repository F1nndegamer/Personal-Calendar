import { readStorage, writeStorage } from './storage.js';
import { tokenMatches } from './webhook.js';
const PRIORITIES = ['low', 'medium', 'high'];
const COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'cyan'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
function isRecord(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v) {
    return typeof v === 'string' && v.length > 0 ? v : undefined;
}
/** Coerce an unknown stored value into a {@link DeviceTask}, or null. */
export function toDeviceTask(raw) {
    if (!isRecord(raw))
        return null;
    if (typeof raw.id !== 'string' || typeof raw.title !== 'string')
        return null;
    const priority = PRIORITIES.includes(raw.priority) ? raw.priority : 'medium';
    const color = COLORS.includes(raw.color) ? raw.color : 'blue';
    const subtasks = Array.isArray(raw.subtasks)
        ? raw.subtasks.flatMap((s) => {
            if (!isRecord(s) || typeof s.id !== 'string' || typeof s.title !== 'string')
                return [];
            return [{ id: s.id, title: s.title, completed: s.completed === true }];
        })
        : [];
    const task = {
        id: raw.id,
        title: raw.title,
        completed: raw.completed === true,
        priority,
        color,
        subtasks,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
    };
    if (typeof raw.description === 'string')
        task.description = raw.description;
    if (typeof raw.category === 'string' && raw.category.length > 0)
        task.category = raw.category;
    if (typeof raw.dueDate === 'string')
        task.dueDate = raw.dueDate;
    if (typeof raw.estimatedMinutes === 'number')
        task.estimatedMinutes = raw.estimatedMinutes;
    if (typeof raw.eventId === 'string')
        task.eventId = raw.eventId;
    return task;
}
/** All stored tasks, normalised. */
export function listTasks(data) {
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    return tasks.flatMap((t) => {
        const dt = toDeviceTask(t);
        return dt ? [dt] : [];
    });
}
function parseSubtasks(raw) {
    if (raw === undefined)
        return { ok: true, value: [] };
    if (!Array.isArray(raw))
        return { ok: false, status: 400, message: '"subtasks" must be an array' };
    const out = [];
    for (const s of raw) {
        if (!isRecord(s) || typeof s.id !== 'string' || typeof s.title !== 'string') {
            return { ok: false, status: 400, message: 'each subtask needs string "id" and "title"' };
        }
        out.push({ id: s.id, title: s.title, completed: s.completed === true });
    }
    return { ok: true, value: out };
}
/** Validate a create body. `title` required; everything else optional. */
export function parseCreateTask(body) {
    if (!isRecord(body))
        return { ok: false, status: 400, message: 'Body must be a JSON object' };
    const title = str(body.title)?.trim();
    if (!title)
        return { ok: false, status: 400, message: '"title" is required' };
    if (title.length > 200)
        return { ok: false, status: 400, message: '"title" too long (max 200 chars)' };
    const dueDate = str(body.dueDate);
    if (dueDate !== undefined) {
        const valid = ISO_DATE.test(dueDate) && !Number.isNaN(new Date(dueDate).getTime());
        if (!valid)
            return { ok: false, status: 400, message: '"dueDate" must be an ISO date or date-time' };
    }
    const priority = str(body.priority);
    if (priority !== undefined && !PRIORITIES.includes(priority)) {
        return { ok: false, status: 400, message: '"priority" must be low, medium or high' };
    }
    const color = str(body.color);
    if (color !== undefined && !COLORS.includes(color)) {
        return { ok: false, status: 400, message: `"color" must be one of ${COLORS.join(', ')}` };
    }
    const estimatedMinutes = body.estimatedMinutes;
    if (estimatedMinutes !== undefined &&
        (typeof estimatedMinutes !== 'number' || !Number.isInteger(estimatedMinutes) || estimatedMinutes < 1 || estimatedMinutes > 1440)) {
        return { ok: false, status: 400, message: '"estimatedMinutes" must be an integer between 1 and 1440' };
    }
    const subtasks = parseSubtasks(body.subtasks);
    if (!subtasks.ok)
        return subtasks;
    const input = { title };
    if (str(body.id))
        input.id = str(body.id);
    if (typeof body.description === 'string')
        input.description = body.description;
    if (body.completed === true)
        input.completed = true;
    if (priority)
        input.priority = priority;
    if (typeof body.category === 'string' && body.category.length > 0)
        input.category = body.category;
    if (color)
        input.color = color;
    if (dueDate)
        input.dueDate = dueDate;
    if (typeof estimatedMinutes === 'number')
        input.estimatedMinutes = estimatedMinutes;
    if (subtasks.value.length)
        input.subtasks = subtasks.value;
    if (str(body.eventId))
        input.eventId = str(body.eventId);
    return { ok: true, value: input };
}
/** Append a task (idempotent when `input.id` is supplied and already exists). */
export function createTask(data, input, now = new Date()) {
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    if (input.id !== undefined && tasks.some((t) => isRecord(t) && t.id === input.id)) {
        const existing = toDeviceTask(tasks.find((t) => isRecord(t) && t.id === input.id));
        return { data, task: existing, duplicate: true };
    }
    const id = input.id ?? `dev-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const stored = {
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
        task: toDeviceTask(stored),
        duplicate: false,
    };
}
/** Validate a PATCH body (all fields optional). */
export function parseUpdateTask(body) {
    if (!isRecord(body))
        return { ok: false, status: 400, message: 'Body must be a JSON object' };
    const patch = {};
    if (body.title !== undefined) {
        const title = str(body.title)?.trim();
        if (!title)
            return { ok: false, status: 400, message: '"title" must be a non-empty string' };
        if (title.length > 200)
            return { ok: false, status: 400, message: '"title" too long (max 200 chars)' };
        patch.title = title;
    }
    if (body.completed !== undefined) {
        if (typeof body.completed !== 'boolean')
            return { ok: false, status: 400, message: '"completed" must be a boolean' };
        patch.completed = body.completed;
    }
    if (body.priority !== undefined) {
        if (!PRIORITIES.includes(body.priority))
            return { ok: false, status: 400, message: '"priority" must be low, medium or high' };
        patch.priority = body.priority;
    }
    if (body.color !== undefined) {
        if (!COLORS.includes(body.color))
            return { ok: false, status: 400, message: `"color" must be one of ${COLORS.join(', ')}` };
        patch.color = body.color;
    }
    if (body.dueDate !== undefined) {
        if (body.dueDate !== null) {
            const v = str(body.dueDate);
            if (!v || !ISO_DATE.test(v) || Number.isNaN(new Date(v).getTime())) {
                return { ok: false, status: 400, message: '"dueDate" must be an ISO date or null' };
            }
            patch.dueDate = v;
        }
        else {
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
        }
        else {
            patch.estimatedMinutes = null;
        }
    }
    if (body.description !== undefined) {
        if (body.description !== null && typeof body.description !== 'string') {
            return { ok: false, status: 400, message: '"description" must be a string or null' };
        }
        patch.description = body.description;
    }
    if (body.category !== undefined) {
        if (body.category !== null && typeof body.category !== 'string') {
            return { ok: false, status: 400, message: '"category" must be a string or null' };
        }
        patch.category = body.category;
    }
    if (body.eventId !== undefined) {
        if (body.eventId !== null && typeof body.eventId !== 'string') {
            return { ok: false, status: 400, message: '"eventId" must be a string or null' };
        }
        patch.eventId = body.eventId;
    }
    if (body.subtasks !== undefined) {
        const subtasks = parseSubtasks(body.subtasks);
        if (!subtasks.ok)
            return subtasks;
        patch.subtasks = subtasks.value;
    }
    return { ok: true, value: patch };
}
/**
 * Apply a PATCH to the task with `id`. `baseUpdatedAt` (optional) enables
 * conflict detection: if the stored task was mutated after the device last
 * saw it, the write is rejected with 409 rather than clobbering the change.
 */
export function updateTask(data, id, patch, now = new Date(), baseUpdatedAt) {
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const idx = tasks.findIndex((t) => isRecord(t) && t.id === id);
    if (idx === -1)
        return { ok: false, status: 404, message: 'Task not found' };
    const current = toDeviceTask(tasks[idx]);
    if (baseUpdatedAt !== undefined && current.updatedAt !== baseUpdatedAt) {
        return { ok: false, status: 409, message: 'Conflict: task changed on the server since your last sync' };
    }
    const next = { ...tasks[idx] };
    const set = (key, value) => {
        if (value === null)
            delete next[key];
        else
            next[key] = value;
    };
    if (patch.title !== undefined)
        next.title = patch.title;
    if (patch.completed !== undefined)
        next.completed = patch.completed;
    if (patch.priority !== undefined)
        next.priority = patch.priority;
    if (patch.color !== undefined)
        next.color = patch.color;
    if (patch.dueDate !== undefined)
        set('dueDate', patch.dueDate);
    if (patch.estimatedMinutes !== undefined)
        set('estimatedMinutes', patch.estimatedMinutes);
    if (patch.description !== undefined)
        set('description', patch.description);
    if (patch.category !== undefined)
        set('category', patch.category);
    if (patch.eventId !== undefined)
        set('eventId', patch.eventId);
    if (patch.subtasks !== undefined)
        next.subtasks = patch.subtasks;
    next.updatedAt = now.toISOString();
    const nextTasks = tasks.slice();
    nextTasks[idx] = next;
    return { ok: true, data: { ...data, tasks: nextTasks }, task: toDeviceTask(next) };
}
/** Remove the task with `id`. Idempotent: deleting a missing id is a no-op. */
export function deleteTask(data, id) {
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const next = tasks.filter((t) => !(isRecord(t) && t.id === id));
    return { data: { ...data, tasks: next }, deleted: next.length !== tasks.length };
}
// ----------------------------------------------------------------- HTTP layer
/** True when the path is exactly /api/v1/tasks (query string allowed). */
export function isDeviceTasksPath(url) {
    return url.split('?')[0] === '/api/v1/tasks';
}
function qs(url) {
    return new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?')) : '');
}
function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
}
/** Read + parse a small JSON body (16 KB cap). */
function readBody(req) {
    return new Promise((resolve) => {
        let body = '';
        let overflow = false;
        req.on('data', (chunk) => {
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
            }
            catch {
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
export async function handleDeviceTasksRequest(req, res, url) {
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
        }
        catch (err) {
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
            }
            catch (err) {
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
        }
        catch (err) {
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
