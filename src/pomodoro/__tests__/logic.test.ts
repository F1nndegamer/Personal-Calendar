import { describe, expect, it } from 'vitest';
import {
  advancePhase,
  DEFAULT_CONFIG,
  nextPhaseAfterWork,
  phaseDuration,
  SECS_PER_MIN,
  tick,
} from '../logic';
import type { PomodoroConfig, PomodoroState } from '../types';

describe('pomodoro/logic', () => {
  describe('phaseDuration', () => {
    it('returns work duration for work phase', () => {
      expect(phaseDuration('work', DEFAULT_CONFIG)).toBe(25 * SECS_PER_MIN);
    });
    it('returns short break for shortBreak phase', () => {
      expect(phaseDuration('shortBreak', DEFAULT_CONFIG)).toBe(5 * SECS_PER_MIN);
    });
    it('returns long break for longBreak phase', () => {
      expect(phaseDuration('longBreak', DEFAULT_CONFIG)).toBe(15 * SECS_PER_MIN);
    });
  });

  describe('nextPhaseAfterWork', () => {
    it('gives a short break for non-multiple sessions', () => {
      expect(nextPhaseAfterWork(0, DEFAULT_CONFIG)).toBe('shortBreak');
      expect(nextPhaseAfterWork(1, DEFAULT_CONFIG)).toBe('shortBreak');
      expect(nextPhaseAfterWork(2, DEFAULT_CONFIG)).toBe('shortBreak');
    });
    it('gives a long break every Nth session', () => {
      // completedSessions is 0-indexed; the 4th completed work session (index 3)
      // triggers the long break when sessionsUntilLongBreak is 4.
      expect(nextPhaseAfterWork(3, DEFAULT_CONFIG)).toBe('longBreak');
    });
    it('respects a custom long-break cadence', () => {
      const cfg: PomodoroConfig = { ...DEFAULT_CONFIG, sessionsUntilLongBreak: 2 };
      expect(nextPhaseAfterWork(0, cfg)).toBe('shortBreak');
      expect(nextPhaseAfterWork(1, cfg)).toBe('longBreak');
      expect(nextPhaseAfterWork(2, cfg)).toBe('shortBreak');
    });
  });

  describe('tick', () => {
    const state: PomodoroState = {
      phase: 'work',
      secondsLeft: 30,
      completedSessions: 0,
      running: true,
    };
    it('decrements secondsLeft by one', () => {
      expect(tick(state).secondsLeft).toBe(29);
    });
    it('does nothing at zero', () => {
      const atZero = { ...state, secondsLeft: 0 };
      expect(tick(atZero).secondsLeft).toBe(0);
    });
    it('does not alter phase or completedSessions', () => {
      const ticked = tick(state);
      expect(ticked.phase).toBe('work');
      expect(ticked.completedSessions).toBe(0);
      expect(ticked.running).toBe(true);
    });
  });

  describe('advancePhase', () => {
    const cfg = DEFAULT_CONFIG;

    describe('from work', () => {
      it('increments completedSessions and goes to short break when not at cadence', () => {
        const result = advancePhase(
          { phase: 'work', secondsLeft: 0, completedSessions: 0, running: true },
          cfg,
        );
        expect(result.phase).toBe('shortBreak');
        expect(result.completedSessions).toBe(1);
        expect(result.secondsLeft).toBe(cfg.shortBreakSeconds);
      });
      it('goes to long break at the long-break cadence', () => {
        const result = advancePhase(
          { phase: 'work', secondsLeft: 0, completedSessions: 3, running: true },
          cfg,
        );
        expect(result.phase).toBe('longBreak');
        expect(result.completedSessions).toBe(4);
        expect(result.secondsLeft).toBe(cfg.longBreakSeconds);
      });
    });

    describe('from short break', () => {
      it('returns to work with the configured work duration', () => {
        const result = advancePhase(
          { phase: 'shortBreak', secondsLeft: 0, completedSessions: 2, running: true },
          cfg,
        );
        expect(result.phase).toBe('work');
        expect(result.secondsLeft).toBe(cfg.workSeconds);
        // Sessions don't increment on break->work
        expect(result.completedSessions).toBe(2);
      });
    });

    describe('from long break', () => {
      it('returns to work', () => {
        const result = advancePhase(
          { phase: 'longBreak', secondsLeft: 0, completedSessions: 4, running: true },
          cfg,
        );
        expect(result.phase).toBe('work');
        expect(result.secondsLeft).toBe(cfg.workSeconds);
        expect(result.completedSessions).toBe(4);
      });
    });

    describe('autoStartNext', () => {
      it('sets running=true when autoStartNext is true', () => {
        const cfgAuto: PomodoroConfig = { ...cfg, autoStartNext: true };
        expect(
          advancePhase({ phase: 'work', secondsLeft: 0, completedSessions: 0, running: true }, cfgAuto).running,
        ).toBe(true);
      });
      it('sets running=false when autoStartNext is false', () => {
        const cfgManual: PomodoroConfig = { ...cfg, autoStartNext: false };
        expect(
          advancePhase({ phase: 'work', secondsLeft: 0, completedSessions: 0, running: true }, cfgManual).running,
        ).toBe(false);
      });
    });
  });

  describe('DEFAULT_CONFIG constants', () => {
    it('uses a 25/5/15 minute default cadence', () => {
      expect(DEFAULT_CONFIG.workSeconds).toBe(25 * 60);
      expect(DEFAULT_CONFIG.shortBreakSeconds).toBe(5 * 60);
      expect(DEFAULT_CONFIG.longBreakSeconds).toBe(15 * 60);
      expect(DEFAULT_CONFIG.sessionsUntilLongBreak).toBe(4);
      expect(DEFAULT_CONFIG.autoStartNext).toBe(true);
    });
  });
});
