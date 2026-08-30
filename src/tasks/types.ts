import type { EventColor } from '../calendar/types';

export type Priority = 'low' | 'medium' | 'high';

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  priority: Priority;
  category?: string;
  color: EventColor;
  /** ISO date-time, optional — a due date/time */
  dueDate?: string;
  /** Rough duration estimate in minutes */
  estimatedMinutes?: number;
  subtasks: Subtask[];
  /** Set when the task has been scheduled onto the calendar */
  eventId?: string;
}
