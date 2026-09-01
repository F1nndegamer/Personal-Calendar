import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarEvent } from '../calendar/types';
import { syncExternalEvents } from './sync';
import { getScheduleProviderInfo } from './index';

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
  const providerInfo = useRef(getScheduleProviderInfo());
  const runningRef = useRef(false);
  const startedRef = useRef(false);
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
  });

  const syncNow = useCallback(async (rangeOverride?: { from: Date; to: Date }) => {
    if (runningRef.current) return; // one sync at a time
    const provider = providerInfo.current.provider;
    if (!provider) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: 'No schedule provider configured',
      }));
      return;
    }
    runningRef.current = true;
    setState((s) => ({ ...s, status: 'syncing', errorMessage: undefined }));
    const opts = callbacksRef.current;
    const range = rangeOverride ?? opts.fetchRange();
    try {
      const result = await provider.fetchSchedule(range);
      if (result.error) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: result.error!.message,
        }));
        return;
      }
      const merged = syncExternalEvents(
        opts.getEvents(),
        result.events,
        result.providerId,
        result.fetchedAt,
      ).events;
      opts.commitEvents(merged);
      opts.persist(merged);
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
      setState({
        status: 'success',
        lastSyncAt: result.fetchedAt,
        errorMessage: undefined,
        // Report the cumulative union range so the useEffect in App can
        // correctly detect when the visible range has grown beyond what
        // was previously reported — and trigger a fresh syncIfNeeded.
        syncedFrom: prev ? Math.min(prev.from, from) : from,
        syncedTo: prev ? Math.max(prev.to, to) : to,
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
    if (!providerInfo.current.configured) return;
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
    if (options.autoSyncOnStart !== false && providerInfo.current.configured) {
      void syncNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, syncNow, syncIfNeeded, configured: providerInfo.current.configured };
}
