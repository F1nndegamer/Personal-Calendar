import { describe, expect, it } from 'vitest';
import { startOfDay, addDays } from '../../calendar/lib';
import { parseQuickAdd } from '../parser';
import type { ParsedQuickAdd } from '../types';

const NOW = new Date('2026-08-30T14:30:00'); // Saturday

describe('parseQuickAdd', () => {
  /** Helper: build the expected ISO string for a date token + optional time. */
  function expectDueDate(result: ParsedQuickAdd | null, day: Date, mins?: number): void {
    expect(result).not.toBeNull();
    const expected = new Date(day);
    if (mins !== undefined) {
      expected.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
    }
    expect(result!.dueDate).toBe(expected.toISOString());
  }

  it('parses a plain task with no date or time', () => {
    expect(parseQuickAdd('Math homework', NOW)).toEqual({
      title: 'Math homework',
    });
  });

  it('parses a multi-word title', () => {
    expect(parseQuickAdd('Write the final report', NOW)).toEqual({
      title: 'Write the final report',
    });
  });

  it('parses "today" as start-of-day', () => {
    expectDueDate(parseQuickAdd('Math homework today', NOW), startOfDay(NOW));
  });

  it('parses "tomorrow" as start-of-day next day', () => {
    expectDueDate(
      parseQuickAdd('Math homework tomorrow', NOW),
      addDays(startOfDay(NOW), 1),
    );
  });

  it('parses "next week" as start-of-day 7 days ahead', () => {
    expectDueDate(
      parseQuickAdd('Math homework next week', NOW),
      addDays(startOfDay(NOW), 7),
    );
  });

  it('parses date keywords case-insensitively', () => {
    expectDueDate(
      parseQuickAdd('Math homework TOMORROW', NOW),
      addDays(startOfDay(NOW), 1),
    );
  });

  it('last date keyword wins when multiple are given', () => {
    expectDueDate(
      parseQuickAdd('Math homework today tomorrow', NOW),
      addDays(startOfDay(NOW), 1),
    );
  });

  // ── times ────────────────────────────────────────────────────

  it('parses a 24-hour time (HH:MM)', () => {
    expectDueDate(parseQuickAdd('Meeting 17:00', NOW), startOfDay(NOW), 17 * 60);
  });

  it('parses a time with single-digit hour (8:30)', () => {
    expectDueDate(parseQuickAdd('Doctor 8:30', NOW), startOfDay(NOW), 8 * 60 + 30);
  });

  it('parses a time with leading zero (08:30)', () => {
    expectDueDate(parseQuickAdd('Doctor 08:30', NOW), startOfDay(NOW), 8 * 60 + 30);
  });

  it('defaults time to today when no date keyword is given', () => {
    expectDueDate(parseQuickAdd('Call mom 17:00', NOW), startOfDay(NOW), 17 * 60);
  });

  it('rejects invalid hour (25:00) — keeps token in title', () => {
    const result = parseQuickAdd('Meeting 25:00', NOW);
    expect(result?.title).toBe('Meeting 25:00');
    expect(result?.dueDate).toBeUndefined();
  });

  it('rejects invalid minute (12:60) — keeps token in title', () => {
    const result = parseQuickAdd('Meeting 12:60', NOW);
    expect(result?.title).toBe('Meeting 12:60');
    expect(result?.dueDate).toBeUndefined();
  });

  // ── durations ─────────────────────────────────────────────────

  it('parses duration in minutes (45m)', () => {
    expect(parseQuickAdd('Math homework 45m', NOW)).toEqual({
      title: 'Math homework',
      estimatedMinutes: 45,
    });
  });

  it('parses duration in hours (1h)', () => {
    expect(parseQuickAdd('Write report 1h', NOW)).toEqual({
      title: 'Write report',
      estimatedMinutes: 60,
    });
  });

  it('parses combined hours+minutes (1h30m)', () => {
    expect(parseQuickAdd('Write report 1h30m', NOW)).toEqual({
      title: 'Write report',
      estimatedMinutes: 90,
    });
  });

  it('parses a larger duration (2h30m)', () => {
    expect(parseQuickAdd('Code review 2h30m', NOW)).toEqual({
      title: 'Code review',
      estimatedMinutes: 150,
    });
  });

  it('rejects "1h30" (no m suffix) — keeps in title', () => {
    const result = parseQuickAdd('Write 1h30', NOW);
    expect(result?.title).toBe('Write 1h30');
    expect(result?.estimatedMinutes).toBeUndefined();
  });

  // ── combined date/time/duration ──────────────────────────────

  it('parses date + time + duration together', () => {
    const result = parseQuickAdd('Math homework tomorrow 17:00 45m', NOW);
    expect(result?.title).toBe('Math homework');
    const expected = addDays(startOfDay(NOW), 1);
    expected.setHours(17, 0, 0, 0);
    expect(result?.dueDate).toBe(expected.toISOString());
    expect(result?.estimatedMinutes).toBe(45);
  });

  it('parses next week + time', () => {
    const result = parseQuickAdd('Review PRs next week 09:00', NOW);
    expect(result?.title).toBe('Review PRs');
    const expected = addDays(startOfDay(NOW), 7);
    expected.setHours(9, 0, 0, 0);
    expect(result?.dueDate).toBe(expected.toISOString());
  });

  it('parses time + duration without date keyword', () => {
    const result = parseQuickAdd('Call mom 17:00 30m', NOW);
    expect(result?.title).toBe('Call mom');
    const expected = startOfDay(NOW);
    expected.setHours(17, 0, 0, 0);
    expect(result?.dueDate).toBe(expected.toISOString());
    expect(result?.estimatedMinutes).toBe(30);
  });

  it('parses today + duration without time', () => {
    const result = parseQuickAdd('Exercise today 1h', NOW);
    expect(result?.title).toBe('Exercise');
    expect(result?.dueDate).toBe(startOfDay(NOW).toISOString());
    expect(result?.estimatedMinutes).toBe(60);
  });

  // ── edge cases ───────────────────────────────────────────────

  it('returns null for empty input', () => {
    expect(parseQuickAdd('', NOW)).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(parseQuickAdd('   ', NOW)).toBeNull();
    expect(parseQuickAdd('   \t\n  ', NOW)).toBeNull();
  });

  it('returns null when only tokens match and no title remains', () => {
    expect(parseQuickAdd('tomorrow', NOW)).toBeNull();
    expect(parseQuickAdd('today 45m', NOW)).toBeNull();
    expect(parseQuickAdd('17:00', NOW)).toBeNull();
    expect(parseQuickAdd('1h30m', NOW)).toBeNull();
  });

  it('keeps words that resemble tokens but are not exact matches', () => {
    // "3pm" resembles a time but doesn't match HH:MM (no colon, not 24h).
    // "today" is still extracted as a date keyword.
    const result = parseQuickAdd('Call Dr Smith about 3pm today', NOW);
    expect(result?.title).toBe('Call Dr Smith about 3pm');
    expect(result?.dueDate).toBe(startOfDay(NOW).toISOString());
    expect(result?.estimatedMinutes).toBeUndefined();
  });

  it('keeps numeric values that look like times but are not', () => {
    // "5" doesn't match HH:MM (no colon) — stays in title.
    const result = parseQuickAdd('Meeting at 5 today', NOW);
    expect(result?.title).toBe('Meeting at 5');
    expect(result?.dueDate).toBe(startOfDay(NOW).toISOString());
  });

  it('preserves extra whitespace in the title', () => {
    const result = parseQuickAdd('Math   homework  tomorrow', NOW);
    expect(result?.title).toBe('Math homework');
  });
});
