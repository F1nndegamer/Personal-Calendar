/**
 * Push (app → Google) client helpers.
 *
 * Talks to the same-origin `/api/google/push*` endpoints only — OAuth
 * tokens stay server-side. The payload is the complete set of local
 * (non-Google) events plus the user's tasks; the server diffs it against the
 * mapping stored on the last push, so calling this repeatedly is safe and
 * idempotent.
 */
import type { CalendarEvent } from '../calendar/types';
import type { Task } from '../tasks/types';
import type { GooglePushEvent, GooglePushResponse } from '../../server/googleTypes';

/** Matches `createGoogleProvider().id` in googleProvider.ts. */
const GOOGLE_PROVIDER_PREFIX = 'google:';

/**
 * Prefix for the mapping key of a mirrored task — keeps task copies apart
 * from event copies (and from the id namespace of `CalendarEvent`).
 */
export const TASK_PUSH_ID_PREFIX = 'task:';

/** Block length used for a task with a due *time* but no estimate. */
const DEFAULT_TASK_MINUTES = 30;

/**
 * Events that should be mirrored to Google: everything EXCEPT events that
 * came FROM Google (pushing those back would duplicate them). Covers manual
 * events (source 'local'/undefined) and other providers such as Magister.
 */
export function collectPushEvents(events: readonly CalendarEvent[]): GooglePushEvent[] {
  const out: GooglePushEvent[] = [];
  for (const ev of events) {
    if (
      ev.source === 'external' &&
      typeof ev.externalId === 'string' &&
      ev.externalId.startsWith(GOOGLE_PROVIDER_PREFIX)
    ) {
      continue;
    }
    out.push({
      id: ev.id,
      title: ev.title.trim() || 'Untitled event',
      start: ev.start,
      end: ev.end,
      ...(ev.description ? { description: ev.description } : {}),
    });
  }
  return out;
}

/** `YYYY-MM-DD` for the *local* calendar day of `d` (all-day payloads). */
function localDate(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * True when a due date carries no wall-clock time — the same convention the
 * task UI uses (`formatDue` prints no clock for a midnight due date), so a
 * date-only pick becomes an all-day event instead of a 00:00–00:30 block.
 */
function hasNoDueTime(d: Date): boolean {
  return d.getHours() === 0 && d.getMinutes() === 0;
}

/** Description Google shows for a mirrored task (notes, subtasks, meta). */
function taskPushDescription(task: Task): string | undefined {
  const lines: string[] = [];
  const notes = task.description?.trim();
  if (notes) lines.push(notes);
  const subtasks = task.subtasks.filter((s) => s.title.trim().length > 0);
  if (subtasks.length > 0) {
    if (lines.length > 0) lines.push('');
    for (const s of subtasks) lines.push(`${s.completed ? '☑' : '☐'} ${s.title.trim()}`);
  }
  const meta: string[] = [];
  if (task.priority !== 'medium') meta.push(`Priority: ${task.priority}`);
  const category = task.category?.trim();
  if (category) meta.push(`Category: ${category}`);
  if (meta.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(meta.join(' · '));
  }
  if (task.completed) {
    if (lines.length > 0) lines.push('');
    lines.push('Completed in Personal Calendar.');
  }
  if (lines.length === 0) return undefined;
  return `${lines.join('\n')}\n\n— Personal Calendar task`;
}

/**
 * Tasks that should be mirrored to Google: every task with a usable due date.
 *
 * - a due date *without* a time → all-day event on that day
 * - a due date with a time → block of `estimatedMinutes` (default 30)
 * - a completed task keeps its place with a `✓` in the title (Google Tasks
 *   shows completed work too); completing it just updates the copy
 * - a task already scheduled onto the calendar (`eventId`) is skipped: its
 *   linked event is pushed anyway and both would show up as duplicates
 * - tasks without a due date cannot be placed on a calendar
 */
export function collectPushTasks(tasks: readonly Task[]): GooglePushEvent[] {
  const out: GooglePushEvent[] = [];
  for (const task of tasks) {
    if (!task.dueDate || task.eventId) continue;
    const due = new Date(task.dueDate);
    if (Number.isNaN(due.getTime())) continue;
    const title = task.title.trim() || 'Untitled task';
    const description = taskPushDescription(task);
    let start: string;
    let end: string;
    if (hasNoDueTime(due)) {
      const nextDay = new Date(due);
      nextDay.setDate(nextDay.getDate() + 1); // Google's all-day end is exclusive
      start = localDate(due);
      end = localDate(nextDay);
    } else {
      const minutes = Math.max(5, task.estimatedMinutes ?? DEFAULT_TASK_MINUTES);
      start = due.toISOString();
      end = new Date(due.getTime() + minutes * 60_000).toISOString();
    }
    out.push({
      id: `${TASK_PUSH_ID_PREFIX}${task.id}`,
      title: task.completed ? `✓ ${title}` : title,
      start,
      end,
      ...(description ? { description } : {}),
    });
  }
  return out;
}

/** Complete push payload: local events first, then mirrored tasks. */
export function collectPushPayload(
  events: readonly CalendarEvent[],
  tasks: readonly Task[] = [],
): GooglePushEvent[] {
  return [...collectPushEvents(events), ...collectPushTasks(tasks)];
}

export interface GooglePushOutcome {
  ok: boolean;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  /** Human-readable failure (HTTP error, network failure, …). */
  error?: string;
  /** Server was busy with another push — not an error, just skip. */
  busy?: boolean;
}

/** First pushes can create hundreds of events — keep well under proxy limits. */
const PUSH_TIMEOUT_MS = 60_000;

/**
 * POST the full local event set to `/api/google/push`. Never throws —
 * failures come back as `ok: false` + `error` so callers can toast them.
 */
export async function pushToGoogle(
  events: GooglePushEvent[],
  fetchImpl: typeof fetch = fetch,
): Promise<GooglePushOutcome> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    const res = await fetchImpl('/api/google/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ events }),
      signal: controller.signal,
    });
    // 429 = another tab/device is already pushing (server single-flight).
    if (res.status === 429) {
      return { ok: true, created: 0, updated: 0, deleted: 0, skipped: 0, busy: true };
    }
    let parsed: GooglePushResponse | null = null;
    try {
      parsed = (await res.json()) as GooglePushResponse;
    } catch {
      // fall through to the HTTP-status error below
    }
    if (!res.ok || !parsed) {
      return {
        ok: false, created: 0, updated: 0, deleted: 0, skipped: 0,
        error: parsed?.error ?? `HTTP ${res.status}`,
      };
    }
    return {
      ok: parsed.ok,
      created: parsed.created,
      updated: parsed.updated,
      deleted: parsed.deleted,
      skipped: parsed.skipped,
      error: parsed.ok
        ? undefined
        : parsed.errors?.[0]?.error ?? parsed.error ?? 'Some events failed to push',
    };
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.name));
    return {
      ok: false, created: 0, updated: 0, deleted: 0, skipped: 0,
      error: isTimeout
        ? 'Push timed out — Google did not respond in time'
        : err instanceof Error
          ? err.message
          : 'Failed to reach the server',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Choose the calendar pushes land in. Throws on failure (Settings shows it). */
export async function setPushTarget(
  calendarId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl('/api/google/push-target', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ calendarId }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // keep the HTTP status message
    }
    throw new Error(msg);
  }
}


