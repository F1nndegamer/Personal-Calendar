import { describe, expect, it } from 'vitest';
import { formatTime } from '../../calendar/lib';
import type { CalendarEvent } from '../../calendar/types';
import type { Task } from '../../tasks/types';
import { collectCommands } from '../collect';
import type { CommandItem } from '../search';

const NOW = new Date('2026-09-27T12:00:00');

function ev(id: string, start: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title: `Event ${id}`, start, end: extra.end ?? start, color: 'blue', ...extra };
}

function task(id: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    completed: false,
    priority: 'medium',
    color: 'blue',
    subtasks: [],
    ...extra,
  };
}

const titlesOf = (items: CommandItem[]) => items.map((i) => i.title);
const idsOf = (items: CommandItem[]) => items.map((i) => i.id);

describe('collectCommands', () => {
  it('keeps the caller order for actions', () => {
    const actions = [
      { id: 'action:one', group: 'action', title: 'One' },
      { id: 'action:two', group: 'action', title: 'Two' },
    ];
    expect(idsOf(collectCommands(actions, [], [], NOW))).toEqual(['action:one', 'action:two']);
  });

  it('namespaces event and task ids so they can never collide', () => {
    const items = collectCommands([], [ev('42', '2026-09-27T14:00:00')], [task('42')], NOW);
    expect(idsOf(items)).toEqual(['event:42', 'task:42']);
  });

  it('orders events nearest to now first', () => {
    const items = collectCommands(
      [],
      [
        ev('far', '2026-10-20T09:00:00'),
        ev('near', '2026-09-27T14:00:00'),
        ev('mid', '2026-10-01T09:00:00'),
      ],
      [],
      NOW,
    );
    expect(idsOf(items)).toEqual(['event:near', 'event:mid', 'event:far']);
  });

  it('omits the clock from an all-day event hint but keeps it for a timed one', () => {
    const start = '2026-09-27T00:00:00';
    const [allDay] = collectCommands(
      [],
      [ev('allday', start, { end: '2026-09-28T00:00:00' })],
      [],
      NOW,
    );
    const [timed] = collectCommands([], [ev('timed', start)], [], NOW);

    const dateOnly = new Date(start).toLocaleDateString([], {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    expect(allDay.hint).toBe(dateOnly);
    expect(timed.hint).toBe(`${dateOnly} ${formatTime(new Date(start))}`);
  });

  it('labels synced events in the detail line', () => {
    const [synced] = collectCommands([], [ev('e1', '2026-09-27T14:00:00', { source: 'external' })], [], NOW);
    const [local] = collectCommands([], [ev('e2', '2026-09-27T14:00:00')], [], NOW);
    expect(synced.detail).toContain('Synced');
    expect(local.detail).toBeUndefined();
  });

  it('gives a task a due hint only when it has a due date', () => {
    const [undated] = collectCommands([], [], [task('t1')], NOW);
    const [dated] = collectCommands(
      [],
      [],
      [task('t2', { dueDate: '2026-09-27T14:00:00' })],
      NOW,
    );
    expect(undated.hint).toBeUndefined();
    expect(dated.hint).toBeTruthy();
  });

  it('marks completed tasks in the detail line', () => {
    const [done] = collectCommands([], [], [task('t1', { completed: true })], NOW);
    expect(done.detail).toContain('Done');
  });

  it('sorts open tasks ahead of completed ones', () => {
    const items = collectCommands(
      [],
      [],
      [
        task('done', { completed: true, priority: 'high', dueDate: '2026-09-27T09:00:00' }),
        task('open', { priority: 'low', dueDate: '2026-10-01T09:00:00' }),
      ],
      NOW,
    );
    expect(titlesOf(items)).toEqual(['Task open', 'Task done']);
  });

  it('falls back to a placeholder for untitled items', () => {
    const items = collectCommands(
      [],
      [ev('e1', '2026-09-27T14:00:00', { title: '  ' })],
      [task('t1', { title: '' })],
      NOW,
    );
    expect(titlesOf(items)).toEqual(['Untitled event', 'Untitled task']);
  });
});
