import { describe, expect, it } from 'vitest';
import { findNextUp, formatInMinutes } from '../nextUp';
import type { CalendarEvent } from '../types';

const ev = (id: string, start: string, end: string): CalendarEvent => ({
  id,
  title: id,
  start,
  end,
  color: 'blue',
});

const NOW = new Date('2026-09-22T12:00:00');

describe('findNextUp', () => {
  it('returns the event happening right now with minutes left', () => {
    const info = findNextUp([ev('a', '2026-09-22T11:00:00', '2026-09-22T12:30:00')], NOW);
    expect(info).toEqual({ kind: 'now', event: expect.objectContaining({ id: 'a' }), minutes: 30 });
  });

  it('returns the next event when nothing is running', () => {
    const info = findNextUp([ev('b', '2026-09-22T13:15:00', '2026-09-22T14:00:00')], NOW);
    expect(info?.kind).toBe('next');
    expect(info?.minutes).toBe(75);
  });

  it('prefers the overlapping event that ends soonest', () => {
    const info = findNextUp(
      [
        ev('long', '2026-09-22T10:00:00', '2026-09-22T15:00:00'),
        ev('short', '2026-09-22T11:30:00', '2026-09-22T12:20:00'),
      ],
      NOW,
    );
    expect(info?.event.id).toBe('short');
  });

  it('ignores past events and malformed dates', () => {
    const info = findNextUp(
      [
        ev('past', '2026-09-22T09:00:00', '2026-09-22T10:00:00'),
        ev('bad', 'nope', 'also-nope'),
      ],
      NOW,
    );
    expect(info).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(findNextUp([], NOW)).toBeNull();
  });
});

describe('formatInMinutes', () => {
  it('formats minutes, hours and days', () => {
    expect(formatInMinutes(12)).toBe('12 min');
    expect(formatInMinutes(0)).toBe('0 min');
    expect(formatInMinutes(180)).toBe('3 u');
    expect(formatInMinutes(48 * 60)).toBe('2 d');
  });
});
