import { useMemo } from 'react';
import { formatDayLabel, isSameDay, isSameMonth, startOfDay } from './lib';
import type { CalendarEvent } from './types';
import { useGridGestures } from './useGridGestures';

/** Chips shown per day before the rest collapse into a "+N more" hint. */
const MAX_CHIPS = 3;
const NO_EVENTS: CalendarEvent[] = [];

interface Props {
  /** Whole-week cells covering the visible month (see `monthGrid`). */
  days: Date[];
  /** Any day inside the visible month — decides which cells are "other month". */
  anchor: Date;
  events: CalendarEvent[];
  now: Date;
  /** A tap on a day cell (never on a chip) opens that day. */
  onDayClick: (day: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  /** Horizontal swipe: `1` advances a month, `-1` goes back. */
  onSwipe?: (direction: -1 | 1) => void;
}

/**
 * Month view: one cell per day with up to three event chips under the date.
 *
 * Tapping a chip opens the event; tapping anywhere else in the cell opens that
 * day. Gestures resolve on release (useGridGestures), so a swipe pages a month
 * instead of opening whatever day happened to be under the finger — the same
 * tap-vs-scroll guarantee the time grid gives.
 */
export function MonthView({
  days,
  anchor,
  events,
  now,
  onDayClick,
  onEventClick,
  onSwipe,
}: Props) {
  const { startGesture } = useGridGestures({
    // The day cell itself is the target, so the pointer's Y is unused here.
    onTap: (day) => onDayClick(day),
    onSwipe,
  });

  // Day-start timestamp → that day's events, soonest first. Events are grouped
  // by their start day, exactly like the time grid, so a chip is always where
  // the grid would show the event.
  const eventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEvent[]>();
    for (const ev of events) {
      const key = startOfDay(new Date(ev.start)).getTime();
      const list = map.get(key);
      if (list) list.push(ev);
      else map.set(key, [ev]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    }
    return map;
  }, [events]);

  const columnLabels = useMemo(() => days.slice(0, 7).map(formatDayLabel), [days]);

  return (
    <div className="month-view">
      <div className="month-weekdays">
        {columnLabels.map((label, i) => (
          <span key={i} className="month-weekday">
            {label}
          </span>
        ))}
      </div>
      <div className="month-grid">
        {days.map((day) => {
          const isToday = isSameDay(day, now);
          const isOtherMonth = !isSameMonth(day, anchor);
          const dayEvents = eventsByDay.get(day.getTime()) ?? NO_EVENTS;
          const hidden = dayEvents.length - MAX_CHIPS;
          return (
            // `data-day` mirrors CalendarGrid's `data-time`: a stable handle for
            // tests (and for reading a cell in devtools).
            <div
              key={day.getTime()}
              data-day={day.getTime()}
              className={`month-cell${isOtherMonth ? ' other-month' : ''}${
                isToday ? ' today' : ''
              }`}
              onPointerDown={(e) => startGesture(day, e)}
            >
              <span className="month-day-number">{day.getDate()}</span>
              {dayEvents.slice(0, MAX_CHIPS).map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  className={`month-chip color-${ev.color}`}
                  title={ev.title}
                  aria-label={ev.title}
                  // The chip owns this press: no day-tap underneath, and a
                  // horizontal flick that starts here still pages the month.
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onEventClick(ev)}
                >
                  {ev.title}
                </button>
              ))}
              {hidden > 0 && <span className="month-more">+{hidden} more</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
