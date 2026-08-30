import type { CalendarEvent, EventColor } from '../calendar/types';
import type { Priority, Task } from '../tasks/types';

/**
 * Small storage abstraction between app state and localStorage.
 *
 *   UI → App state → this module → localStorage
 *
 * - Versioned keys (`calendar-app/version`, `calendar-app/events`, `calendar-app/tasks`)
 * - Safe against missing localStorage, invalid JSON and malformed data
 * - Falls back to defaults (mock data) whenever stored data can't be trusted
 * - Contains a migration table so the format can evolve without data loss
 */

export const SCHEMA_VERSION = 1;

const KEY_VERSION = 'calendar-app/version';
const KEY_EVENTS = 'calendar-app/events';
const KEY_TASKS = 'calendar-app/tasks';

export interface AppSnapshot {
  events: CalendarEvent[];
  tasks: Task[];
}

// ---------------------------------------------------------------- helpers

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // localStorage unavailable (private mode, disabled, etc.)
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // quota exceeded / unavailable — persistence is best-effort
  }
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null; // corrupted JSON
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isDateString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && !Number.isNaN(new Date(v).getTime());
}

const EVENT_COLORS: readonly EventColor[] = ['blue', 'green', 'amber', 'red', 'purple', 'cyan'];
const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high'];

// ---------------------------------------------------------------- validation

function validateEvent(v: unknown): CalendarEvent | null {
  if (!isRecord(v)) return null;
  if (typeof v.id !== 'string' || typeof v.title !== 'string') return null;
  if (!isDateString(v.start) || !isDateString(v.end)) return null;
  const color = EVENT_COLORS.find((c) => c === v.color);
  return {
    id: v.id,
    title: v.title,
    description: typeof v.description === 'string' ? v.description : undefined,
    start: v.start,
    end: v.end,
    color: color ?? 'blue',
    category: typeof v.category === 'string' ? v.category : undefined,
    taskId: typeof v.taskId === 'string' ? v.taskId : undefined,
    recurrence: typeof v.recurrence === 'string' ? v.recurrence : undefined,
    // external-source metadata (additive, optional — safe for v1 data)
    source: v.source === 'external' ? 'external' : v.source === 'local' ? 'local' : undefined,
    externalId: typeof v.externalId === 'string' ? v.externalId : undefined,
    lastSyncedAt: isDateString(v.lastSyncedAt) ? v.lastSyncedAt : undefined,
  };
}

function validateTask(v: unknown): Task | null {
  if (!isRecord(v)) return null;
  if (typeof v.id !== 'string' || typeof v.title !== 'string') return null;
  const priority = PRIORITIES.find((p) => p === v.priority) ?? 'medium';
  const color = EVENT_COLORS.find((c) => c === v.color) ?? 'blue';
  const subtasks = Array.isArray(v.subtasks)
    ? v.subtasks.flatMap((s: unknown) => {
        if (!isRecord(s) || typeof s.id !== 'string' || typeof s.title !== 'string') return [];
        return [{
          id: s.id,
          title: s.title,
          completed: s.completed === true,
        }];
      })
    : [];
  return {
    id: v.id,
    title: v.title,
    description: typeof v.description === 'string' ? v.description : undefined,
    completed: v.completed === true,
    priority,
    category: typeof v.category === 'string' ? v.category : undefined,
    color,
    dueDate: isDateString(v.dueDate) ? v.dueDate : undefined,
    estimatedMinutes:
      typeof v.estimatedMinutes === 'number' && Number.isFinite(v.estimatedMinutes)
        ? v.estimatedMinutes
        : undefined,
    subtasks,
    eventId: typeof v.eventId === 'string' ? v.eventId : undefined,
  };
}

function validateArray<T>(raw: unknown, validate: (v: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: unknown) => {
    const valid = validate(item);
    return valid ? [valid] : [];
  });
}

// ---------------------------------------------------------------- migrations

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migration steps keyed by the version they upgrade *from*.
 * e.g. when SCHEMA_VERSION becomes 2, add: `1: (data) => ({ ...data, ... })`
 */
const MIGRATIONS: Record<number, Migration> = {
  // 1 → 2: (data) => ({ ...data, newField: ... }),
};

function migrate(data: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
  let current = data;
  for (let v = fromVersion; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (step) current = step(current);
  }
  return current;
}

// ---------------------------------------------------------------- public API

/**
 * Loads events + tasks from localStorage.
 * Returns null when there is no stored data or the data is unsafe
 * (corrupted JSON, malformed entries, unknown future version) —
 * callers should fall back to their default/mock data.
 */
export function loadSnapshot(): AppSnapshot | null {
  const eventsRaw = readRaw(KEY_EVENTS);
  const tasksRaw = readRaw(KEY_TASKS);
  if (eventsRaw === null && tasksRaw === null) return null; // first run

  const versionRaw = readRaw(KEY_VERSION);
  const storedVersion = versionRaw === null ? SCHEMA_VERSION : Number(versionRaw);
  if (!Number.isInteger(storedVersion) || storedVersion < 1) return null;
  if (storedVersion > SCHEMA_VERSION) return null; // data from a newer app build

  // JSON.parse returns null for a literal "null" string — treat as corrupted
  const parsedEvents = eventsRaw === null ? undefined : parseJson(eventsRaw);
  const parsedTasks = tasksRaw === null ? undefined : parseJson(tasksRaw);
  if (parsedEvents === null || parsedTasks === null) return null;

  const migrated = migrate(
    { events: parsedEvents, tasks: parsedTasks },
    storedVersion,
  );
  const events = validateArray(migrated.events, validateEvent);
  const tasks = validateArray(migrated.tasks, validateTask);

  return { events, tasks };
}

/** Persists the current snapshot. Called automatically on state changes. */
export function saveSnapshot(snapshot: AppSnapshot): void {
  writeRaw(KEY_VERSION, String(SCHEMA_VERSION));
  writeRaw(KEY_EVENTS, JSON.stringify(snapshot.events));
  writeRaw(KEY_TASKS, JSON.stringify(snapshot.tasks));
}

/** Removes all stored app data (useful for debugging / "reset"). */
export function clearStoredData(): void {
  try {
    localStorage.removeItem(KEY_VERSION);
    localStorage.removeItem(KEY_EVENTS);
    localStorage.removeItem(KEY_TASKS);
  } catch {
    // ignore
  }
}
