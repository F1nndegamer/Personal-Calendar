import { describe, expect, it } from 'vitest';
import {
  MONTH_GRID_DAYS,
  addMonths,
  formatMonthLabel,
  isSameMonth,
  monthGrid,
  startOfMonth,
} from '../lib';

/**
 * Month-view maths. The regressions these guard against: `setMonth` overflow
 * (31 Jan + 1 month landing in March, so paging silently skips February) and a
 * month grid that does not actually cover every day of the month it claims.
 */

describe('startOfMonth', () => {
  it('snaps any day of the month back to the 1st at midnight', () => {
    const d = startOfMonth(new Date(2026, 8, 23, 17, 42, 11));
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });

  it('is a no-op for the 1st, so it can be applied to its own output', () => {
    const first = startOfMonth(new Date(2026, 2, 1));
    expect(startOfMonth(first).getTime()).toBe(first.getTime());
  });
});

describe('isSameMonth', () => {
  it('compares month and year, ignoring the day', () => {
    expect(isSameMonth(new Date(2026, 8, 1), new Date(2026, 8, 30))).toBe(true);
  });

  it('separates the same month in different years', () => {
    expect(isSameMonth(new Date(2025, 8, 30), new Date(2026, 8, 1))).toBe(false);
  });

  it('separates adjacent months', () => {
    expect(isSameMonth(new Date(2026, 8, 30), new Date(2026, 9, 1))).toBe(false);
  });
});

describe('addMonths', () => {
  it('steps whole months forward and back, keeping the day', () => {
    const forward = addMonths(new Date(2026, 8, 23), 1);
    expect(forward.getMonth()).toBe(9);
    expect(forward.getDate()).toBe(23);
    const back = addMonths(new Date(2026, 8, 23), -1);
    expect(back.getMonth()).toBe(7);
    expect(back.getDate()).toBe(23);
  });

  it('crosses year boundaries in both directions', () => {
    const next = addMonths(new Date(2026, 11, 10), 1);
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(10);

    const prev = addMonths(new Date(2026, 0, 10), -1);
    expect(prev.getFullYear()).toBe(2025);
    expect(prev.getMonth()).toBe(11);
    expect(prev.getDate()).toBe(10);
  });

  it('clamps a day the target month does not have', () => {
    // 31 Jan + 1 must land in February, not March.
    const feb = addMonths(new Date(2026, 0, 31), 1);
    expect(feb.getMonth()).toBe(1);
    expect(feb.getDate()).toBe(28);
  });

  it('clamps to the 29th in a leap year', () => {
    const feb = addMonths(new Date(2028, 0, 31), 1);
    expect(feb.getMonth()).toBe(1);
    expect(feb.getDate()).toBe(29);
  });

  it('never skips or repeats a month when paging a whole year', () => {
    let d = new Date(2026, 0, 31);
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      d = addMonths(d, 1);
      seen.push(`${d.getFullYear()}-${d.getMonth()}`);
    }
    expect(new Set(seen).size).toBe(12);
  });

  it('stays at midnight so anchors never gain a time of day', () => {
    const d = addMonths(new Date(2026, 8, 1, 13, 37), 2);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });
});

describe('monthGrid', () => {
  it('always renders six whole weeks, Monday through Sunday', () => {
    for (let month = 0; month < 12; month++) {
      const grid = monthGrid(new Date(2026, month, 15));
      expect(grid).toHaveLength(MONTH_GRID_DAYS);
      expect(grid[0].getDay()).toBe(1); // Monday
      expect(grid[grid.length - 1].getDay()).toBe(0); // Sunday
    }
  });

  it('contains every day of the anchor month exactly once', () => {
    const grid = monthGrid(new Date(2026, 1, 14)); // February 2026
    const keys = grid.map((d) => d.getTime());
    expect(new Set(keys).size).toBe(MONTH_GRID_DAYS);
    for (let day = 1; day <= 28; day++) {
      expect(keys).toContain(new Date(2026, 1, day).getTime());
    }
  });

  it('covers the 31 days of a month that needs six rows', () => {
    // August 2026 starts on a Saturday, so it spills into a sixth week.
    const keys = monthGrid(new Date(2026, 7, 31)).map((d) => d.getTime());
    for (let day = 1; day <= 31; day++) {
      expect(keys).toContain(new Date(2026, 7, day).getTime());
    }
  });

  it('runs on consecutive local midnights, even across a DST switch', () => {
    // Late-October grids span the European DST change.
    const grid = monthGrid(new Date(2026, 9, 15));
    for (const day of grid) {
      expect(day.getHours()).toBe(0);
      expect(day.getMinutes()).toBe(0);
    }
    for (let i = 1; i < grid.length; i++) {
      const prev = grid[i - 1];
      const expected = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1);
      expect(grid[i].getTime()).toBe(expected.getTime());
    }
  });

  it('is anchored on the month, not on the day of the anchor', () => {
    const early = monthGrid(new Date(2026, 8, 1)).map((d) => d.getTime());
    const late = monthGrid(new Date(2026, 8, 30)).map((d) => d.getTime());
    expect(early).toEqual(late);
    expect(early).toEqual(monthGrid(new Date(2026, 8, 15)).map((d) => d.getTime()));
  });
});

describe('formatMonthLabel', () => {
  it('names the anchor month and its year', () => {
    const anchor = new Date(2026, 8, 23);
    const label = formatMonthLabel(anchor);
    expect(label).toContain(anchor.toLocaleDateString([], { month: 'long' }));
    expect(label).toContain('2026');
  });
});
