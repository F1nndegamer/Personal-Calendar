/**
 * Shared Google Calendar integration types.
 *
 * This module is intentionally dependency-free (no Node builtins, no DOM
 * APIs) so it can be imported from both the browser bundle (`src/`) and
 * the Node server (`server/`).
 */

export type GoogleConnectionStatus =
  | 'disconnected'
  | 'connected'
  | 'expired'
  | 'error';

export interface GoogleCalendarRef {
  id: string;
  summary: string;
  /** e.g. 'owner' | 'writer' | 'reader' */
  accessRole?: string;
  primary?: boolean;
  backgroundColor?: string;
}

export interface GoogleConnection {
  status: GoogleConnectionStatus;
  /** The Google account address (from the `userinfo.email` scope). */
  email?: string;
  /** Epoch ms of the last successful Google sync, if any. */
  lastSyncAt?: number;
  /** Human-readable detail for the `error` state. */
  error?: string;
}

/** Stored OAuth tokens (server-side only — never sent to the browser). */
export interface GoogleTokens {
  accessToken: string;
  /** Epoch ms when `accessToken` expires. */
  expiresAt: number;
  /** Present when offline access was granted; persists across restarts. */
  refreshToken?: string;
  /** Granted scopes, space-joined. */
  scope?: string;
  tokenType?: string;
}

/** Least-privilege scopes for this integration. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
] as const;

export const GOOGLE_SCOPE_STRING: string = GOOGLE_SCOPES.join(' ');

/**
 * Stamp every event this app creates on Google with `extendedProperties`,
 * so a copy can always be recognised as ours — even when the local `pushed`
 * mapping no longer knows about it (a push run that failed after it created
 * events, an interrupted deploy, a restored auth file, …). Without the stamp
 * such copies come back through the import as duplicates of the very event
 * they mirror.
 */
export const PUSH_TAG_KEY = 'pcApp';
/** Value of `PUSH_TAG_KEY` written by this app. */
export const PUSH_TAG_VALUE = 'personal-calendar';
/** Key of the local event id inside the same private property bag. */
export const PUSH_LOCAL_ID_KEY = 'pcLocalId';

/** Private extended-property bag marking one Google event as our copy. */
export function pushTag(localId: string): Record<string, string> {
  return { [PUSH_TAG_KEY]: PUSH_TAG_VALUE, [PUSH_LOCAL_ID_KEY]: localId };
}

/** True when a `extendedProperties.private` bag was written by this app. */
export function isOwnCopyTag(privateProps?: Record<string, string>): boolean {
  return !!privateProps && privateProps[PUSH_TAG_KEY] === PUSH_TAG_VALUE;
}

/** Raw event date/time shape from the Calendar API (`date` xor `dateTime`). */
export interface GoogleApiEventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

/** Raw event shape from the Calendar API `events.list` / `events` resource. */
export interface GoogleApiEvent {
  /** Always present in API responses; optional here so mappers can pre-check. */
  id?: string;
  summary?: string;
  description?: string;
  start?: GoogleApiEventDateTime;
  end?: GoogleApiEventDateTime;
  status?: string;
  updated?: string;
  /** Present when the event carries private extended properties (see `pushTag`). */
  extendedProperties?: { private?: Record<string, string> };
}

/** Raw calendarList entry shape (`calendarList.list`). */
export interface GoogleApiCalendarListEntry {
  id: string;
  summary?: string;
  primary?: boolean;
  accessRole?: string;
  backgroundColor?: string;
}

export interface GoogleSelection {
  calendarIds: string[];
}

/** Frontend ↔ server contract for `GET /api/google/status`. */
export interface GoogleStatusResponse {
  connected: boolean;
  email?: string;
  calendars: GoogleCalendarRef[];
  selectedCalendarIds: string[];
  lastSyncAt?: number;
  error?: string;
  /** Calendar id that local events are pushed to (server default when unset). */
  pushCalendarId?: string;
  /** Epoch ms of the last successful push (app → Google), if any. */
  lastPushAt?: number;
  /** Human-readable detail for the last failed push, if any. */
  lastPushError?: string;
}

/**
 * One local event as sent by the browser to `POST /api/google/push`.
 * The list is the *complete* desired state of non-Google events — anything
 * previously pushed but missing from it gets deleted on Google's side.
 */
export interface GooglePushEvent {
  /** Local CalendarEvent id (stable, used as the mapping key). */
  id: string;
  title: string;
  /** ISO date-time */
  start: string;
  /** ISO date-time */
  end: string;
  description?: string;
}

/** Server ↔ frontend contract for `POST /api/google/push`. */
export interface GooglePushResponse {
  ok: boolean;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  /**
   * Stray copies of local events (older failed pushes) that were removed from
   * imported calendars during this run — a repair, not user-visible work.
   */
  swept?: number;
  /** Per-event failures (partial success still returns 200 with ok:false). */
  errors?: { id: string; error: string }[];
  /** Fatal error message (502/401/… responses). */
  error?: string;
}

