import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarEvent } from './types';
import { clamp, isSameDay, minutesFromDayStart, snapMinutes } from './lib';

export const DAY_MINUTES = 24 * 60;

export interface DragState {
  id: string;
  mode: 'move' | 'resize';
  startY: number;
  /** original event times in minutes since midnight */
  origStartMin: number;
  origEndMin: number;
  /** pointer position (in minutes) inside the event at grab time, so the
   *  block keeps its grab offset and stays exactly under the mouse */
  grabOffsetMin: number;
  moved: boolean;
  /** Touch only: timestamp before which the drag stays dormant. A flick
   *  releases the drag (the page scrolls instead); holding still past the
   *  timestamp activates it (long-press to drag). Mouse drags omit this. */
  activateAt?: number;
  /** pointer X at drag start — used to detect flicks during the dormant window */
  startX?: number;
}

export interface DraftTimes {
  startMin: number;
  endMin: number;
  dayOffset: number;
}

/**
 * Handles vertical drag / horizontal day drag / resize for events.
 * Reports a snapped preview `draft` while dragging and commits on pointer up.
 */
export function useEventDrag(options: {
  dayRectsRef: React.RefObject<(HTMLElement | null)[]>;
  bodyRectRef: React.RefObject<HTMLElement | null>;
  events: CalendarEvent[];
  onEventChange: (id: string, start: Date, end: Date) => void;
}) {
  const { dayRectsRef, bodyRectRef, events, onEventChange } = options;
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draft, setDraft] = useState<DraftTimes | null>(null);
  const movedRef = useRef(false);

  useEffect(() => {
    if (!drag) return;
    const event = events.find((e) => e.id === drag.id);
    if (!event) return;

    const duration = drag.origEndMin - drag.origStartMin;

    let rafId = 0;
    let lastX = 0;
    let lastY = 0;

    const pointerColumn = (clientX: number): number => {
      const rects = dayRectsRef.current ?? [];
      const start = rects[0]?.getBoundingClientRect().left ?? 0;
      const width = rects[0]?.getBoundingClientRect().width ?? 1;
      return clamp(Math.floor((clientX - start) / width), 0, rects.length - 1);
    };

    const eventStart = new Date(event.start);

    /**
     * Live preview: times snap to the 5-minute grid while dragging, and the
     * block stays in its own day column. A pending day change (pointer over
     * another column) is only applied on release.
     */
    const compute = (clientX: number, clientY: number): DraftTimes => {
      const bodyRect = bodyRectRef.current?.getBoundingClientRect();
      const hourHeight = (bodyRect?.height ?? 0) / 24;
      const pointerMin = ((clientY - (bodyRect?.top ?? 0)) / hourHeight) * 60;

      let dayOffset = 0;
      if (drag.mode === 'move') {
        const origIdx = (dayRectsRef.current ?? []).findIndex(
          (r) =>
            r &&
            isSameDay(
              new Date(Number(r.dataset.time ?? 0)),
              eventStart,
            ),
        );
        dayOffset = pointerColumn(clientX) - (origIdx >= 0 ? origIdx : 0);
      }

      const startMin =
        drag.mode === 'move'
          ? clamp(snapMinutes(pointerMin - drag.grabOffsetMin), 0, DAY_MINUTES - duration)
          : drag.origStartMin;
      const endMin =
        drag.mode === 'resize'
          ? clamp(snapMinutes(pointerMin), startMin + 5, DAY_MINUTES)
          : startMin + duration;
      return { startMin, endMin, dayOffset };
    };

    const onMove = (e: PointerEvent) => {
      // Touch: dormant until the long-press timer fires (hold still). A
      // flick during the dormant window releases the drag so the browser
      // scrolls normally. Mouse input is active immediately.
      if (drag.activateAt !== undefined && !drag.moved) {
        if (Date.now() < drag.activateAt) {
          if (
            Math.abs(e.clientY - drag.startY) > 8 ||
            Math.abs(e.clientX - (drag.startX ?? drag.startY)) > 8
          ) {
            setDrag(null);
          }
          return;
        }
      }
      if (!drag.moved && Math.abs(e.clientY - drag.startY) > 3) {
        setDrag({ ...drag, moved: true });
        return;
      }
      if (!drag.moved) return;

      movedRef.current = true;
      // Throttle preview updates to one per animation frame so the block
      // tracks the mouse smoothly without a grid re-render per mousemove.
      lastX = e.clientX;
      lastY = e.clientY;
      if (rafId === 0) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          const next = compute(lastX, lastY);
          setDraft((prev) => {
            if (
              prev &&
              prev.startMin === next.startMin &&
              prev.endMin === next.endMin &&
              prev.dayOffset === next.dayOffset
            ) {
              return prev;
            }
            return next;
          });
        });
      }
    };

    // Interrupted gesture (browser takes over scrolling etc.): drop the draft
    // without committing anything, mirroring a plain pointer-up with no move.
    const onCancel = () => {
      movedRef.current = false;
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      setDrag(null);
      setDraft(null);
    };

    const onUp = (e: PointerEvent) => {
      movedRef.current = drag.moved;
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      if (drag.moved) {
        const { startMin, endMin, dayOffset } = compute(e.clientX, e.clientY);
        const start = new Date(event.start);
        const end = new Date(event.end);
        start.setDate(start.getDate() + dayOffset);
        end.setDate(end.getDate() + dayOffset);
        start.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
        end.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);
        onEventChange(event.id, start, end);
      }
      setDrag(null);
      setDraft(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };
  }, [drag, events, bodyRectRef, dayRectsRef, onEventChange]);

  const beginDrag = useCallback(
    (event: CalendarEvent, mode: 'move' | 'resize', e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const origStartMin = minutesFromDayStart(new Date(event.start));
      const origEndMin = minutesFromDayStart(new Date(event.end));
      // where the pointer is (in grid minutes) so the block tracks the mouse
      // exactly from the first frame, keeping its grab offset within the block
      const bodyRect = bodyRectRef?.current?.getBoundingClientRect();
      const pointerMin = ((e.clientY - (bodyRect?.top ?? 0)) / (bodyRect?.height ?? 1)) * 24 * 60;
      const grabOffsetMin =
        mode === 'move' ? clamp(pointerMin - origStartMin, 0, origEndMin - origStartMin) : 0;
      const isTouch = e.pointerType === 'touch';
      setDrag({
        id: event.id,
        mode,
        startY: e.clientY,
        startX: e.clientX,
        origStartMin,
        origEndMin,
        grabOffsetMin,
        moved: false,
        // Touch requires a short long-press (or keeping still) before the
        // drag activates, so tap-and-scroll gestures don't move events.
        activateAt: isTouch ? Date.now() + 600 : undefined,
      });
    },
    [bodyRectRef],
  );

  return { drag, draft, beginDrag, movedRef };
}
