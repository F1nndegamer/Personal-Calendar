import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarEvent } from '../calendar/types';
import type { Task } from '../tasks/types';
import { refreshGoogleAvailability } from './index';
import { collectPushPayload, pushToGoogle } from './googlePush';

/**
 * Auto-push orchestration (app → Google).
 *
 * Pushes the complete local (non-Google) event set plus the user's tasks
 * whenever either changes and once shortly after page load (so a fresh setup
 * still reaches Google even without a schedule sync). The server diffs the
 * payload, so pushes are cheap no-ops when nothing changed.
 *
 * Guarantees:
 * - never two pushes in flight from this tab (pending runs coalesce)
 * - silent no-op when Google is not connected (cached availability probe)
 * - schedulePush() is debounced and safe to call on every event/task change
 * - state is fully separate from schedule-sync state
 */

export interface GooglePushState {
  status: 'idle' | 'pushing' | 'success' | 'error';
  /** Present only when status === 'error' */
  errorMessage: string | undefined;
  /** ISO timestamp of the last successful push, or undefined */
  lastPushAt: string | undefined;
  /** Counts from the last completed push */
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
}

export interface UseGooglePushOptions {
  /** Reads the current event list (latest committed value) */
  getEvents: () => CalendarEvent[];
  /** Reads the current task list (latest committed value) */
  getTasks?: () => Task[];
}

export interface GooglePush {
  state: GooglePushState;
  /** Push now. No-op while running or when Google is unavailable. */
  pushNow: () => Promise<void>;
  /** Debounced push — safe to call on every event change. */
  schedulePush: (delayMs?: number) => void;
}

/** Delay before the one kickoff push after mount. */
const INITIAL_DELAY_MS = 2500;
/** Default debounce for schedulePush(). */
const DEFAULT_DEBOUNCE_MS = 1200;
/** Re-queued work after a push was skipped because one was already running. */
const RERUN_DELAY_MS = 1500;

export function useGooglePush(options: UseGooglePushOptions): GooglePush {
  const runningRef = useRef(false);
  const pendingRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const startedRef = useRef(false);

  // Latest accessor + push entry point. Both are refreshed by an effect
  // (never during render) so the startup effect and the debounced timer
  // cannot run stale closures.
  const callbacksRef = useRef(options);
  const pushNowRef = useRef<() => Promise<void>>(async () => {});

  const [state, setState] = useState<GooglePushState>({
    status: 'idle',
    errorMessage: undefined,
    lastPushAt: undefined,
    created: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
  });

  const schedulePush = useCallback((delayMs?: number) => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(
      () => void pushNowRef.current(),
      delayMs ?? DEFAULT_DEBOUNCE_MS,
    );
  }, []);

  const pushNow = useCallback(async () => {
    if (runningRef.current) {
      pendingRef.current = true;
      return;
    }
    window.clearTimeout(timerRef.current);
    // Skip silently when Google is not connected (probe caches per page).
    const available = await refreshGoogleAvailability();
    if (!available) return;
    const events = collectPushPayload(
      callbacksRef.current.getEvents(),
      callbacksRef.current.getTasks?.() ?? [],
    );
    runningRef.current = true;
    setState((s) => ({ ...s, status: 'pushing' }));
    try {
      const outcome = await pushToGoogle(events);
      if (outcome.busy) {
        // Another tab/device is pushing the same state — nothing to do.
        setState((s) => ({ ...s, status: 'idle' }));
        return;
      }
      if (outcome.ok) {
        setState({
          status: 'success',
          errorMessage: undefined,
          lastPushAt: new Date().toISOString(),
          created: outcome.created,
          updated: outcome.updated,
          deleted: outcome.deleted,
          skipped: outcome.skipped,
        });
      } else {
        setState((s) => ({ ...s, status: 'error', errorMessage: outcome.error ?? 'Push failed' }));
      }
    } finally {
      runningRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        schedulePush(RERUN_DELAY_MS);
      }
    }
  }, [schedulePush]);

  // Refresh the refs after every commit (refs must not be written in render).
  useEffect(() => {
    callbacksRef.current = options;
    pushNowRef.current = pushNow;
  });

  // One deferred kickoff push shortly after mount — covers a fresh setup
  // (empty server mapping) even when no schedule sync will run.
  useEffect(() => {
    if (startedRef.current) return; // StrictMode-safe
    startedRef.current = true;
    schedulePush(INITIAL_DELAY_MS);
    return () => window.clearTimeout(timerRef.current);
  }, [schedulePush]);

  return { state, pushNow, schedulePush };
}
