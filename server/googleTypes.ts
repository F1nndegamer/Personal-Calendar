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

/** Raw event date/time shape from the Calendar API (`date` xor `dateTime`). */
export interface GoogleApiEventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

/** Raw event shape from the Calendar API `events.list` / `events` resource. */
export interface GoogleApiEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: GoogleApiEventDateTime;
  end?: GoogleApiEventDateTime;
  status?: string;
  updated?: string;
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
}

