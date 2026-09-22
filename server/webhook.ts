/**
 * Webhook: remote task creation (GameIdea.md — "Webhooks / API endpoint for
 * remote task creation").
 *
 *   POST /api/webhook/task
 *   Authorization: Bearer <WEBHOOK_TOKEN>   (or ?token=<token>)
 *   { "title": "Read chapter 5", "dueDate": "2026-09-23T17:00:00Z",
 *     "priority": "high", "estimatedMinutes": 45 }
 *
 * - The endpoint is DISABLED unless the WEBHOOK_TOKEN env var is set, so a
 *   default deployment exposes nothing.
 * - Created tasks are appended to the shared storage file; the web app picks
 *   them up on its next load or "Reload" (the server is the source of truth).
 * - Supplying an "id" makes retries idempotent: reposting the same id is a
 *   no-op that reports `duplicate: true` instead of creating a second task.
 *
 * The pure parts (validation, append, token comparison) live here so they
 * are unit-testable without sockets.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { StoredData } from './storage.js';

export interface WebhookTaskInput {
  id?: string;
  title: string;
  description?: string;
  /** ISO date or date-time string */
  dueDate?: string;
  priority?: 'low' | 'medium' | 'high';
  category?: string;
  color?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'cyan';
  estimatedMinutes?: number;
}

export type ParseResult =
  | { ok: true; input: WebhookTaskInput }
  | { ok: false; status: 400; message: string };

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

/** Validate a webhook body into a {@link WebhookTaskInput}, or a 400 reason. */
export function parseWebhookTask(body: unknown): ParseResult {
  if (!isRecord(body)) {
    return { ok: false, status: 400, message: 'Body must be a JSON object' };
  }
  const title = str(body.title)?.trim();
  if (!title) return { ok: false, status: 400, message: '"title" is required' };
  if (title.length > 200) {
    return { ok: false, status: 400, message: '"title" too long (max 200 chars)' };
  }

  const dueDate = str(body.dueDate);
  if (dueDate !== undefined) {
    const valid = ISO_DATE.test(dueDate) && !Number.isNaN(new Date(dueDate).getTime());
    if (!valid) {
      return { ok: false, status: 400, message: '"dueDate" must be an ISO date or date-time' };
    }
  }

  const priority = str(body.priority);
  if (priority !== undefined && !PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) {
    return { ok: false, status: 400, message: '"priority" must be low, medium or high' };
  }

  const color = str(body.color);
  if (color !== undefined && !COLORS.includes(color as (typeof COLORS)[number])) {
    return { ok: false, status: 400, message: `"color" must be one of ${COLORS.join(', ')}` };
  }

  const estimatedMinutes = body.estimatedMinutes;
  if (
    estimatedMinutes !== undefined &&
    (typeof estimatedMinutes !== 'number' ||
      !Number.isInteger(estimatedMinutes) ||
      estimatedMinutes < 1 ||
      estimatedMinutes > 24 * 60)
  ) {
    return {
      ok: false,
      status: 400,
      message: '"estimatedMinutes" must be an integer between 1 and 1440',
    };
  }

  return {
    ok: true,
    input: {
      id: str(body.id),
      title,
      description: str(body.description),
      dueDate,
      priority: priority as WebhookTaskInput['priority'],
      category: str(body.category),
      color: color as WebhookTaskInput['color'],
      estimatedMinutes: estimatedMinutes as number | undefined,
    },
  };
}

export interface AppendResult {
  data: StoredData;
  id: string;
  /** True when a task with the supplied id already existed (nothing added). */
  duplicate: boolean;
}

/** Build the stored task and append it (idempotent when `input.id` is given). */
export function appendWebhookTask(
  data: StoredData,
  input: WebhookTaskInput,
  now: Date = new Date(),
): AppendResult {
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  if (input.id !== undefined && tasks.some((t) => isRecord(t) && t.id === input.id)) {
    return { data, id: input.id, duplicate: true };
  }
  const id = input.id ?? `wh-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const task = {
    id,
    title: input.title,
    description: input.description,
    completed: false,
    priority: input.priority ?? 'medium',
    category: input.category,
    color: input.color ?? 'blue',
    dueDate: input.dueDate,
    estimatedMinutes: input.estimatedMinutes,
    subtasks: [],
  };
  return { data: { ...data, tasks: [...tasks, task] }, id, duplicate: false };
}

/**
 * Constant-time token comparison. Both sides are hashed first so lengths
 * never leak and `timingSafeEqual` always gets equal-size buffers.
 */
export function tokenMatches(provided: string | null, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
