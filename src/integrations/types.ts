import type { CalendarEvent, EventColor } from '../calendar/types';

/** Half-open date range for schedule fetching. */
export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * A schedule event exactly as the external provider reports it.
 * The app never converts this directly — providers + normalization do.
 */
export interface ExternalScheduleEvent {
  /** Stable unique id within the provider (e.g. a lesson id) */
  externalId: string;
  /** Subject / lesson name, e.g. "Wiskunde B" */
  subject: string;
  /** ISO date-time */
  start: string;
  /** ISO date-time */
  end: string;
  teacher?: string;
  room?: string;
  description?: string;
  category?: string;
  color?: EventColor;
  /** LAST-MODIFIED from the ICS feed, if present (ISO) */
  lastModified?: string;
  /** DTSTAMP from the ICS feed, if present (ISO) */
  dtStamp?: string;
}

export type ProviderErrorCode =
  | 'network'
  | 'auth'
  | 'rate-limit'
  | 'parse'
  | 'unknown';

export interface ProviderError {
  code: ProviderErrorCode;
  message: string;
}

export interface ExternalFetchResult {
  /** id of the provider that produced this result */
  providerId: string;
  fetchedAt: string;
  /** Normalizable external events; empty when an error occurred */
  events: ExternalScheduleEvent[];
  /** Set when fetching failed; events is empty then */
  error?: ProviderError;
}

/**
 * A schedule source (e.g. Magister). Implementations perform the actual
 * fetching — the app only consumes normalized `CalendarEvent`s and never
 * talks to a provider directly.
 */
export interface ScheduleProvider {
  /** Stable provider id, used to namespace externalIds: "<id>:<externalId>" */
  id: string;
  displayName: string;
  fetchSchedule(range: DateRange): Promise<ExternalFetchResult>;
}

/**
 * Converts one external schedule event into the application's
 * `CalendarEvent` format. Implemented once, shared by all providers.
 */
export type ExternalEventNormalizer = (
  external: ExternalScheduleEvent,
  providerId: string,
  fetchedAt: string,
) => CalendarEvent;

/** Helper for providers/normalizers: namespaced, stable external id. */
export function externalKey(providerId: string, externalId: string): string {
  return `${providerId}:${externalId}`;
}

export function externalKeyOf(event: CalendarEvent): string | null {
  return event.source === 'external' && event.externalId ? event.externalId : null;
}
