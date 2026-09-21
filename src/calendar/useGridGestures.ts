import { useCallback, useEffect, useRef } from 'react';
import { isTap, swipeDirection, type Point } from './lib';

/** A gesture that has gone down but not yet resolved into a tap or a swipe. */
interface PendingGesture {
  pointerId: number;
  start: Point;
  startedAt: number;
  /** The day column the gesture began on — the tap's target. */
  day: Date;
  /** Touch and pen can swipe; a mouse drag would be a surprising navigation. */
  canSwipe: boolean;
}

export interface GridGestureOptions {
  /**
   * A deliberate tap on empty grid space. Receives the day column it landed on
   * and the pointer's final viewport Y, so the caller can map that to a time.
   */
  onTap: (day: Date, clientY: number) => void;
  /** A horizontal swipe: `1` advances, `-1` goes back. Omit to disable. */
  onSwipe?: (direction: -1 | 1) => void;
}

/**
 * Pointer gestures for the time grid.
 *
 * The grid must never create an event from the *start* of a touch: on a phone
 * every scroll attempt would spawn a blank event dialog. Instead the gesture is
 * resolved when the pointer is released:
 *
 *   - `pointercancel` (the browser claimed the gesture for panning) → ignored
 *   - held still within `TAP_SLOP_PX` for under `TAP_MAX_MS`        → tap
 *   - travelled far enough horizontally                             → swipe
 *   - anything else (a scroll, a drag, a long-press)                → ignored
 *
 * Callbacks live in refs so the window listeners never need re-binding when the
 * caller passes fresh closures on each render.
 */
export function useGridGestures({ onTap, onSwipe }: GridGestureOptions) {
  const tapRef = useRef(onTap);
  const swipeRef = useRef(onSwipe);
  useEffect(() => {
    tapRef.current = onTap;
    swipeRef.current = onSwipe;
  });

  const pendingRef = useRef<PendingGesture | null>(null);

  /** Wire to the grid's `onPointerDown`, from a day column. */
  const startGesture = useCallback((day: Date, e: React.PointerEvent) => {
    // Only the primary button (or a touch/pen contact) starts a gesture.
    if (e.button !== 0) return;
    // A gesture starting on an event block belongs to that block — dragging,
    // resizing, or opening it — and must never become a new-event tap.
    if ((e.target as Element | null)?.closest?.('.event-block')) return;
    // A second contact means a pinch/zoom, so abandon the pending gesture.
    if (pendingRef.current) {
      pendingRef.current = null;
      return;
    }
    pendingRef.current = {
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      startedAt: Date.now(),
      day,
      canSwipe: e.pointerType !== 'mouse',
    };
  }, []);

  useEffect(() => {
    const onUp = (e: PointerEvent) => {
      const gesture = pendingRef.current;
      pendingRef.current = null;
      if (!gesture || gesture.pointerId !== e.pointerId) return;

      const end: Point = { x: e.clientX, y: e.clientY };
      const duration = Date.now() - gesture.startedAt;

      if (isTap(gesture.start, end, duration)) {
        tapRef.current(gesture.day, e.clientY);
        return;
      }
      const direction = swipeDirection(gesture.start, end);
      if (direction !== 0 && gesture.canSwipe) swipeRef.current?.(direction);
    };

    // The browser takes the gesture over to scroll — not a tap, not a swipe.
    const onCancel = () => {
      pendingRef.current = null;
    };

    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, []);

  return { startGesture };
}
