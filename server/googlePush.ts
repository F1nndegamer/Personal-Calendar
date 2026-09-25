/**
 * Google Calendar push engine (app → Google), server-side.
 *
 * Diffs the complete desired set of local events against the persisted
 * `pushed` mapping and applies the minimal set of Calendar API calls:
 *
 *   - new event            → events.insert   (recorded in the mapping)
 *   - changed content      → events.patch
 *   - changed target cal   → insert in the new calendar + delete the old copy
 *   - removed by the user  → events.delete   (mapping entry removed)
 *   - unchanged content    → skipped (no API call)
 *
 * Semantics:
 *   - The incoming list is authoritative: a mapped event missing from it is
 *     deleted on Google. The browser only pushes after a successful sync or
 *     an event edit, so removals mirror correctly.
 *   - Per-event failures are collected, never fatal — the mapping keeps the
 *     successful entries so the next push retries only what is missing.
 *   - 401 aborts the run (the route refreshes the token and retries once);
 *     429 backs off once and then records the failure.
 *   - Work runs in small batches so first-time pushes (hundreds of creates)
 *     stay comfortably under proxy timeouts.
 */
import type { GooglePushEvent, GooglePushResponse } from './googleTypes.js';
import {
  createGoogleEvent,
  deleteGoogleEvent,
  toGoogleEventBody,
  updateGoogleEvent,
  type FetchImpl,
} from './googleOAuth.js';
import type { PushedEventMap } from './googleStore.js';

/** Hard cap for one push request (also bounded by the route's body limit). */
export const MAX_PUSH_EVENTS = 2000;

/** Parallelism for push operations (creates/updates/deletes). */
const BATCH_SIZE = 3;

/** FNV-1a 32-bit content key — compares old vs. new pushed content. */
export function contentKey(ev: GooglePushEvent): string {
  const s = `${ev.title}\u0000${ev.start}\u0000${ev.end}\u0000${ev.description ?? ''}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

export type ParsePushResult =
  | { ok: true; events: GooglePushEvent[] }
  | { ok: false; error: string };

/**
 * Validate a `POST /api/google/push` body. Returns the normalized event
 * list (trimmed, capped) or a human-readable error for a 400 response.
 */
export function parsePushBody(parsed: unknown): ParsePushResult {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Body must be a JSON object' };
  }
  const events = (parsed as { events?: unknown }).events;
  if (!Array.isArray(events)) return { ok: false, error: 'events must be an array' };
  if (events.length > MAX_PUSH_EVENTS) {
    return { ok: false, error: `events must contain at most ${MAX_PUSH_EVENTS} items` };
  }
  const out: GooglePushEvent[] = [];
  for (const raw of events) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { ok: false, error: 'each event must be an object' };
    }
    const e = raw as Record<string, unknown>;
    if (typeof e.id !== 'string' || e.id.trim().length === 0 || e.id.length > 512) {
      return { ok: false, error: 'each event needs a non-empty id (≤512 chars)' };
    }
    if (typeof e.title !== 'string' || e.title.trim().length === 0) {
      return { ok: false, error: `event ${e.id}: title is required` };
    }
    if (
      typeof e.start !== 'string' || typeof e.end !== 'string' ||
      Number.isNaN(Date.parse(e.start)) || Number.isNaN(Date.parse(e.end))
    ) {
      return { ok: false, error: `event ${e.id}: start/end must be ISO date-times` };
    }
    const event: GooglePushEvent = {
      id: e.id,
      title: e.title.trim().slice(0, 500),
      start: e.start,
      end: e.end,
    };
    if (typeof e.description === 'string' && e.description.trim().length > 0) {
      event.description = e.description.slice(0, 2000);
    }
    out.push(event);
  }
  return { ok: true, events: out };
}

export interface SyncPushInput {
  accessToken: string;
  /** Target calendar for events not pushed yet (and for moves). */
  calendarId: string;
  /** Complete desired state of local (non-Google) events. */
  events: GooglePushEvent[];
  /** Persisted mapping from the previous push (copy-on-write). */
  pushed: PushedEventMap;
  fetchImpl: FetchImpl;
  /** Injectable for tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

export interface PushStats {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  errors: { id: string; error: string }[];
}

export interface SyncPushResult {
  pushed: PushedEventMap;
  stats: PushStats;
}

function apiErrorCode(err: unknown): number | undefined {
  return (err as { googleApiError?: { code?: number } })?.googleApiError?.code;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Google request failed';
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run one op; on 429 (rate limit) back off and retry once, then record the
 * failure. 401 propagates so the caller can refresh the token and retry the
 * whole run. All other errors are recorded per-event and never fatal.
 */
async function runOp(
  op: () => Promise<void>,
  id: string,
  stats: PushStats,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await op();
      return true;
    } catch (err) {
      const code = apiErrorCode(err);
      if (code === 401) throw err;
      if (code === 429 && attempt === 0) {
        await sleep(2000);
        continue;
      }
      stats.errors.push({ id, error: errorMessage(err) });
      return false;
    }
  }
  return false;
}

/**
 * Apply the desired event state to Google. Returns the updated mapping.
 * Throws only on 401 (token expired mid-run).
 */
export async function syncPushedEvents(input: SyncPushInput): Promise<SyncPushResult> {
  const sleep = input.sleep ?? defaultSleep;
  const next: PushedEventMap = { ...input.pushed };
  const stats: PushStats = { created: 0, updated: 0, deleted: 0, skipped: 0, errors: [] };
  const incoming = new Set(input.events.map((e) => e.id));

  // ---- creates / updates / moves, in small batches --------------------
  for (let i = 0; i < input.events.length; i += BATCH_SIZE) {
    const batch = input.events.slice(i, i + BATCH_SIZE);
    const outcomes = await Promise.allSettled(
      batch.map(async (ev) => {
        const key = contentKey(ev);
        const existing = next[ev.id];

        if (existing) {
          const needsMove = existing.calendarId !== input.calendarId;
          if (!needsMove && existing.key === key) {
            stats.skipped++;
            return;
          }
          if (needsMove) {
            // Target calendar changed: create the copy in the new calendar,
            // then best-effort remove the old one.
            const created = await runOp(async () => {
              const eventId = await createGoogleEvent(
                input.accessToken, input.calendarId, toGoogleEventBody(ev), input.fetchImpl,
              );
              next[ev.id] = { calendarId: input.calendarId, eventId, key };
            }, ev.id, stats, sleep);
            if (created) {
              // A move counts as one create (new copy) + one delete (old copy).
              stats.created++;
              const gone = await runOp(
                () => deleteGoogleEvent(input.accessToken, existing.calendarId, existing.eventId, input.fetchImpl),
                ev.id, stats, sleep,
              );
              if (gone) stats.deleted++;
            }
            return;
          }
          const updated = await runOp(
            () => updateGoogleEvent(
              input.accessToken, existing.calendarId, existing.eventId,
              toGoogleEventBody(ev), input.fetchImpl,
            ),
            ev.id, stats, sleep,
          );
          if (updated) {
            next[ev.id] = { ...existing, key };
            stats.updated++;
            return;
          }
          // A 404 (event deleted in Google's UI) was recorded by runOp —
          // drop the stale entry so the next push recreates it fresh.
          if (stats.errors.some((e) => e.id === ev.id && /404/.test(e.error))) {
            delete next[ev.id];
          }
          return;
        }

        const created = await runOp(async () => {
          const eventId = await createGoogleEvent(
            input.accessToken, input.calendarId, toGoogleEventBody(ev), input.fetchImpl,
          );
          next[ev.id] = { calendarId: input.calendarId, eventId, key };
        }, ev.id, stats, sleep);
        if (created) stats.created++;
      }),
    );
    // Fail fast when the token expired mid-run (the route refreshes + retries).
    for (const o of outcomes) {
      if (o.status === 'rejected') throw o.reason;
    }
  }

  // ---- deletions: mapped events no longer in the desired state --------
  const toDelete = Object.entries(input.pushed).filter(([id]) => !incoming.has(id));
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = toDelete.slice(i, i + BATCH_SIZE);
    const outcomes = await Promise.allSettled(
      batch.map(async ([id, entry]) => {
        const deleted = await runOp(
          () => deleteGoogleEvent(input.accessToken, entry.calendarId, entry.eventId, input.fetchImpl),
          id, stats, sleep,
        );
        if (deleted) {
          delete next[id];
          stats.deleted++;
        }
      }),
    );
    for (const o of outcomes) {
      if (o.status === 'rejected') throw o.reason;
    }
  }

  return { pushed: next, stats };
}

/** Human-readable summary for `lastPushError` (undefined when all worked). */
export function pushErrorSummary(stats: PushStats): string | undefined {
  if (stats.errors.length === 0) return undefined;
  const first = stats.errors[0].error;
  return stats.errors.length === 1
    ? `Push failed for 1 event: ${first}`
    : `Push failed for ${stats.errors.length} events: ${first}`;
}

/** Build the HTTP response body for a push run. */
export function pushResponse(stats: PushStats): GooglePushResponse {
  return {
    ok: stats.errors.length === 0,
    created: stats.created,
    updated: stats.updated,
    deleted: stats.deleted,
    skipped: stats.skipped,
    errors: stats.errors,
  };
}


