/**
 * Structured result of parsing a quick-add input string.
 *
 * The parser is pure: it returns data only. The App layer decides what to do
 * with it (e.g. create a Task). This keeps parsing testable and decoupled
 * from React state.
 */
export interface ParsedQuickAdd {
  /** Title text remaining after date/time/duration tokens are extracted. */
  title: string;
  /**
   * ISO date-time string for the due date. Set when a date token (today,
   * tomorrow, next week) and/or a time token (HH:MM) is found. When only a
   * time is given the date defaults to today.
   */
  dueDate?: string;
  /** Duration estimate in minutes, when a duration token was found. */
  estimatedMinutes?: number;
}
