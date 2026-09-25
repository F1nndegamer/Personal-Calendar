import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarEvent } from '../calendar/types';
import { syncExternalEvents } from './sync';
import { GOOGLE_PROVIDER_ID, withoutDuplicateMirrors } from './duplicates';
import {
  getScheduleProvidersInfo,
  refreshGoogleAvailability,
} from './index';
import type { ExternalFetchResult } from './types';

/**
 * Schedule-sync orchestration, kept out of the UI layer.
 *
 * Flow per sync:
 *   fetch visible range → normalize → syncExternalEvents() → commit events
 *   → persist (via the existing storage layer)
 *
 * Guarantees:
 * - never runs two syncs simultaneously
 * - performs at most one automatic sync on startup, and only when a real
 *   feed is configured (the mock provider is never auto-synced)
 * - sync state lives here, fully separate from calendar event state
 * - the synced range only ever grows: navigating forward extends coverage,
 *   navigating backward never shrinks it (so previously imported events
 *   are never dropped from a range that was already fetched)
 */

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

export interface SyncState {
  status: SyncStatus;
  /** ISO timestamp of the last *successful* sync */
  lastSyncAt: string | undefined;
  /** Present only when status === 'error' */
  errorMessage: string | undefined;
  /** Start of the last successfully synced range (epoch ms), or null */
  syncedFrom: number | null;
  /** End of the last successfully synced range (epoch ms), or null */
  syncedTo: number | null;
  /** Earliest event the feed itself contained (epoch ms), or null */
  coverageFrom: number | null;
  /** Latest event the feed itself contained (epoch ms), or null */
  coverageTo: number | null;
  /** Number of events the feed itself contained, or null */
  coverageCount: number | null;
}

export interface UseScheduleSyncOptions {
  /** Reads the current event list for merging */
  getEvents: () => CalendarEvent[];
  /** Commits the merged event list to application state */
  commitEvents: (events: CalendarEvent[]) => void;
  /** Persists the merged list via the existing storage layer */
  persist: (events: CalendarEvent[]) => void;
  /** The currently visible calendar date range */
  fetchRange: () => { from: Date; to: Date };
  /** Perform one sync automatically on startup (default: true) */
  autoSyncOnStart?: boolean;
}

export interface ScheduleSync {
  state: SyncState;
  /** Sync the full current `fetchRange()`. */
  syncNow: (rangeOverride?: { from: Date; to: Date }) => Promise<void>;
  /** Sync only if the visible range extends beyond what's already synced. */
  syncIfNeeded: () => Promise<void>;
  /** Whether a real feed is configured (vs. the mock fallback provider) */
  configured: boolean;
}

export function useScheduleSync(options: UseScheduleSyncOptions): ScheduleSync {
  const startedRef = useRef(false);
  const runningRef = useRef(false);
  // Tracks which provider ids have ever contributed, so syncExternalEvents()
  // can prune per provider without one provider wiping another's events.
  const syncedRef = useRef<Set<string>>(new Set());
  const syncedRangeRef = useRef<{ from: number; to: number } | null>(null);

  // keep latest callbacks without re-triggering the startup effect
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const [state, setState] = useState<SyncState>({
    status: 'idle',
    lastSyncAt: undefined,
    errorMessage: undefined,
    syncedFrom: null,
    syncedTo: null,
    coverageFrom: null,
    coverageTo: null,
    coverageCount: null,
  });

  const syncNow = useCallback(async (rangeOverride?: { from: Date; to: Date }) => {
    if (runningRef.current) return; // one sync at a time
    runningRef.current = true;
    setState((s) => ({ ...s, status: 'syncing', errorMessage: undefined }));
    const opts = callbacksRef.current;
    const range = rangeOverride ?? opts.fetchRange();
    try {
      // Settle the Google availability probe first so a connected account
      // takes part in this very sync (a no-op once the cache is filled).
      await refreshGoogleAvailability();
      const providers = getScheduleProvidersInfo().providers;
      if (providers.length === 0) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: 'No schedule provider configured',
        }));
        return;
      }
      const results: ExternalFetchResult[] = [];
      for (const provider of providers) {
        results.push(await provider.fetchSchedule(range));
      }
      const succeeded = results.filter((r) => !r.error);
      const failed = results.filter((r) => r.error);
      if (succeeded.length === 0) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: failed[0]?.error?.message ?? 'Synchronization failed',
        }));
        return;
      }
      // Merge each provider separately: syncExternalEvents() only prunes
      // events carrying its own `<providerId>:` prefix, so a provider that
      // failed this round keeps everything it synced before.
      let merged = opts.getEvents();
      // Every provider's payload is already in hand, so Google imports that
      // merely mirror a local/Magister event (a copy of our own pushed data)
      // can be dropped instead of being imported as a duplicate.
      const nonGoogleEvents = succeeded
        .filter((r) => r.providerId !== GOOGLE_PROVIDER_ID)
        .flatMap((r) => r.events);
      let fetchedAt = succeeded[0].fetchedAt;
      for (const r of succeeded) {
        if (new Date(r.fetchedAt).getTime() > new Date(fetchedAt).getTime()) {
          fetchedAt = r.fetchedAt;
        }
        syncedRef.current.add(r.providerId);
        const incoming = r.providerId === GOOGLE_PROVIDER_ID
          ? withoutDuplicateMirrors(merged, r.events, nonGoogleEvents)
          : r.events;
        merged = syncExternalEvents(merged, incoming, r.providerId, r.fetchedAt).events;
      }
      opts.commitEvents(merged);
      opts.persist(merged);
      const allExternal = succeeded.flatMap((r) => r.events);
      // Report what the *feed itself* contained (not the requested range).
      // Sources like Magister only publish a rolling few-week window, so the
      // feed's coverage can be far narrower than what was asked for — the UI
      // surfaces this so a "missing" far-future event is never mysterious.
      let coverageFrom: number | null = null;
      let coverageTo: number | null = null;
      for (const ext of allExternal) {
        const s = new Date(ext.start).getTime();
        const e = new Date(ext.end).getTime();
        if (coverageFrom === null || s < coverageFrom) coverageFrom = s;
        if (coverageTo === null || e > coverageTo) coverageTo = e;
      }
      const from = range.from.getTime();
      const to = range.to.getTime();
      // Expand the tracked range to cover the union of all fetches ever made.
      // This ensures that previously-imported events are never accidentally
      // dropped when navigating forward past the original 30-day window —
      // syncExternalEvents() removes any external event not present in the
      // latest incoming list, so we must always include the previously
      // synced window in the new fetch.
      const prev = syncedRangeRef.current;
      syncedRangeRef.current = {
        from: prev ? Math.min(prev.from, from) : from,
        to: prev ? Math.max(prev.to, to) : to,
      };
      const failedNames = failed
        .map((r) => providers.find((p) => p.id === r.providerId)?.displayName ?? r.providerId)
        .join(', ');
      setState({
        status: failed.length > 0 ? 'error' : 'success',
        lastSyncAt: fetchedAt,
        errorMessage:
          failed.length > 0
            ? `${failedNames} sync failed: ${failed[0].error?.message ?? 'unknown error'}`
            : undefined,
        // Report the cumulative union range so the useEffect in App can
        // correctly detect when the visible range has grown beyond what
        // was previously reported — and trigger a fresh syncIfNeeded.
        syncedFrom: prev ? Math.min(prev.from, from) : from,
        syncedTo: prev ? Math.max(prev.to, to) : to,
        coverageFrom,
        coverageTo,
        coverageCount: allExternal.length,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Synchronization failed',
      }));
    } finally {
      runningRef.current = false;
    }
  }, []);

  /**
   * Sync only when the visible range extends beyond the synced range.
   * The union of both ranges is fetched so previously imported events are
   * never dropped.
   */
  const syncIfNeeded = useCallback(async () => {
    if (runningRef.current) return;
    if (!getScheduleProvidersInfo().configured) return;
    const range = callbacksRef.current.fetchRange();
    const rangeFrom = range.from.getTime();
    const rangeTo = range.to.getTime();
    const synced = syncedRangeRef.current;
    if (synced === null) {
      await syncNow();
      return;
    }
    if (rangeTo > synced.to || rangeFrom < synced.from) {
      await syncNow({
        from: new Date(Math.min(synced.from, rangeFrom)),
        to: new Date(Math.max(synced.to, rangeTo)),
      });
    }
  }, [syncNow]);

  // one automatic sync on startup — only when a real feed is configured
  useEffect(() => {
    if (startedRef.current) return; // StrictMode-safe
    startedRef.current = true;
    if (options.autoSyncOnStart !== false) {
      void (async () => {
        // Probe Google first: without it a Google-only setup reports
        // `configured === false` and would never auto-sync.
        await refreshGoogleAvailability();
        if (getScheduleProvidersInfo().configured) void syncNow();
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, syncNow, syncIfNeeded, configured: getScheduleProvidersInfo().configured };
}
