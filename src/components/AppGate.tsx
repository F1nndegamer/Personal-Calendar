import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchSession } from '../access';
import { LockScreen } from './LockScreen';

interface AppGateProps {
  /** The app itself — only mounted once the browser is allowed in. */
  children: ReactNode;
}

/**
 * Password gate in front of the whole app.
 *
 * While locked, `<App />` is never mounted, so nothing of it runs: no schedule
 * sync, no Google push, no storage reads. That is the point of gating here
 * rather than inside App — an unmounted app cannot leak anything through the
 * network either.
 *
 * Two deliberate choices:
 *   - **Fails open.** If `GET /api/session` cannot be reached (server asleep,
 *     phone offline) the app is shown, because the calendar still works from
 *     the localStorage copy in that situation. The password protects the
 *     server data, not the device cache.
 *   - **Re-checks on focus.** A session can expire or be revoked in another
 *     tab while this one sits open, so returning to the tab re-asks.
 */
export function AppGate({ children }: AppGateProps) {
  const [state, setState] = useState<'checking' | 'locked' | 'ready'>('checking');

  // Unknown session (server unreachable) counts as "allowed" — see the note
  // about failing open above.
  const apply = useCallback((session: Awaited<ReturnType<typeof fetchSession>>) => {
    setState(!session || !session.required || session.unlocked ? 'ready' : 'locked');
  }, []);

  const check = useCallback(async () => {
    apply(await fetchSession());
  }, [apply]);

  useEffect(() => {
    // Ask the server once on mount. The state update lands in the promise
    // callback (never synchronously in the effect body) and is dropped if the
    // gate unmounts in the meantime.
    let cancelled = false;
    void fetchSession().then((session) => {
      if (cancelled) return;
      apply(session);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [check]);

  if (state === 'checking') {
    return (
      <div className="lock-screen">
        <div className="lock-card" aria-busy="true">
          <p className="lock-sub">Checking…</p>
        </div>
      </div>
    );
  }

  if (state === 'locked') {
    return <LockScreen onUnlocked={() => setState('ready')} />;
  }

  return <>{children}</>;
}
