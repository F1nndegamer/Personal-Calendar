import type { CalendarEvent } from '../calendar/types';
import { normalizeExternalEvent } from './mockMagisterProvider';
import {
  externalKey,
  type ExternalScheduleEvent,
} from './types';

/**
 * Pure synchronization between external schedule data and app events.
 *
 * Guarantees:
 * - Manually-created events (source !== 'external') are never touched.
 * - Events from *other* providers are never touched.
 * - Incoming external events are matched by stable `externalId`
 *   ("<providerId>:<externalId>"), so re-importing the same data is
 *   idempotent: no duplicates, updated events update in place (their
 *   local `id` and any task link are preserved).
 * - Events previously imported from this provider that are no longer
 *   present upstream are removed.
 * - If a user linked a task to an imported event, the link survives updates.
 */
export interface SyncStats {
  added: number;
  updated: number;
  removed: number;
}

export interface SyncResult extends SyncStats {
  events: CalendarEvent[];
}

export function syncExternalEvents(
  current: CalendarEvent[],
  external: ExternalScheduleEvent[],
  providerId: string,
  fetchedAt: string,
): SyncResult {
  const prefix = `${providerId}:`;

  // normalized incoming events keyed by stable external id
  const incoming = new Map<string, CalendarEvent>();
  for (const ext of external) {
    const normalized = normalizeExternalEvent(ext, providerId, fetchedAt);
    incoming.set(normalized.externalId ?? externalKey(providerId, ext.externalId), normalized);
  }

  const result: CalendarEvent[] = [];
  const stats: SyncStats = { added: 0, updated: 0, removed: 0 };

  for (const event of current) {
    const isProviderEvent =
      event.source === 'external' &&
      typeof event.externalId === 'string' &&
      event.externalId.startsWith(prefix);

    if (!isProviderEvent) {
      // manual events and other providers' events are untouched
      result.push(event);
      continue;
    }

    const match = event.externalId ? incoming.get(event.externalId) : undefined;
    if (match) {
      // update in place: keep local id and any task link
      result.push({ ...match, id: event.id, taskId: event.taskId ?? match.taskId });
      stats.updated++;
      incoming.delete(event.externalId as string);
    } else {
      // removed upstream
      stats.removed++;
    }
  }

  for (const normalized of incoming.values()) {
    result.push(normalized);
    stats.added++;
  }

  return { events: result, ...stats };
}
