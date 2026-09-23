// @vitest-environment node
/**
 * Pure device-feed logic tests (canonical module `server/deviceFeed.ts`).
 * These cover the contract the ESP32 firmware relies on; the C++ port of
 * `monthCells` in `firmware/test/` mirrors the month-grid expectations here.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDeviceFeed,
  dateInTimeZone,
  isAllDayEvent,
  monthCells,
  parseDaysParam,
} from '../deviceFeed.js';

const TZ = 'Europe/Amsterdam';

describe('parseDaysParam', () => {
  it('defaults when omitted or empty', () => {
    expect(parseDaysParam(null)).toBe(31);
    expect(parseDaysParam('')).toBe(31);
  });
  it('accepts the valid range', () => {
    expect(parseDaysParam('1')).toBe(1);
    expect(parseDaysParam('62')).toBe(62);
  });
  it('rejects garbage', () => {
    expect(parseDaysParam('abc')).toBeNull();
    expect(parseDaysParam('0')).toBeNull();
    expect(parseDaysParam('63')).toBeNull();
    expect(parseDaysParam('-5')).toBeNull();
    expect(parseDaysParam('3.5')).toBeNull();
  });
});

describe('dateInTimeZone', () => {
  it('converts a UTC instant to the Amsterdam calendar date', () => {
    expect(dateInTimeZone(new Date('2026-09-24T00:30:00.000Z'), TZ)).toBe('2026-09-24');
    expect(dateInTimeZone(new Date('2026-09-24T23:30:00.000Z'), TZ)).toBe('2026-09-25');
  });
});

describe('isAllDayEvent', () => {
  it('detects midnight-to-midnight as all-day', () => {
    expect(
      isAllDayEvent(new Date('2026-09-24T00:00:00+02:00'), new Date('2026-09-25T00:00:00+02:00'), TZ),
    ).toBe(true);
  });
  it('rejects timed events', () => {
    expect(
      isAllDayEvent(new Date('2026-09-24T09:00:00+02:00'), new Date('2026-09-24T10:00:00+02:00'), TZ),
    ).toBe(false);
  });
});

describe('buildDeviceFeed', () => {
  const rangeStart = new Date('2026-09-22T00:00:00+02:00');
  const rangeEnd = new Date('2026-10-23T00:00:00+02:00');
  const base = { rangeStart, rangeEnd, timezone: TZ, generatedAt: new Date('2026-09-22T08:00:00Z') };

  it('returns an empty event list for an empty calendar', () => {
    const feed = buildDeviceFeed({ ...base, events: [], tasks: [] });
    expect(feed.version).toBe(1);
    expect(feed.timezone).toBe(TZ);
    expect(feed.events).toEqual([]);
  });

  it('filters to the range with half-open overlap', () => {
    const feed = buildDeviceFeed({
      ...base,
      events: [
        { id: 'in', title: 'In', start: '2026-09-23T10:00:00+02:00', end: '2026-09-23T11:00:00+02:00', color: 'blue' },
        { id: 'before', title: 'Before', start: '2026-09-20T10:00:00+02:00', end: '2026-09-21T10:00:00+02:00', color: 'blue' },
        { id: 'touch-end', title: 'EndsAtStart', start: '2026-09-21T10:00:00+02:00', end: '2026-09-22T00:00:00+02:00', color: 'blue' },
        { id: 'touch-start', title: 'StartsAtEnd', start: '2026-10-23T00:00:00+02:00', end: '2026-10-23T01:00:00+02:00', color: 'blue' },
      ],
      tasks: [],
    });
    expect(feed.events.map((e) => e.id)).toEqual(['in']);
  });

  it('marks all-day events and computes the local date', () => {
    const feed = buildDeviceFeed({
      ...base,
      events: [
        { id: 'ad', title: 'Holiday', start: '2026-09-24T00:00:00+02:00', end: '2026-09-25T00:00:00+02:00', color: 'green', category: 'Free' },
      ],
      tasks: [],
    });
    expect(feed.events[0].allDay).toBe(true);
    expect(feed.events[0].date).toBe('2026-09-24');
  });

  it('sorts deterministically by start, end, id', () => {
    const feed = buildDeviceFeed({
      ...base,
      events: [
        { id: 'b', title: 'B', start: '2026-09-23T10:00:00+02:00', end: '2026-09-23T11:00:00+02:00', color: 'blue' },
        { id: 'a', title: 'A', start: '2026-09-23T10:00:00+02:00', end: '2026-09-23T11:00:00+02:00', color: 'blue' },
        { id: 'early', title: 'E', start: '2026-09-23T08:00:00+02:00', end: '2026-09-23T12:00:00+02:00', color: 'blue' },
      ],
      tasks: [],
    });
    expect(feed.events.map((e) => e.id)).toEqual(['early', 'a', 'b']);
  });

  it('drops malformed entries and defaults bad colors', () => {
    const feed = buildDeviceFeed({
      ...base,
      events: [
        { id: 'bad-color', title: 'X', start: '2026-09-23T10:00:00+02:00', end: '2026-09-23T11:00:00+02:00', color: 'chartreuse' },
        { nope: true },
        { id: 'bad-date', title: 'Y', start: 'soon-ish', end: '2026-09-23T11:00:00+02:00', color: 'blue' },
      ],
      tasks: [],
    });
    expect(feed.events.map((e) => e.id)).toEqual(['bad-color']);
    expect(feed.events[0].color).toBe('blue');
  });

  it('exposes uncompleted tasks with due dates as deadline markers', () => {
    const feed = buildDeviceFeed({
      ...base,
      events: [],
      tasks: [
        { id: 't1', title: 'Read ch.5', completed: false, priority: 'high', color: 'red', subtasks: [], dueDate: '2026-09-25T17:00:00+02:00' },
        { id: 't2', title: 'Done', completed: true, priority: 'low', color: 'blue', subtasks: [], dueDate: '2026-09-25T17:00:00+02:00' },
      ],
    });
    expect(feed.events.map((e) => e.id)).toEqual(['task:t1']);
    expect(feed.events[0].date).toBe('2026-09-25');
  });
});

describe('monthCells (firmware reference)', () => {
  it('covers Sept 2026 Monday-first with 42 cells', () => {
    const cells = monthCells(2026, 9);
    expect(cells).toHaveLength(42);
    expect(cells[0].key).toBe('2026-08-31');
    expect(cells[0].outside).toBe(true);
    expect(cells[1].key).toBe('2026-09-01');
    expect(cells[1].outside).toBe(false);
    expect(cells[7].key).toBe('2026-09-07');
    expect(cells[41].key).toBe('2026-10-11');
  });
});
