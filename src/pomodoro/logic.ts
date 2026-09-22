/**
 * Pure (side-effect-free) Pomodoro state logic.
 *
 * Keeping the reducer here — separate from React — lets us unit-test the
 * timer transitions without a DOM or timers.
 */
import type { PomodoroConfig, PomodoroState, TimerPhase } from './types';

/** Seconds in a minute. */
export const SECS_PER_MIN = 60;

/** Default durations (in seconds). */
export const DEFAULT_WORK_SECS = 25 * SECS_PER_MIN;
export const DEFAULT_SHORT_BREAK_SECS = 5 * SECS_PER_MIN;
export const DEFAULT_LONG_BREAK_SECS = 15 * SECS_PER_MIN;
/** Completed work sessions required before a long break. */
export const DEFAULT_LONG_BREAK_EVERY = 4;

export const DEFAULT_CONFIG: PomodoroConfig = {
  workSeconds: DEFAULT_WORK_SECS,
  shortBreakSeconds: DEFAULT_SHORT_BREAK_SECS,
  longBreakSeconds: DEFAULT_LONG_BREAK_SECS,
  sessionsUntilLongBreak: DEFAULT_LONG_BREAK_EVERY,
  autoStartNext: true,
};

export const PHASES: TimerPhase[] = ['work', 'shortBreak', 'longBreak'];

export const PHASE_LABELS: Record<TimerPhase, string> = {
  work: 'Focus',
  shortBreak: 'Short break',
  longBreak: 'Long break',
};

/** Seconds in the given phase for the supplied config. */
export function phaseDuration(phase: TimerPhase, cfg: PomodoroConfig): number {
  switch (phase) {
    case 'work':
      return cfg.workSeconds;
    case 'shortBreak':
      return cfg.shortBreakSeconds;
    case 'longBreak':
      return cfg.longBreakSeconds;
  }
}

/**
 * Which phase follows a *completed work session*, based on how many work
 * sessions have finished so far. Every Nth session earns a long break.
 */
export function nextPhaseAfterWork(
  completedSessions: number,
  cfg: PomodoroConfig,
): TimerPhase {
  if ((completedSessions + 1) % cfg.sessionsUntilLongBreak === 0) {
    return 'longBreak';
  }
  return 'shortBreak';
}

/**
 * Advance state by one second (tick). Clamps at zero — it never goes negative;
 * the phase transition is handled by `advancePhase` when a phase completes.
 */
export function tick(state: PomodoroState): PomodoroState {
  if (state.secondsLeft <= 0) return state;
  return { ...state, secondsLeft: state.secondsLeft - 1 };
}

/**
 * Transition to the next phase after a phase completes.
 *
 * Work → short/long break (incrementing the completed-session counter).
 * Short/long break → back to work.
 */
export function advancePhase(state: PomodoroState, cfg: PomodoroConfig): PomodoroState {
  if (state.phase === 'work') {
    const completedSessions = state.completedSessions + 1;
    const phase = nextPhaseAfterWork(state.completedSessions, cfg);
    return {
      phase,
      secondsLeft: phaseDuration(phase, cfg),
      completedSessions,
      running: cfg.autoStartNext,
    };
  }
  return {
    phase: 'work',
    secondsLeft: phaseDuration('work', cfg),
    completedSessions: state.completedSessions,
    running: cfg.autoStartNext,
  };
}

/** Whether the timer is currently counting down. */
export function isRunning(state: PomodoroState): boolean {
  return state.running;
}

/** Whether the timer should be considered "expired" (at zero, not running). */
export function isExpired(state: PomodoroState): boolean {
  return state.secondsLeft === 0 && !state.running;
}
