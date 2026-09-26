/**
 * Password lock (browser side). See `server/access.ts` for the server half.
 *
 * The password is never held in the bundle: the app asks the server whether a
 * password is configured (`GET /api/session`) and posts the typed password to
 * `POST /api/unlock`, which answers with an `HttpOnly` session cookie. The
 * browser then sends that cookie by itself, which is what makes this a
 * "fill it in once per browser" experience rather than a per-reload prompt.
 */
export interface AccessSession {
  /** The server has a password configured. */
  required: boolean;
  /** This browser holds a valid session cookie. */
  unlocked: boolean;
}

const SESSION_URL = '/api/session';
const UNLOCK_URL = '/api/unlock';
const LOCK_URL = '/api/lock';

const TIMEOUT_MS = 8000;

/** Last known session state, so Settings can offer "Lock" without a request. */
let cached: AccessSession | null = null;

/** The session state as of the last successful check (null before that). */
export function cachedSession(): AccessSession | null {
  return cached;
}

function remember(session: AccessSession): AccessSession {
  cached = session;
  return session;
}

/**
 * Ask the server for the lock state. Returns null when it cannot be reached —
 * callers decide what to do (see `AppGate`, which fails open so an offline
 * user can still work with the localStorage copy of their calendar).
 */
export async function fetchSession(): Promise<AccessSession | null> {
  try {
    const res = await fetch(SESSION_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<AccessSession>;
    return remember({ required: data.required === true, unlocked: data.unlocked === true });
  } catch {
    return null;
  }
}

export interface UnlockResult {
  ok: boolean;
  /** Message to show under the field (server-provided when available). */
  error?: string;
  /** True when the server has no password configured at all. */
  notRequired?: boolean;
}

/** Exchange a typed password for a session cookie. Never throws. */
export async function unlock(password: string): Promise<UnlockResult> {
  try {
    const res = await fetch(UNLOCK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      required?: boolean;
    };
    if (res.ok && data.ok) {
      remember({ required: data.required !== false, unlocked: true });
      return { ok: true, notRequired: data.required === false };
    }
    if (res.status === 429) return { ok: false, error: 'Too many attempts — wait a few minutes.' };
    return { ok: false, error: data.error ?? 'Incorrect password' };
  } catch {
    return { ok: false, error: 'Could not reach the server' };
  }
}

/** Forget this browser's session (Settings → Lock). Never throws. */
export async function lockNow(): Promise<void> {
  cached = null;
  try {
    await fetch(LOCK_URL, { method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    /* The cookie expires on its own; nothing else to do here. */
  }
}
