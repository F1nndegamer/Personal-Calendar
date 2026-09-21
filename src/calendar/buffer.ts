import type { CalendarEvent } from './types';

/** Default gap kept between events when smart buffers are enabled. */
export const DEFAULT_BUFFER_MIN = 10;
/** Smallest duration an event may be squeezed to by buffer adjustment. */
export const MIN_EVENT_MIN = 15;

export interface PlacedTimes {
  start: Date;
  end: Date;
}

/**
 * Shift or shrink a proposed event placement so it keeps at least
 * `bufferMin` minutes of breathing room from neighbouring events on the
 * same day ("smart buffer times between classes and tasks").
 *
 * Rules, applied in order:
 *  1. If the proposed start starts too soon after an earlier event ends,
 *     the start is pushed back (the duration is preserved, so the end
 *     moves with it).
 *  2. If the (possibly shifted) end now runs into the buffer of a later
 *     event, the end is pulled in — down to `MIN_EVENT_MIN`, below which
 *     the original placement is returned unchanged rather than producing
 *     a uselessly tiny event.
 *
 * `skipId` excludes the event being moved from its own neighbour set.
 * Days are compared by calendar date so buffers never apply across days.
 */
export function applyBuffer(
  proposed: PlacedTimes,
  events: CalendarEvent[],
  bufferMin: number,
  skipId?: string,
): PlacedTimes {
  if (bufferMin <= 0) return proposed;
  const bufferMs = bufferMin * 60_000;
  const minMs = MIN_EVENT_MIN * 60_000;
  const day = proposed.start.toDateString();

  let prevEnd = -Infinity;
  let nextStart = Infinity;
  for (const e of events) {
    if (e.id === skipId) continue;
    const start = new Date(e.start);
    if (start.toDateString() !== day) continue;
    const end = new Date(e.end);
    // A neighbour is one that lies entirely before or after the proposal.
    if (end.getTime() <= proposed.start.getTime()) {
      prevEnd = Math.max(prevEnd, end.getTime());
    } else if (start.getTime() >= proposed.end.getTime()) {
      nextStart = Math.min(nextStart, start.getTime());
    }
    // Overlapping neighbours impose no buffer — the user explicitly
    // allowed the overlap (parallel columns are a supported layout).
  }

  let { start, end } = proposed;
  const duration = end.getTime() - start.getTime();

  // 1. push the start clear of the previous event's buffer
  if (prevEnd !== -Infinity && start.getTime() - prevEnd < bufferMs) {
    start = new Date(prevEnd + bufferMs);
    end = new Date(start.getTime() + duration);
  }

  // 2. pull the end clear of the next event's buffer
  if (nextStart !== Infinity && nextStart - end.getTime() < bufferMs) {
    const latestEnd = nextStart - bufferMs;
    if (latestEnd - start.getTime() >= minMs) {
      end = new Date(Math.max(latestEnd, start.getTime() + minMs));
    }
    // else: not enough room — leave the placement as proposed
  }

  return { start, end };
}

/** Whether two placements differ in start or end (used for toasts). */
export function timesChanged(a: PlacedTimes, b: PlacedTimes): boolean {
  return a.start.getTime() !== b.start.getTime() || a.end.getTime() !== b.end.getTime();
}
