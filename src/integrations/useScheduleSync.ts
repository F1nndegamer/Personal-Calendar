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
 */

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

export interface SyncState {
  status: SyncStatus;
  /** ISO timestamp of the last *successful* sync */
  lastSyncAt: string | undefined;
  /** Present only when status === 'error' */
  errorMessage: string | undefined;
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
  syncNow: () => Promise<void>;
  /** Whether a real feed is configured (vs. the mock fallback provider) */
  configured: boolean;
}

export function useScheduleSync(options: UseScheduleSyncOptions): ScheduleSync {
  const providerInfo = useRef(getScheduleProviderInfo());
  const runningRef = useRef(false);
  const startedRef = useRef(false);

  // keep latest callbacks without re-triggering the startup effect
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const [state, setState] = useState<SyncState>({
    status: 'idle',
    lastSyncAt: undefined,
    errorMessage: undefined,
  });

  const syncNow = useCallback(async () => {
    if (runningRef.current) return; // one sync at a time
    runningRef.current = true;
    setState((s) => ({ ...s, status: 'syncing', errorMessage: undefined }));
    const opts = callbacksRef.current;
    try {
      const result = await providerInfo.current.provider.fetchSchedule(opts.fetchRange());
      if (result.error) {
        setState((prev) => ({
          status: 'error',
          lastSyncAt: prev.lastSyncAt,
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
      setState({ status: 'success', lastSyncAt: result.fetchedAt, errorMessage: undefined });
    } catch (err) {
      setState((prev) => ({
        status: 'error',
        lastSyncAt: prev.lastSyncAt,
        errorMessage: err instanceof Error ? err.message : 'Synchronization failed',
      }));
    } finally {
      runningRef.current = false;
    }
  }, []);

  // one automatic sync on startup — only when a real feed is configured
  useEffect(() => {
    if (startedRef.current) return; // StrictMode-safe
    startedRef.current = true;
    if (options.autoSyncOnStart !== false && providerInfo.current.configured) {
      void syncNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, syncNow, configured: providerInfo.current.configured };
}
