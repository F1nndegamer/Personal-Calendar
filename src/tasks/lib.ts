import { isSameDay } from '../calendar/lib';
import type { Priority, Task } from './types';

/** Sort weight per priority — high first, then medium, then low. */
const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/**
 * Order tasks for display: open before completed, then by priority, then by
 * soonest due date. Tasks without a due date sort last within their group.
 */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const pa = a.completed ? 3 : PRIORITY_ORDER[a.priority];
    const pb = b.completed ? 3 : PRIORITY_ORDER[b.priority];
    if (pa !== pb) return pa - pb;
    const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return da - db;
  });
}

/** Whether an open task's due date has already passed. */
export function isOverdue(task: Task, now: Date = new Date()): boolean {
  if (task.completed || !task.dueDate) return false;
  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  return due < now;
}

/** Human-friendly due label: "Today 14:00", "Tomorrow 09:00", or "12 Sep". */
export function formatDue(dateStr: string, now: Date = new Date()): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  if (isSameDay(d, now)) return `Today ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (isSameDay(d, tomorrow)) return `Tomorrow ${time}`;
  // A midnight due time means the user gave only a date, so omit the clock.
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  const label = d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return hasTime ? `${label} ${time}` : label;
}

/**
 * Short countdown for imminent deadlines, e.g. "45m", "3h", "2d".
 * Returns null when the task has no/past date or is more than a week out —
 * beyond that a countdown is noise rather than a helpful nudge.
 */
export function formatCountdown(dateStr: string, now: Date = new Date()): string | null {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const ms = d.getTime() - now.getTime();
  if (ms <= 0) return null; // overdue has its own badge
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(ms / 86_400_000);
  if (days <= 7) return `${days}d`;
  return null;
}

/** Case-insensitive match on title, category, or description. */
export function matchesQuery(task: Task, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    task.title.toLowerCase().includes(q) ||
    (task.category?.toLowerCase().includes(q) ?? false) ||
    (task.description?.toLowerCase().includes(q) ?? false)
  );
}
