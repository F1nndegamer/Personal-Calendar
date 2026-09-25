/**
 * Google OAuth 2.0 + Calendar API helpers (server-side).
 *
 * Pure module with injectable `fetchImpl` so every network path is
 * unit-testable without sockets. Secrets never leave the server:
 * tokens live in `googleStore.ts` and are never logged or sent
 * to the browser.
 */

import { pushTag } from './googleTypes.js';
import type { GoogleApiEvent } from './googleTypes.js';


export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** e.g. 'https://calendar.f1nn.me/api/google/callback' */
  redirectUri: string;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export interface GoogleApiError {
  code: number;
  message: string;
}

export type FetchImpl = typeof fetch;

const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_API_BASE = 'https://www.googleapis.com/calendar/v3';

/** Random `state` for CSRF protection on the OAuth callback. */
export function newOAuthState(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Authorization URL the browser is redirected to. */
export function buildAuthUrl(
  config: GoogleOAuthConfig,
  scopes: readonly string[] | string,
  state: string,
): string {
  const scope = Array.isArray(scopes) ? scopes.join(' ') : scopes;
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope,
    state,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

async function postForm(
  url: string,
  params: Record<string, string>,
  fetchImpl: FetchImpl,
  what: string,
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`${what} failed with HTTP ${res.status}`), {
      googleApiError: { code: res.status, message: `${what} failed with HTTP ${res.status}` } as GoogleApiError,
    });
  }
  const json = (await res.json()) as Record<string, unknown>;
  if (typeof json.access_token !== 'string' || typeof json.expires_in !== 'number') {
    throw new Error(`${what} returned an unexpected response`);
  }
  return json;
}

/** Exchange an authorization `code` for tokens. Throws on failure. */
export async function exchangeCode(
  config: GoogleOAuthConfig,
  code: string,
  fetchImpl: FetchImpl = fetch,
): Promise<TokenResponse> {
  const json = await postForm(url_token(), {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  }, fetchImpl, 'Token exchange');
  return toTokenResponse(json);
}

/** Refresh an expired access token. Throws on failure. */
export async function refreshAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
  fetchImpl: FetchImpl = fetch,
): Promise<TokenResponse> {
  const json = await postForm(url_token(), {
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
  }, fetchImpl, 'Token refresh');
  return toTokenResponse(json);
}

function url_token(): string {
  return TOKEN_URL;
}

function toTokenResponse(json: Record<string, unknown>): TokenResponse {
  return {
    access_token: json.access_token as string,
    expires_in: json.expires_in as number,
    refresh_token: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
    scope: typeof json.scope === 'string' ? json.scope : undefined,
    token_type: typeof json.token_type === 'string' ? json.token_type : undefined,
  };
}

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  accessRole?: string;
  primary?: boolean;
  backgroundColor?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function apiError(what: string, status: number): Error {
  return Object.assign(new Error(`${what} failed with HTTP ${status}`), {
    googleApiError: { code: status, message: `${what} failed with HTTP ${status}` } as GoogleApiError,
  });
}

/** List calendars the account can access. Throws on failure. */
export async function listCalendars(
  accessToken: string,
  fetchImpl: FetchImpl = fetch,
): Promise<GoogleCalendarListEntry[]> {
  const res = await fetchImpl(`${GOOGLE_API_BASE}/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw apiError('Calendar list', res.status);
  const json = (await res.json()) as Record<string, unknown>;
  const items = Array.isArray(json.items) ? json.items : [];
  const out: GoogleCalendarListEntry[] = [];
  for (const item of items) {
    if (!isRecord(item) || typeof item.id !== 'string') continue;
    out.push({
      id: item.id,
      summary: typeof item.summary === 'string' ? item.summary : item.id,
      accessRole: typeof item.accessRole === 'string' ? item.accessRole : undefined,
      primary: item.primary === true,
      backgroundColor: typeof item.backgroundColor === 'string' ? item.backgroundColor : undefined,
    });
  }
  return out;
}

/** Account email via the `email` scope. Undefined when unavailable. */
export async function fetchAccountEmail(
  accessToken: string,
  fetchImpl: FetchImpl = fetch,
): Promise<string | undefined> {
  const res = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return undefined;
  try {
    const json = (await res.json()) as Record<string, unknown>;
    return typeof json.email === 'string' ? json.email : undefined;
  } catch {
    return undefined;
  }
}

/** Raw event shape returned by `events.list` (single definition in `googleTypes`). */

/** One page of `events.list`. */
export async function listEventsPage(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
  pageToken: string | undefined,
  fetchImpl: FetchImpl = fetch,
): Promise<{ items: GoogleApiEvent[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  if (pageToken) params.set('pageToken', pageToken);
  const res = await fetchImpl(
    `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw apiError('Events list', res.status);
  const json = (await res.json()) as Record<string, unknown>;
  const items = Array.isArray(json.items) ? (json.items as GoogleApiEvent[]) : [];
  const next = typeof json.nextPageToken === 'string' ? json.nextPageToken : undefined;
  return { items, nextPageToken: next };
}

/** All pages of `events.list` for one calendar (bounded at 20 pages). */
export async function listAllEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
  fetchImpl: FetchImpl = fetch,
): Promise<GoogleApiEvent[]> {
  const all: GoogleApiEvent[] = [];
  let page: string | undefined;
  for (let i = 0; i < 20; i++) {
    const { items, nextPageToken } = await listEventsPage(
      accessToken, calendarId, timeMin, timeMax, page, fetchImpl,
    );
    all.push(...items);
    if (!nextPageToken) break;
    page = nextPageToken;
  }
  return all;
}

/** True for 401/403 — the caller should refresh and retry once. */
export function isAuthError(err: unknown): boolean {
  const code = (err as { googleApiError?: GoogleApiError })?.googleApiError?.code;
  return code === 401 || code === 403;
}

export interface LocalEventInput {
  /**
   * Local event id. When given, the created Google event is stamped with this
   * app's private push tag so it can never be mistaken for a foreign event.
   */
  id?: string;
  title: string;
  description?: string;
  start: string;
  end: string;
}

/**
 * Normalize an ISO date-time for comparisons; falls back to the raw string.
 * (Shared with the push engine so signatures survive `Z` vs `.000Z`.)
 */
export function eventInstant(iso: string): string {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? iso : new Date(t).toISOString();
}

/** Local event → Google `events` resource body. */
export function toGoogleEventBody(input: LocalEventInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: input.title,
    start: { dateTime: eventInstant(input.start) },
    end: { dateTime: eventInstant(input.end) },
  };
  if (input.description) body.description = input.description;
  if (input.id) body.extendedProperties = { private: pushTag(input.id) };
  return body;
}

/** Create an event. Returns the Google event id. */
export async function createGoogleEvent(
  accessToken: string,
  calendarId: string,
  body: Record<string, unknown>,
  fetchImpl: FetchImpl = fetch,
): Promise<string> {
  const res = await fetchImpl(
    `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw apiError('Event create', res.status);
  const json = (await res.json()) as Record<string, unknown>;
  if (typeof json.id !== 'string') throw new Error('Event create returned no id');
  return json.id;
}

/** Update an event. */
export async function updateGoogleEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: Record<string, unknown>,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  const res = await fetchImpl(
    `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw apiError('Event update', res.status);
}

/** Delete an event (404/410 = already gone, not an error). */
export async function deleteGoogleEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  const res = await fetchImpl(
    `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw apiError('Event delete', res.status);
  }
}

/** Revoke a token (best-effort on disconnect). Never throws. */
export async function revokeToken(token: string, fetchImpl: FetchImpl = fetch): Promise<void> {
  try {
    await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch {
    /* best-effort */
  }
}


