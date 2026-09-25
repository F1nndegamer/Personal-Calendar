/**
 * Push (app → Google) client helpers.
 *
 * Talks to the same-origin `/api/google/push*` endpoints only — OAuth
 * tokens stay server-side. The payload is the complete set of local
 * (non-Google) events; the server diffs it against the mapping stored on
 * the last push, so calling this repeatedly is safe and idempotent.
 */
import type { CalendarEvent } from '../calendar/types';
import type { GooglePushEvent, GooglePushResponse } from '../../server/googleTypes';

/** Matches `createGoogleProvider().id` in googleProvider.ts. */
const GOOGLE_PROVIDER_PREFIX = 'google:';

/**
 * Events that should be mirrored to Google: everything EXCEPT events that
 * came FROM Google (pushing those back would duplicate them). Covers manual
 * events (source 'local'/undefined) and other providers such as Magister.
 */
export function collectPushEvents(events: readonly CalendarEvent[]): GooglePushEvent[] {
  const out: GooglePushEvent[] = [];
  for (const ev of events) {
    if (
      ev.source === 'external' &&
      typeof ev.externalId === 'string' &&
      ev.externalId.startsWith(GOOGLE_PROVIDER_PREFIX)
    ) {
      continue;
    }
    out.push({
      id: ev.id,
      title: ev.title.trim() || 'Untitled event',
      start: ev.start,
      end: ev.end,
      ...(ev.description ? { description: ev.description } : {}),
    });
  }
  return out;
}

export interface GooglePushOutcome {
  ok: boolean;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  /** Human-readable failure (HTTP error, network failure, …). */
  error?: string;
  /** Server was busy with another push — not an error, just skip. */
  busy?: boolean;
}

/** First pushes can create hundreds of events — keep well under proxy limits. */
const PUSH_TIMEOUT_MS = 60_000;

/**
 * POST the full local event set to `/api/google/push`. Never throws —
 * failures come back as `ok: false` + `error` so callers can toast them.
 */
export async function pushToGoogle(
  events: GooglePushEvent[],
  fetchImpl: typeof fetch = fetch,
): Promise<GooglePushOutcome> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    const res = await fetchImpl('/api/google/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ events }),
      signal: controller.signal,
    });
    // 429 = another tab/device is already pushing (server single-flight).
    if (res.status === 429) {
      return { ok: true, created: 0, updated: 0, deleted: 0, skipped: 0, busy: true };
    }
    let parsed: GooglePushResponse | null = null;
    try {
      parsed = (await res.json()) as GooglePushResponse;
    } catch {
      // fall through to the HTTP-status error below
    }
    if (!res.ok || !parsed) {
      return {
        ok: false, created: 0, updated: 0, deleted: 0, skipped: 0,
        error: parsed?.error ?? `HTTP ${res.status}`,
      };
    }
    return {
      ok: parsed.ok,
      created: parsed.created,
      updated: parsed.updated,
      deleted: parsed.deleted,
      skipped: parsed.skipped,
      error: parsed.ok
        ? undefined
        : parsed.errors?.[0]?.error ?? parsed.error ?? 'Some events failed to push',
    };
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.name));
    return {
      ok: false, created: 0, updated: 0, deleted: 0, skipped: 0,
      error: isTimeout
        ? 'Push timed out — Google did not respond in time'
        : err instanceof Error
          ? err.message
          : 'Failed to reach the server',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Choose the calendar pushes land in. Throws on failure (Settings shows it). */
export async function setPushTarget(
  calendarId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl('/api/google/push-target', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ calendarId }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // keep the HTTP status message
    }
    throw new Error(msg);
  }
}


