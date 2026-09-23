import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MonthView } from '../MonthView';
import { monthGrid, startOfDay } from '../lib';
import type { CalendarEvent, EventColor } from '../types';

/**
 * The month view's interaction contract — the part a purely presentational test
 * would miss:
 *
 *   - a chip opens its event and *wins* the press from the cell underneath it
 *   - anywhere else in a cell opens that day
 *   - a horizontal flick pages the month instead of opening whatever day the
 *     finger happened to land on
 */

// RTL only auto-cleans up when vitest globals are enabled and this repo keeps
// them off, so each test cleans up explicitly.
afterEach(cleanup);

const ANCHOR = new Date(2026, 8, 15); // September 2026 (starts on a Tuesday)
const NOW = new Date(2026, 8, 23, 10, 0);
const DAYS = monthGrid(ANCHOR);

function makeEvent(
  id: string,
  day: number,
  hour: number,
  title: string,
  color: EventColor = 'blue',
): CalendarEvent {
  return {
    id,
    title,
    color,
    start: new Date(2026, 8, day, hour, 0).toISOString(),
    end: new Date(2026, 8, day, hour + 1, 0).toISOString(),
  };
}

function renderMonth(events: CalendarEvent[] = []) {
  const onDayClick = vi.fn();
  const onEventClick = vi.fn();
  const onSwipe = vi.fn();
  const { container } = render(
    <MonthView
      days={DAYS}
      anchor={ANCHOR}
      events={events}
      now={NOW}
      onDayClick={onDayClick}
      onEventClick={onEventClick}
      onSwipe={onSwipe}
    />,
  );
  return { container, onDayClick, onEventClick, onSwipe };
}

function cellFor(container: HTMLElement, day: Date): HTMLElement {
  // Cells are keyed by local midnight, so normalise anything with a time of day
  // (e.g. `NOW`).
  const key = startOfDay(day).getTime();
  const cell = container.querySelector(`.month-cell[data-day="${key}"]`);
  if (!cell) throw new Error(`no month cell for ${day.toDateString()}`);
  return cell as HTMLElement;
}

/** A press-and-release in place — what a finger does when tapping. */
function tap(target: Element) {
  fireEvent.pointerDown(target, {
    pointerId: 1,
    button: 0,
    pointerType: 'touch',
    clientX: 100,
    clientY: 100,
  });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 100 });
}

/** A horizontal flick: down at `from`, up at `to`. */
function flick(target: Element, from: [number, number], to: [number, number], pointerId = 2) {
  fireEvent.pointerDown(target, {
    pointerId,
    button: 0,
    pointerType: 'touch',
    clientX: from[0],
    clientY: from[1],
  });
  fireEvent.pointerUp(window, { pointerId, clientX: to[0], clientY: to[1] });
}

describe('MonthView', () => {
  it('renders one cell per grid day, marking today and the neighbouring months', () => {
    const { container } = renderMonth();
    expect(container.querySelectorAll('.month-cell')).toHaveLength(42);

    expect(cellFor(container, NOW).className).toContain('today');
    // 31 August is the Monday that leads into September's grid…
    expect(cellFor(container, new Date(2026, 7, 31)).className).toContain('other-month');
    expect(cellFor(container, new Date(2026, 8, 1)).className).not.toContain('other-month');
    // …and 11 October trails it.
    expect(cellFor(container, new Date(2026, 9, 11)).className).toContain('other-month');
  });

  it('puts each event on the day it starts', () => {
    const { container } = renderMonth([makeEvent('e1', 3, 9, 'Chemistry')]);
    expect(cellFor(container, new Date(2026, 8, 3)).textContent).toContain('Chemistry');
    expect(cellFor(container, new Date(2026, 8, 4)).textContent).not.toContain('Chemistry');
  });

  it('collapses the overflow past three chips into a "+N more" hint', () => {
    const events = [1, 2, 3, 4, 5].map((i) => makeEvent(`e${i}`, 23, 7 + i, `Lesson ${i}`));
    renderMonth(events);

    expect(screen.getByText('Lesson 1')).toBeTruthy();
    expect(screen.getByText('Lesson 3')).toBeTruthy();
    expect(screen.queryByText('Lesson 4')).toBeNull();
    expect(screen.getByText('+2 more')).toBeTruthy();
  });

  it('orders chips by start time', () => {
    const { container } = renderMonth([
      makeEvent('late', 23, 15, 'Late'),
      makeEvent('early', 23, 8, 'Early'),
    ]);
    const cell = cellFor(container, new Date(2026, 8, 23));
    const chips = Array.from(cell.querySelectorAll('.month-chip'));
    expect(chips.map((c) => c.textContent)).toEqual(['Early', 'Late']);
  });

  it('opens the event when a chip is pressed, never the day underneath', () => {
    // The regression this guards: the cell's own tap gesture also firing, so a
    // chip press opened the event *and* jumped to day view.
    const { container, onDayClick, onEventClick } = renderMonth([
      makeEvent('e1', 23, 9, 'Physics'),
    ]);
    const cell = cellFor(container, new Date(2026, 8, 23));
    const chip = cell.querySelector('.month-chip') as HTMLElement;

    tap(chip);
    fireEvent.click(chip);

    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick.mock.calls[0][0].id).toBe('e1');
    expect(onDayClick).not.toHaveBeenCalled();
  });

  it('opens the day when the cell itself is tapped', () => {
    const { container, onDayClick, onEventClick } = renderMonth([
      makeEvent('e1', 23, 9, 'Physics'),
    ]);

    tap(cellFor(container, new Date(2026, 8, 23)));

    expect(onDayClick).toHaveBeenCalledTimes(1);
    expect(onDayClick.mock.calls[0][0].getDate()).toBe(23);
    expect(onEventClick).not.toHaveBeenCalled();
  });

  it('pages the month on a horizontal flick instead of opening a day', () => {
    const { container, onSwipe, onDayClick } = renderMonth();

    flick(cellFor(container, new Date(2026, 8, 23)), [300, 200], [170, 205]);

    expect(onSwipe).toHaveBeenCalledWith(1);
    expect(onDayClick).not.toHaveBeenCalled();
  });

  it('ignores a vertical drag, so scrolling the grid never navigates', () => {
    const { container, onSwipe, onDayClick } = renderMonth();

    flick(cellFor(container, new Date(2026, 8, 23)), [300, 200], [290, 400]);

    expect(onSwipe).not.toHaveBeenCalled();
    expect(onDayClick).not.toHaveBeenCalled();
  });

  it('renders no chips at all when there are no events', () => {
    const { container } = renderMonth();
    expect(container.querySelectorAll('.month-chip')).toHaveLength(0);
    expect(container.querySelectorAll('.month-more')).toHaveLength(0);
  });
});
