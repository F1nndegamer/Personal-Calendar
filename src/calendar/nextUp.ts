import type { CalendarEvent } from './types';

/**
 * "Next up" selection logic — pure and unit-tested, the component
 * (NextUp.tsx) only renders the result.
 */

export interface NextUpInfo {
  /** 'now' = inside an event; 'next' = waiting for the next one. */
  kind: 'now' | 'next';
  event: CalendarEvent;
  /** Whole minutes until the (current) event ends or the next one starts. */
  minutes: number;
}

/**
 * The event happening right now (longest-relevant: the one ending soonest if
 * several overlap), or the next event that starts after `now`. `null` when
 * there is neither.
 */
export function findNextUp(events: CalendarEvent[], now: Date): NextUpInfo | null {
  const t = now.getTime();
  let current: { event: CalendarEvent; endsAt: number } | null = null;
  let upcoming: { event: CalendarEvent; startsAt: number } | null = null;

  for (const ev of events) {
    const s = new Date(ev.start).getTime();
    const e = new Date(ev.end).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    if (s <= t && t < e) {
      if (!current || e < current.endsAt) current = { event: ev, endsAt: e };
    } else if (s > t) {
      if (!upcoming || s < upcoming.startsAt) upcoming = { event: ev, startsAt: s };
    }
  }

  if (current) {
    return { kind: 'now', event: current.event, minutes: Math.round((current.endsAt - t) / 60_000) };
  }
  if (upcoming) {
    return { kind: 'next', event: upcoming.event, minutes: Math.round((upcoming.startsAt - t) / 60_000) };
  }
  return null;
}

/** Compact human countdown: "12 min", "3 u", "2 d" (Dutch-friendly labels). */
export function formatInMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.max(0, minutes)} min`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} u`;
  return `${Math.round(minutes / (24 * 60))} d`;
}
