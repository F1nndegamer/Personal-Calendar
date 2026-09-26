import { formatTime } from '../calendar/lib';
import type { CalendarEvent } from '../calendar/types';
import { formatDue, sortTasks } from '../tasks/lib';
import type { Task } from '../tasks/types';
import type { CommandItem } from './search';

/** Midnight start spanning at least a whole day — the app's all-day convention. */
function isAllDayLike(start: Date, end: Date): boolean {
  if (start.getHours() !== 0 || start.getMinutes() !== 0 || start.getSeconds() !== 0) return false;
  if (Number.isNaN(end.getTime())) return false;
  const nextMidnight = new Date(start);
  nextMidnight.setDate(start.getDate() + 1);
  return end.getTime() >= nextMidnight.getTime();
}

/** "Mon 6 Oct" or "Mon 6 Oct 14:30" — time omitted for all-day items. */
function formatEventHint(ev: CalendarEvent): string {
  const start = new Date(ev.start);
  if (Number.isNaN(start.getTime())) return '';
  const date = start.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  if (isAllDayLike(start, new Date(ev.end))) return date;
  return `${date} ${formatTime(start)}`;
}

/** Non-empty fragments of an item's second line, joined for display. */
function joinDetail(...parts: (string | undefined)[]): string | undefined {
  const kept = parts.filter((p): p is string => Boolean(p && p.trim()));
  return kept.length > 0 ? kept.join(' · ') : undefined;
}

/**
 * Turn the app's data into the flat list the palette searches.
 *
 * `actions` come from the caller (they hold the callbacks); events and tasks
 * are projected into display items here. Events are ordered nearest-first and
 * tasks through the panel's own {@link sortTasks}, so an empty query shows
 * what is relevant right now instead of whatever the feed happened to store
 * first.
 */
export function collectCommands(
  actions: readonly CommandItem[],
  events: readonly CalendarEvent[],
  tasks: readonly Task[],
  now: Date = new Date(),
): CommandItem[] {
  const items: CommandItem[] = [...actions];

  const byProximity = [...events].sort((a, b) => {
    const da = Math.abs(new Date(a.start).getTime() - now.getTime());
    const db = Math.abs(new Date(b.start).getTime() - now.getTime());
    return da - db;
  });
  for (const ev of byProximity) {
    items.push({
      id: `event:${ev.id}`,
      group: 'event',
      title: ev.title.trim() || 'Untitled event',
      detail: joinDetail(ev.category, ev.source === 'external' ? 'Synced' : undefined, ev.description),
      hint: formatEventHint(ev),
    });
  }

  for (const task of sortTasks(tasks)) {
    items.push({
      id: `task:${task.id}`,
      group: 'task',
      title: task.title.trim() || 'Untitled task',
      detail: joinDetail(task.category, task.completed ? 'Done' : undefined, task.description),
      hint: task.dueDate ? formatDue(task.dueDate, now) : undefined,
    });
  }

  return items;
}
