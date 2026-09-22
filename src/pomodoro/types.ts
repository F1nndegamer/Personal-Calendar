/**
 * Type interfaces for the Pomodoro timer.
 */

export type TimerPhase = 'work' | 'shortBreak' | 'longBreak';

export interface PomodoroState {
  phase: TimerPhase;
  /** Seconds remaining in the current phase. */
  secondsLeft: number;
  /** Completed work sessions (drives the long-break cadence). */
  completedSessions: number;
  /** Whether the timer is actively ticking. */
  running: boolean;
}

export interface PomodoroConfig {
  workSeconds: number;
  shortBreakSeconds: number;
  longBreakSeconds: number;
  sessionsUntilLongBreak: number;
  autoStartNext: boolean;
}

