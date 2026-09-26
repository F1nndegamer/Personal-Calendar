/**
 * Password lock for the browser-facing API (app → Google, storage, ICS).
 *
 * The frontend is a static page served by Nginx, so the password can never
 * travel *to* the browser: it lives only in the server's `APP_PASSWORD`
 * environment variable. Unlocking exchanges it for a random session token that
 * the browser keeps in an `HttpOnly` cookie ("remember this browser"), and
 * every browser route then requires that cookie.
 *
 * Design notes:
 *   - DISABLED when `APP_PASSWORD` is unset, so a default deployment behaves
 *     exactly as before and nothing locks itself out by accident.
 *   - Only sha256 digests of session tokens are persisted, next to the other
 *     state (`access-sessions.json`, mode 0600). A leaked file cannot be
 *     replayed as a cookie, and a leaked *cookie* is useless without it.
 *   - Sessions are fingerprinted with the password, so changing
 *     `APP_PASSWORD` logs every browser out — the intended way to rotate.
 *   - Machine-to-machine routes (`/api/webhook/*`, `/api/v1/*`) and the Google
 *     OAuth callback are exempt: they authenticate with their own Bearer token,
 *     or arrive as a cross-site navigation that carries no cookie (SameSite).
 *   - Failed attempts are throttled per IP so the public endpoint cannot be
 *     brute-forced.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
/** Cookie carrying the session token. `HttpOnly` keeps it away from scripts. */
export const UNLOCK_COOKIE = 'pc_unlock';
/** How long one unlock lasts — the "fill it in once per browser" promise. */
export const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
/** Cap on remembered browsers; the oldest session is dropped beyond this. */
const MAX_SESSIONS = 50;
/** Failed attempts per IP before a block is applied. */
const MAX_FAILURES = 8;
/** Window those failures are counted in. */
const FAILURE_WINDOW_MS = 15 * 60_000;
/** How long a block lasts after too many failures. */
const BLOCK_MS = 5 * 60_000;
/** Paths that stay reachable without a session (see the module comment). */
const PUBLIC_PATHS = new Set(['/api/session', '/api/unlock', '/api/lock']);
/** Prefixes that authenticate with their own Bearer token instead. */
const TOKEN_PATHS = ['/api/webhook/', '/api/v1/'];
// ------------------------------------------------------------------ password
/** True when a password is configured (the lock is active). */
export function accessEnabled() {
    const password = process.env.APP_PASSWORD;
    return typeof password === 'string' && password.length > 0;
}
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
/** Short digest of the configured password, used to invalidate old sessions. */
function passwordFingerprint() {
    return sha256(process.env.APP_PASSWORD ?? '').slice(0, 16);
}
/**
 * Constant-time password comparison. Both sides are hashed first so neither
 * the length nor the difference leaks through timing.
 */
export function verifyPassword(provided) {
    const expected = process.env.APP_PASSWORD;
    if (typeof provided !== 'string' || !expected)
        return false;
    return timingSafeEqual(Buffer.from(sha256(provided), 'hex'), Buffer.from(sha256(expected), 'hex'));
}
// ------------------------------------------------------------------- storage
function sessionsPath() {
    const storage = process.env.STORAGE_PATH || '/var/lib/personal-calendar/data.json';
    return join(dirname(resolve(storage)), 'access-sessions.json');
}
function readSessions() {
    const empty = { fingerprint: '', sessions: [] };
    try {
        const path = sessionsPath();
        if (!existsSync(path))
            return empty;
        const parsed = JSON.parse(readFileSync(path, 'utf-8'));
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.sessions))
            return empty;
        return {
            fingerprint: typeof parsed.fingerprint === 'string' ? parsed.fingerprint : '',
            sessions: parsed.sessions.filter((s) => !!s &&
                typeof s === 'object' &&
                typeof s.hash === 'string' &&
                typeof s.expiresAt === 'number'),
        };
    }
    catch {
        return empty;
    }
}
function writeSessions(data) {
    const path = sessionsPath();
    const dir = dirname(resolve(path));
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), { encoding: 'utf-8', mode: 0o600 });
    try {
        renameSync(tmp, path);
    }
    catch {
        writeFileSync(path, JSON.stringify(data), { encoding: 'utf-8', mode: 0o600 });
    }
    try {
        chmodSync(path, 0o600);
    }
    catch {
        /* ignore */
    }
}
// ------------------------------------------------------------------ sessions
/** Mint a session token for a just-verified password. Persisted, not in memory. */
export function issueSession(now = Date.now()) {
    const token = randomBytes(32).toString('base64url');
    const fingerprint = passwordFingerprint();
    const stored = readSessions();
    const sessions = [
        ...stored.sessions.filter((s) => s.expiresAt > now),
        { hash: sha256(token), expiresAt: now + SESSION_TTL_MS },
    ].slice(-MAX_SESSIONS);
    writeSessions({ fingerprint, sessions });
    return token;
}
/** Whether a cookie value is a live session for the current password. */
export function sessionValid(token, now = Date.now()) {
    if (!token)
        return false;
    const stored = readSessions();
    // A different password (or the lock being turned off) invalidates the file.
    if (stored.fingerprint !== passwordFingerprint())
        return false;
    const hash = sha256(token);
    return stored.sessions.some((s) => s.hash === hash && s.expiresAt > now);
}
/** Drop every session (locks all browsers out). */
export function clearSessions() {
    writeSessions({ fingerprint: passwordFingerprint(), sessions: [] });
}
// -------------------------------------------------------------------- cookies
/** Read the session token out of a raw `Cookie` header. */
export function readUnlockCookie(header) {
    if (!header)
        return null;
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq === -1)
            continue;
        if (part.slice(0, eq).trim() !== UNLOCK_COOKIE)
            continue;
        const value = part.slice(eq + 1).trim();
        return value.length > 0 ? value : null;
    }
    return null;
}
/** `Set-Cookie` value that remembers this browser. */
export function unlockCookieHeader(token, secure) {
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    return [
        `${UNLOCK_COOKIE}=${token}`,
        'Path=/',
        `Max-Age=${maxAge}`,
        'HttpOnly',
        'SameSite=Strict',
        secure ? 'Secure' : '',
    ]
        .filter(Boolean)
        .join('; ');
}
/** `Set-Cookie` value that forgets this browser. */
export function clearCookieHeader(secure) {
    return [
        `${UNLOCK_COOKIE}=`,
        'Path=/',
        'Max-Age=0',
        'HttpOnly',
        'SameSite=Strict',
        secure ? 'Secure' : '',
    ]
        .filter(Boolean)
        .join('; ');
}
// -------------------------------------------------------------------- routing
/** Routes that must answer without a session. */
export function requiresUnlock(path) {
    if (PUBLIC_PATHS.has(path))
        return false;
    // Google redirects back from accounts.google.com as a top-level navigation;
    // a SameSite=Strict cookie is not sent on that hop.
    if (path === '/api/google/callback')
        return false;
    // Machines (ESP32 display, task webhook) authenticate with their own token.
    if (TOKEN_PATHS.some((prefix) => path.startsWith(prefix)))
        return false;
    return true;
}
const failures = new Map();
/** Best-effort client IP from the proxy headers Nginx sets. */
export function clientIp(req) {
    const headers = req.headers;
    const forwarded = headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    const real = headers['x-real-ip'];
    const realIp = (Array.isArray(real) ? real[0] : real)?.trim();
    return first || realIp || req.socket?.remoteAddress || 'unknown';
}
/** Whether this IP is currently blocked out of trying passwords. */
export function isThrottled(ip, now = Date.now()) {
    const state = failures.get(ip);
    return !!state && state.blockedUntil > now;
}
/** Count a wrong password; blocks the IP once it crosses {@link MAX_FAILURES}. */
export function recordFailure(ip, now = Date.now()) {
    const state = failures.get(ip);
    if (!state || now - state.since > FAILURE_WINDOW_MS) {
        failures.set(ip, { since: now, count: 1, blockedUntil: 0 });
        return;
    }
    state.count += 1;
    if (state.count >= MAX_FAILURES)
        state.blockedUntil = now + BLOCK_MS;
}
/** Forget an IP's failures (successful unlock). */
export function clearFailures(ip) {
    failures.delete(ip);
}
/** Test hook — drops in-memory throttling state. */
export function resetThrottle() {
    failures.clear();
}
