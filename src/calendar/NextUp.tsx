import { useEffect, useState } from 'react';
import { formatTimeFull } from './lib';
import type { CalendarEvent } from './types';
import { findNextUp, formatInMinutes } from './nextUp';

/**
 * "Next up" strip above the grid: what's happening right now (with a live
 * "ends in" countdown) or what's next (with a "starts in" countdown).
 * Hidden entirely when there is nothing scheduled.
 */
export function NextUp({ events, now }: { events: CalendarEvent[]; now: Date }) {
  const [, setBeat] = useState(0);

  // Re-render once a minute so the countdown stays honest even without
  // other state changes.
  useEffect(() => {
    const id = window.setInterval(() => setBeat((b) => b + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const info = findNextUp(events, now);
  if (!info) return null;
  const { kind, event, minutes } = info;
  const start = new Date(event.start);
  const end = new Date(event.end);

  return (
    <div className={`nextup ${kind}`} role="status">
      <span className={`nextup-chip color-${event.color}`}>
        {kind === 'now' ? 'Now' : 'Next'}
      </span>
      <span className="nextup-title">{event.title}</span>
      <span className="nextup-time">
        {formatTimeFull(start)}–{formatTimeFull(end)}
      </span>
      <span className="nextup-count">
        {kind === 'now'
          ? `${formatInMinutes(minutes)} left`
          : `in ${formatInMinutes(minutes)}`}
      </span>
    </div>
  );
}
