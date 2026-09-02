/**
 * Server-side persistence layer.
 *
 * On load: tries to load from the server first (GET /api/storage).
 * If that fails (dev server, offline, etc.), falls back to localStorage.
 *
 * On save: writes to both server (PUT /api/storage) and localStorage.
 * The server write is fire-and-forget with debouncing — localStorage
 * is the fast synchronous cache so the UI is never blocked.
 *
 * The server is the source of truth for events/tasks. localStorage is
 * the local cache that enables offline operation.
 */
import type { CalendarEvent } from './calendar/types';
import type { Task } from './tasks/types';
import type { StoredData } from '../server/storage';

const STORAGE_URL = '/api/storage';

/** Shape of what we store server-side */
export interface ServerSnapshot {
  events: CalendarEvent[];
  tasks: Task[];
  feedUrl: string | null;
}

// ------------------------------------------------------------------ read

async function fetchServer<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadFromServer(): Promise<ServerSnapshot | null> {
  const data = await fetchServer<StoredData>(STORAGE_URL);
  if (!data) return null;
  return {
    events: data.events as CalendarEvent[],
    tasks: data.tasks as Task[],
    feedUrl: data.feedUrl,
  };
}

// ------------------------------------------------------------------ write

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function saveToServer(snapshot: ServerSnapshot): void {
  // Debounce: wait 1s after the last change before writing to the server.
  // This avoids hammering the Pi on every keystroke.
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fetch(STORAGE_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: snapshot.events,
          tasks: snapshot.tasks,
          feedUrl: snapshot.feedUrl,
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // Server write failed — localStorage is the cache, data is not lost.
      // A future successful write will sync it up.
    }
  }, 1000);
}
