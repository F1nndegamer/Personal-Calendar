import type { CalendarEvent } from '../calendar/types';
import type { Task } from '../tasks/types';
import type { TimerPhase } from '../pomodoro/types';
import { formatDue } from '../tasks/lib';

/**
 * Browser notifications for classes, task deadlines and Pomodoro phases.
 *
 * Scope (v1): notifications fire while the app is open in a tab — the
 * reminder scan runs on app state changes plus a one-minute tick. True
 * push (service-worker, app closed) can build on this later.
 *
 * The pure `describe*` builders are separated from the `Notification` API
 * so the message formats are unit-testable without a browser.
 */

/** How many minutes before a class the reminder fires. */
export const EVENT_LEAD_MINUTES = 10;
/** How many minutes before a task deadline the reminder fires. */
export const TASK_LEAD_MINUTES = 60;
/** How often (ms) the reminder scan re-runs while the app idles open. */
export const REMINDER_SCAN_MS = 60_000;

const STORAGE_KEY = 'calendar-app/notify';

/* ---------- Pure message builders (unit-tested) ---------- */

export interface NotificationMessage {
  title: string;
  body: string;
}

/** Reminder message for a class/calendar event about to start. */
export function describeEventReminder(event: CalendarEvent): NotificationMessage {
  const start = new Date(event.start);
  const time = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  // Room/teacher details are normalized into `description` (e.g. "Lokaal B102 · J. Jansen").
  return {
    title: event.title,
    body: event.description ? `Starts at ${time} — ${event.description}` : `Starts at ${time}`,
  };
}

/** Reminder message for a task deadline that is approaching. */
export function describeTaskDeadline(task: Task): NotificationMessage {
  return {
    title: task.title,
    body: `Due ${formatDue(task.dueDate ?? '') || 'soon'}`,
  };
}

/** Message for a Pomodoro phase transition. */
export function describePomodoroPhase(phase: TimerPhase, completedSessions = 0): NotificationMessage {
  if (phase === 'work') {
    return {
      title: 'Focus time',
      body: completedSessions > 0 ? `Break over — focus session ${completedSessions + 1} starting` : 'Time to focus',
    };
  }
  if (phase === 'shortBreak') {
    return { title: 'Break time', body: 'Focus session complete — take a short break' };
  }
  return { title: 'Long break', body: 'Nice streak! Time for a long break' };
}

/* ---------- Browser API wrappers ---------- */

/** True when this browser exposes the Notification API at all. */
export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** The current permission state, or 'unsupported' where the API is missing. */
export function notificationPermission(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Asks the user for notification permission. Resolves `true` only when the
 * result is 'granted'. Never throws (some browsers reject the promise).
 */
export async function requestNotifyPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** Whether notifications are turned on in the app (permission + setting). */
export function notificationsEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on' && notificationPermission() === 'granted';
  } catch {
    return false;
  }
}

/** Persist the app-level notifications preference. */
export function setNotificationsEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore — storage unavailable */
  }
}

/** Fire a notification if (and only if) permitted and enabled. Never throws. */
export function notify(title: string, body: string, tag?: string): void {
  if (!notificationsEnabled()) return;
  try {
    new Notification(title, { body, tag, silent: false });
  } catch {
    /* ignore — construction can fail on some platforms */
  }
}
