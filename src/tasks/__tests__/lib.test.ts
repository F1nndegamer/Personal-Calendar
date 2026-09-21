import { describe, expect, it } from 'vitest';
import { formatDue, isOverdue, matchesQuery, sortTasks } from '../lib';
import type { Task } from '../types';

const task = (over: Partial<Task> & { id: string }): Task => ({
  title: over.id,
  completed: false,
  priority: 'medium',
  color: 'blue',
  subtasks: [],
  ...over,
});

describe('sortTasks', () => {
  it('puts high priority before medium before low', () => {
    const ids = sortTasks([
      task({ id: 'low', priority: 'low' }),
      task({ id: 'high', priority: 'high' }),
      task({ id: 'medium', priority: 'medium' }),
    ]).map((t) => t.id);
    expect(ids).toEqual(['high', 'medium', 'low']);
  });

  it('sorts by soonest due date within a priority', () => {
    const ids = sortTasks([
      task({ id: 'later', dueDate: '2026-09-20T09:00:00' }),
      task({ id: 'sooner', dueDate: '2026-09-18T09:00:00' }),
      task({ id: 'no-due' }),
    ]).map((t) => t.id);
    expect(ids).toEqual(['sooner', 'later', 'no-due']);
  });

  it('puts completed tasks last regardless of priority', () => {
    const ids = sortTasks([
      task({ id: 'done-high', priority: 'high', completed: true }),
      task({ id: 'open-low', priority: 'low' }),
    ]).map((t) => t.id);
    expect(ids).toEqual(['open-low', 'done-high']);
  });

  it('does not mutate the input array', () => {
    const input = [task({ id: 'a', priority: 'low' }), task({ id: 'b', priority: 'high' })];
    const snapshot = [...input];
    sortTasks(input);
    expect(input).toEqual(snapshot);
  });
});

describe('isOverdue', () => {
  const now = new Date('2026-09-20T12:00:00');

  it('is true for an open task whose due moment has passed', () => {
    expect(isOverdue(task({ id: 'a', dueDate: '2026-09-20T09:00:00' }), now)).toBe(true);
  });

  it('is false for a due moment still in the future', () => {
    expect(isOverdue(task({ id: 'a', dueDate: '2026-09-20T18:00:00' }), now)).toBe(false);
  });

  it('is false for completed tasks and tasks with no due date', () => {
    expect(isOverdue(task({ id: 'a', dueDate: '2026-01-01T00:00:00', completed: true }), now)).toBe(false);
    expect(isOverdue(task({ id: 'b' }), now)).toBe(false);
  });

  it('is false for an unparseable due date instead of throwing', () => {
    expect(isOverdue(task({ id: 'a', dueDate: 'not-a-date' }), now)).toBe(false);
  });
});

describe('formatDue', () => {
  const now = new Date('2026-09-20T12:00:00');

  it('labels today and tomorrow with their time', () => {
    expect(formatDue('2026-09-20T14:30:00', now)).toBe('Today 14:30');
    expect(formatDue('2026-09-21T09:00:00', now)).toBe('Tomorrow 09:00');
  });

  it('omits the clock for a date-only (midnight) due date', () => {
    // A midnight time means the user picked a date, not a time. The label order
    // depends on the runtime locale, so assert on content rather than format.
    const label = formatDue('2026-09-25T00:00:00', now);
    expect(label).toContain('25');
    expect(label).toContain('Sep');
    expect(label).not.toContain(':');
  });

  it('includes the clock for a later date that has a real time', () => {
    const label = formatDue('2026-09-25T08:15:00', now);
    expect(label).toContain('25');
    expect(label).toContain('Sep');
    expect(label).toContain('08:15');
  });

  it('returns an empty string for an unparseable date', () => {
    expect(formatDue('nope', now)).toBe('');
  });
});

describe('matchesQuery', () => {
  const subject = task({
    id: 'a',
    title: 'Write report',
    category: 'School',
    description: 'Chapter 3 summary',
  });

  it('matches everything when the query is blank', () => {
    expect(matchesQuery(subject, '')).toBe(true);
    expect(matchesQuery(subject, '   ')).toBe(true);
  });

  it('matches case-insensitively on the title', () => {
    expect(matchesQuery(subject, 'REPORT')).toBe(true);
    expect(matchesQuery(subject, 'write')).toBe(true);
  });

  it('matches on category and description too', () => {
    expect(matchesQuery(subject, 'school')).toBe(true);
    expect(matchesQuery(subject, 'chapter')).toBe(true);
  });

  it('rejects a non-match', () => {
    expect(matchesQuery(subject, 'grocery')).toBe(false);
  });

  it('does not match on an absent optional field', () => {
    // `category`/`description` are optional, so this must not throw.
    expect(matchesQuery(task({ id: 'b', title: 'Bare' }), 'school')).toBe(false);
  });
});
