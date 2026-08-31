import type { CalendarEvent } from '../calendar/types';
import {
  externalKey,
  type ExternalScheduleEvent,
} from './types';

/**
 * Shared normalization: external schedule event → app `CalendarEvent`.
 * Used by all schedule providers (Magister, etc.) so that an imported event
 * is always represented consistently in app state.
 */
export function normalizeExternalEvent(
  external: ExternalScheduleEvent,
  providerId: string,
  fetchedAt: string,
): CalendarEvent {
  const details = [external.teacher, external.room ? `Lokaal ${external.room}` : null]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return {
    id: `ext-${externalKey(providerId, external.externalId)}`,
    title: external.subject,
    description: details || external.description,
    start: external.start,
    end: external.end,
    color: external.color ?? 'blue',
    category: external.category ?? 'School',
    source: 'external',
    externalId: externalKey(providerId, external.externalId),
    lastSyncedAt: fetchedAt,
  };
}
