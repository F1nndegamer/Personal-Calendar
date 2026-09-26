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
import type { GoogleApiEvent, GooglePushEvent, GooglePushResponse } from './googleTypes.js';
import {
  createGoogleEvent,
  deleteGoogleEvent,
  eventInstant,
  listAllEvents,
  toGoogleEventBody,
  updateGoogleEvent,
  type FetchImpl,
} from './googleOAuth.js';
import { mapGoogleEventToExternal } from './googleApi.js';
import { isAllDayDate } from './googleTypes.js';
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
  /**
   * Called with the (in-progress) mapping after every batch that changed
   * something. A run that dies halfway — token expiry, dropped connection,
   * deploy restart — then keeps the copies it already made, so the retry
   * skips them instead of creating untracked duplicates on Google.
   */
  persist?: (pushed: PushedEventMap) => void;
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

  // Flush the mapping after every batch that actually changed something, so a
  // run that dies halfway never loses the copies it already created (a retry
  // would create them a second time — the origin of duplicated imports).
  const opsDone = () => stats.created + stats.updated + stats.deleted;
  const flushFrom = (before: number) => {
    if (stats.created + stats.updated + stats.deleted !== before) input.persist?.(next);
  };

  // ---- creates / updates / moves, in small batches --------------------
  for (let i = 0; i < input.events.length; i += BATCH_SIZE) {
    const before = opsDone();
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
    // Successful ops of this batch are durable before we rethrow (401 → the
    // route refreshes the token and retries the run; the retry then skips
    // everything already created instead of duplicating it).
    flushFrom(before);
    // Fail fast when the token expired mid-run (the route refreshes + retries).
    for (const o of outcomes) {
      if (o.status === 'rejected') throw o.reason;
    }
  }

  // ---- deletions: mapped events no longer in the desired state --------
  const toDelete = Object.entries(input.pushed).filter(([id]) => !incoming.has(id));
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const before = opsDone();
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
    flushFrom(before);
    for (const o of outcomes) {
      if (o.status === 'rejected') throw o.reason;
    }
  }

  return { pushed: next, stats };
}

/** All-day `YYYY-MM-DD` → the instant `mapGoogleEventToExternal` reports for it. */
function allDayInstant(date: string, isEnd: boolean): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return date;
  // An all-day end is exclusive; the importer rolls it over to the next day.
  return new Date(isEnd ? ms + 24 * 3_600_000 : ms).toISOString();
}

/** Instant a push payload's start/end has on the Google side of the mapping. */
function mirroredInstant(value: string, other: string, isEnd: boolean): string {
  return isAllDayDate(value) && isAllDayDate(other)
    ? allDayInstant(value, isEnd)
    : eventInstant(value);
}

/** Identity of an event's content, ignoring formatting/case differences. */
function contentSignature(
  title: string,
  start: string,
  end: string,
  description?: string,
): string {
  return [
    title.trim().toLowerCase(),
    mirroredInstant(start, end, false),
    mirroredInstant(end, start, true),
    (description ?? '').trim(),
  ].join('\u0000');
}

export interface SweepOwnCopiesInput {
  accessToken: string;
  /** Calendar pushes land in — never touched by the sweep. */
  pushCalendarId: string;
  /** Imported calendars to clean (the push target is skipped internally). */
  calendarIds: readonly string[];
  /** Complete local event set (the same payload that was pushed). */
  events: readonly GooglePushEvent[];
  /** Current mapping — evidence that a matching copy is ours. */
  pushed: PushedEventMap;
  fetchImpl?: FetchImpl;
}

export interface SweepOwnCopiesResult {
  deleted: number;
  errors: { id: string; error: string }[];
}

/**
 * Remove copies of local events that earlier pushes left behind in *other*
 * (imported) calendars: the fallback target used before one was chosen, a
 * target switch whose delete failed, or a run that died after creating events.
 * Such strays used to be imported again as duplicates of the event they mirror.
 *
 * Only copies that are provably ours are deleted:
 *   - events carrying this app's private push tag (`pushTag`), or
 *   - events whose content equals a local event AND whose local id is in the
 *     mapping (so a payload alone can never delete a foreign event).
 * The push target itself is never touched, and failures are collected rather
 * than thrown — the sweep is a repair, not part of the push contract.
 */
export async function sweepOwnCopies(
  input: SweepOwnCopiesInput,
): Promise<SweepOwnCopiesResult> {
  const result: SweepOwnCopiesResult = { deleted: 0, errors: [] };
  const calendars = input.calendarIds.filter((id) => id !== input.pushCalendarId);
  if (input.events.length === 0 || calendars.length === 0) return result;

  const bySignature = new Map<string, GooglePushEvent>();
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;
  for (const ev of input.events) {
    bySignature.set(contentSignature(ev.title, ev.start, ev.end, ev.description), ev);
    // An all-day end is exclusive, so widen the listing window to cover the
    // day the importer reports for it (see `allDayInstant`).
    minStart = Math.min(minStart, new Date(ev.start).getTime());
    maxEnd = Math.max(
      maxEnd,
      isAllDayDate(ev.end) && isAllDayDate(ev.start)
        ? new Date(allDayInstant(ev.end, true)).getTime()
        : new Date(ev.end).getTime(),
    );
  }
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) return result;
  const timeMin = new Date(minStart).toISOString();
  const timeMax = new Date(maxEnd).toISOString();

  for (const calendarId of calendars) {
    let raw: GoogleApiEvent[];
    try {
      raw = await listAllEvents(input.accessToken, calendarId, timeMin, timeMax, input.fetchImpl);
    } catch (err) {
      result.errors.push({ id: calendarId, error: errorMessage(err) });
      continue;
    }
    const strays: string[] = [];
    for (const event of raw) {
      const eventId = event.id;
      if (!eventId) continue;
      const mapped = mapGoogleEventToExternal(event, calendarId);
      if (!mapped) continue;
      if (mapped.ownCopy) {
        strays.push(eventId);
        continue;
      }
      const mirror = bySignature.get(
        contentSignature(mapped.subject, mapped.start, mapped.end, mapped.description),
      );
      if (mirror && Object.prototype.hasOwnProperty.call(input.pushed, mirror.id)) {
        strays.push(eventId);
      }
    }
    for (let i = 0; i < strays.length; i += BATCH_SIZE) {
      await Promise.all(
        strays.slice(i, i + BATCH_SIZE).map(async (eventId) => {
          try {
            await deleteGoogleEvent(input.accessToken, calendarId, eventId, input.fetchImpl);
            result.deleted += 1;
          } catch (err) {
            result.errors.push({ id: `${calendarId}:${eventId}`, error: errorMessage(err) });
          }
        }),
      );
    }
  }
  return result;
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
export function pushResponse(stats: PushStats, swept = 0): GooglePushResponse {
  return {
    ok: stats.errors.length === 0,
    created: stats.created,
    updated: stats.updated,
    deleted: stats.deleted,
    skipped: stats.skipped,
    ...(swept > 0 ? { swept } : {}),
    errors: stats.errors,
  };
}


