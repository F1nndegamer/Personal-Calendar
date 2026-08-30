export type EventColor = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'cyan';

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  /** ISO date-time */
  start: string;
  /** ISO date-time */
  end: string;
  color: EventColor;
  /** Category/subject label, e.g. "School", "Work" */
  category?: string;
  /** Set when the event was created from (or linked to) a task */
  taskId?: string;
  /**
   * Where this event came from. 'local' (or undefined) = created in-app;
   * 'external' = imported from a schedule provider.
   */
  source?: 'local' | 'external';
  /**
   * Stable identifier from the external provider, unique per provider
   * (convention: "<providerId>:<external id>"). Only set for imported events.
   */
  externalId?: string;
  /** ISO date-time of the last external sync that touched this event */
  lastSyncedAt?: string;
  /**
   * Reserved for future recurring-event support. Not implemented yet.
   * e.g. 'weekly' | 'weekdays' | RRULE string
   */
  recurrence?: string;
}

export type CalendarView = 'day' | 'week';
