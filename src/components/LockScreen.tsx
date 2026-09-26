import { useCallback, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { unlock } from '../access';

interface LockScreenProps {
  /** Called after the server accepted the password. */
  onUnlocked: () => void;
}

/**
 * The password prompt shown instead of the calendar.
 *
 * Deliberately plain: it is the only thing a locked browser can see, so it
 * gives away nothing (no version, no data) beyond the fact that the app
 * exists. Focus moves to the field on mount and returns there after a wrong
 * password, and the message doubles as an `aria-live` announcement.
 */
export function LockScreen({ onUnlocked }: LockScreenProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(undefined);
      const result = await unlock(password);
      setBusy(false);
      setPassword('');
      inputRef.current?.focus();
      if (result.ok) {
        onUnlocked();
        return;
      }
      setError(result.error ?? 'Incorrect password');
    },
    [busy, onUnlocked, password],
  );

  return (
    <div className="lock-screen">
      <form className="lock-card" onSubmit={submit}>
        <div className="lock-icon" aria-hidden="true">
          <Lock size={22} strokeWidth={2} />
        </div>
        <h1 className="lock-title">Personal Calendar</h1>
        <p className="lock-sub">This calendar is locked.</p>

        <label className="lock-label" htmlFor="lock-password">
          Password
        </label>
        <input
          id="lock-password"
          ref={inputRef}
          className="lock-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          disabled={busy}
          aria-invalid={error !== undefined}
          aria-describedby={error ? 'lock-error' : undefined}
        />
        <p className="lock-error" id="lock-error" role="status" aria-live="polite">
          {error ?? ''}
        </p>

        <button className="btn primary lock-submit" type="submit" disabled={busy || password === ''}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        <p className="lock-hint">Unlocking is remembered in this browser.</p>
      </form>
    </div>
  );
}
