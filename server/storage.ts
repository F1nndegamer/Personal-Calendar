/**
 * JSON file-based storage for the calendar proxy.
 *
 * Data lives at STORAGE_PATH (default /var/lib/personal-calendar/data.json).
 * Written atomically (tmp + rename). Self-contained.
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface StoredData {
  events: unknown[];
  tasks: unknown[];
  feedUrl: string | null;
}

const DEFAULT_DATA: StoredData = { events: [], tasks: [], feedUrl: null };

function storagePath(): string {
  return process.env.STORAGE_PATH || '/var/lib/personal-calendar/data.json';
}

function ensureDir(): void {
  const dir = resolve(dirname(storagePath()));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readStorage(): StoredData {
  try {
    const path = storagePath();
    if (!existsSync(path)) return DEFAULT_DATA;
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<StoredData>;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_DATA;
    return {
      events: Array.isArray(parsed.events) ? parsed.events : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      feedUrl: typeof parsed.feedUrl === 'string' ? parsed.feedUrl : null,
    };
  } catch {
    return DEFAULT_DATA;
  }
}

export function writeStorage(data: StoredData): void {
  ensureDir();
  const path = storagePath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), 'utf-8');
  try {
    renameSync(tmp, path);
  } catch {
    writeFileSync(path, JSON.stringify(data), 'utf-8');
  }
}
