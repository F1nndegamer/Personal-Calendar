import { describe, expect, it } from 'vitest';
import {
  describeEventReminder,
  describePomodoroPhase,
  describeTaskDeadline,
} from '../notify';
import type { CalendarEvent } from '../../calendar/types';
import type { Task } from '../../tasks/types';

describe('describeEventReminder', () => {
  it('includes start time and description details', () => {
    const event: CalendarEvent = {
      id: 'e1',
      title: 'Wiskunde',
      start: '2026-09-22T14:00:00',
      end: '2026-09-22T15:00:00',
      description: 'Lokaal B102 · J. Jansen',
      color: 'blue',
      source: 'external',
    };
    const msg = describeEventReminder(event);
    expect(msg.title).toBe('Wiskunde');
    expect(msg.body).toBe('Starts at 14:00 — Lokaal B102 · J. Jansen');
  });

  it('omits details when the event has no description', () => {
    const event: CalendarEvent = {
      id: 'e2',
      title: 'Uitje',
      start: '2026-09-22T09:15:00',
      end: '2026-09-22T10:00:00',
      color: 'green',
      source: 'local',
    };
    expect(describeEventReminder(event).body).toBe('Starts at 09:15');
  });
});

describe('describeTaskDeadline', () => {
  it('uses the formatted due date', () => {
    const due = new Date();
    due.setHours(17, 0, 0, 0);
    const task: Task = {
      id: 't1',
      title: 'Examen leren',
      completed: false,
      priority: 'high',
      color: 'red',
      subtasks: [],
      dueDate: due.toISOString(),
    };
    const msg = describeTaskDeadline(task);
    expect(msg.title).toBe('Examen leren');
    expect(msg.body).toContain('Due');
  });
});

describe('describePomodoroPhase', () => {
  it('announces break time after a focus session', () => {
    expect(describePomodoroPhase('shortBreak')).toEqual({
      title: 'Break time',
      body: 'Focus session complete — take a short break',
    });
  });

  it('announces focus time and counts the next session', () => {
    const msg = describePomodoroPhase('work', 3);
    expect(msg.title).toBe('Focus time');
    expect(msg.body).toContain('4');
  });

  it('announces the long break', () => {
    expect(describePomodoroPhase('longBreak').title).toBe('Long break');
  });
});
