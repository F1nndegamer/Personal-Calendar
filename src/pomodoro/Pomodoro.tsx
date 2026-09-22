import { useCallback, useEffect, useState } from 'react';
import type { PomodoroConfig, PomodoroState, TimerPhase } from './types';
import {
  advancePhase,
  DEFAULT_CONFIG,
  PHASE_LABELS,
  phaseDuration,
  SECS_PER_MIN,
  tick,
} from './logic';
import { describePomodoroPhase, notify } from '../notifications/notify';

const STORAGE_KEY = 'calendar-app/pomodoro';

/** Load persisted state; fall back to a fresh work-phase start. */
function loadState(): PomodoroState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as Partial<PomodoroState>;
    return {
      phase: parsed.phase ?? 'work',
      secondsLeft:
        typeof parsed.secondsLeft === 'number' && parsed.secondsLeft > 0
          ? parsed.secondsLeft
          : phaseDuration(parsed.phase ?? 'work', DEFAULT_CONFIG),
      completedSessions: parsed.completedSessions ?? 0,
      running: parsed.running ?? false,
    };
  } catch {
    return freshState();
  }
}

function freshState(phase: TimerPhase = 'work', completed = 0): PomodoroState {
  return {
    phase,
    secondsLeft: phaseDuration(phase, DEFAULT_CONFIG),
    completedSessions: completed,
    running: false,
  };
}

function saveState(state: PomodoroState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore — quota / unavailable */
  }
}

/** Format seconds as MM:SS. */
function formatTime(secs: number): string {
  const m = Math.floor(secs / SECS_PER_MIN);
  const s = secs % SECS_PER_MIN;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const PHASE_OPTIONS: { value: TimerPhase; label: string }[] = [
  { value: 'work', label: 'Focus' },
  { value: 'shortBreak', label: 'Short' },
  { value: 'longBreak', label: 'Long' },
];

export function Pomodoro() {
  const [state, setState] = useState<PomodoroState>(() => loadState());
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [showConfig, setShowConfig] = useState(false);

  const apply = useCallback((updater: (s: PomodoroState) => PomodoroState) => {
    setState((prev) => {
      const next = updater(prev);
      saveState(next);
      return next;
    });
  }, []);

  // Tick every second while running. When a phase completes, fire a
  // notification (if enabled) so breaks/focus starts are not missed while
  // the tab is in the background.
  useEffect(() => {
    if (!state.running) return;
    const id = setInterval(() => {
      apply((s) => {
        if (s.secondsLeft <= 1) {
          const next = advancePhase(s, config);
          if (next.phase !== s.phase) {
            const m = describePomodoroPhase(next.phase, s.completedSessions);
            notify(m.title, m.body, `pomodoro-${next.phase}`);
          }
          return next;
        }
        return tick(s);
      });
    }, 1000);
    return () => clearInterval(id);
  }, [state.running, state.secondsLeft, config, apply]);

  const toggleRunning = () => apply((s) => ({ ...s, running: !s.running }));
  const reset = () => apply(() => freshState(state.phase, state.completedSessions));
  const skip = () => apply((s) => advancePhase(s, config));
  const setPhase = (phase: TimerPhase) =>
    apply(() => freshState(phase, state.completedSessions));

  const progressPct = (state.secondsLeft / phaseDuration(state.phase, config)) * 100;

  const handleConfigChange = (field: keyof PomodoroConfig) => (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const num = Number(e.target.value);
    setConfig((c) => ({
      ...c,
      [field]: Number.isNaN(num) || num < 0 ? 0 : num,
    }));
  };

  return (
    <div className="pomodoro">
      <div className="pomodoro-card">
        <div className="pomodoro-header">
          <select
            className="pomodoro-phase"
            value={state.phase}
            onChange={(e) => setPhase(e.target.value as TimerPhase)}
            aria-label="Timer phase"
          >
            {PHASE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <span
            className="pomodoro-sessions"
            title={`${state.completedSessions} completed focus sessions`}
          >
            {state.completedSessions}✓
          </span>
        </div>

        <div className="pomodoro-timer" aria-label="Time remaining">
          <span className="pomodoro-time">{formatTime(state.secondsLeft)}</span>
          <div className="pomodoro-progress" aria-hidden="true">
            <div className="pomodoro-progress-fill" style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }} />
          </div>
        </div>

        <div className="pomodoro-phase-name">{PHASE_LABELS[state.phase]}</div>

        <div className="pomodoro-controls">
          <button className="btn primary pomodoro-btn" onClick={toggleRunning} aria-label={state.running ? 'Pause' : 'Start'}>
            {state.running ? '⏸' : '▶'}
          </button>
          <button className="btn pomodoro-btn" onClick={reset} aria-label="Reset">↺</button>
          <button className="btn pomodoro-btn" onClick={skip} aria-label="Skip">⏭</button>
        </div>

        <button
          className="btn subtle pomodoro-config-btn"
          onClick={() => setShowConfig((v) => !v)}
          aria-expanded={showConfig}
        >
          {showConfig ? 'Hide' : 'Configure'}
        </button>

        {showConfig && (
          <div className="pomodoro-config">
            <label className="field">
              <span>Focus (min)</span>
              <input
                type="number" min="1" max="120"
                value={Math.round(config.workSeconds / SECS_PER_MIN)}
                onChange={handleConfigChange('workSeconds')}
              />
            </label>
            <label className="field">
              <span>Short break (min)</span>
              <input
                type="number" min="1" max="30"
                value={Math.round(config.shortBreakSeconds / SECS_PER_MIN)}
                onChange={handleConfigChange('shortBreakSeconds')}
              />
            </label>
            <label className="field">
              <span>Long break (min)</span>
              <input
                type="number" min="1" max="60"
                value={Math.round(config.longBreakSeconds / SECS_PER_MIN)}
                onChange={handleConfigChange('longBreakSeconds')}
              />
            </label>
            <label className="field">
              <span>Long break every</span>
              <input
                type="number" min="1" max="20"
                value={config.sessionsUntilLongBreak}
                onChange={handleConfigChange('sessionsUntilLongBreak')}
              />
            </label>
            <label className="field">
              <span>
                <input
                  type="checkbox"
                  checked={config.autoStartNext}
                  onChange={(e) => setConfig((c) => ({ ...c, autoStartNext: e.target.checked }))}
                />
                Auto-start next
              </span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
