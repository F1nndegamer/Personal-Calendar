import { GOOGLE_SCOPES } from './googleTypes.js';
import { readGoogleAuth, rememberOAuthState, consumeOAuthState, writeGoogleAuth, } from './googleStore.js';
import { buildAuthUrl, createGoogleEvent, exchangeCode, fetchAccountEmail, isAuthError, listAllEvents, listCalendars, refreshAccessToken, revokeToken, toGoogleEventBody, } from './googleOAuth.js';
import { mapCalendarEntryToRef, isWritableRole, mapGoogleEventToExternal, } from './googleApi.js';
import { parsePushBody, pushErrorSummary, pushResponse, sweepOwnCopies, syncPushedEvents, } from './googlePush.js';
/** Single-flight guard: one push run at a time (multi-tab safety). */
let pushInFlight = false;
/** Test hook — simulates a running push (should stay false otherwise). */
export function setPushInFlight(value) {
    pushInFlight = value;
}
function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
}
function text(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(body);
}
export function isGooglePath(url) {
    const path = url.split('?')[0];
    return path === '/api/google/status' || path === '/api/google/login' ||
        path === '/api/google/callback' || path === '/api/google/logout' ||
        path === '/api/google/selection' || path === '/api/google/events' ||
        path === '/api/google/push' || path === '/api/google/push-target';
}
function googleConfig() {
    const clientId = (process.env.GOOGLE_CLIENT_ID ?? '').trim();
    const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? '').trim();
    const redirectUri = (process.env.GOOGLE_REDIRECT_URI ?? '').trim();
    if (!clientId || !clientSecret || !redirectUri)
        return null;
    return { clientId, clientSecret, redirectUri };
}
function frontendBase(req) {
    const proto = req.headers['x-forwarded-proto']?.split(',')[0]?.trim() || 'http';
    const host = req.headers['x-forwarded-host']?.split(',')[0]?.trim() ||
        req.headers.host || 'localhost';
    return `${proto}://${host}`;
}
function readJsonBody(req, limit = 16 * 1024) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString();
            if (body.length > limit) {
                req.destroy();
                reject(new Error('Body too large'));
            }
        });
        req.on('end', () => {
            try {
                resolve(body.length === 0 ? {} : JSON.parse(body));
            }
            catch {
                reject(new Error('Body must be valid JSON'));
            }
        });
        req.on('error', reject);
    });
}
async function validAccessToken(auth, config, writeAuth, fetchImpl) {
    const tokens = auth.tokens;
    if (!tokens)
        return null;
    if (tokens.expiresAt - Date.now() > 60_000)
        return tokens.accessToken;
    if (!tokens.refreshToken)
        return tokens.accessToken;
    try {
        const r = await refreshAccessToken(config, tokens.refreshToken, fetchImpl);
        const next = {
            ...auth,
            tokens: {
                accessToken: r.access_token, expiresAt: Date.now() + r.expires_in * 1000,
                refreshToken: r.refresh_token ?? tokens.refreshToken,
                scope: r.scope ?? tokens.scope, tokenType: r.token_type ?? tokens.tokenType,
            },
        };
        writeAuth(next);
        return next.tokens.accessToken;
    }
    catch {
        return null;
    }
}
async function buildStatus(config, auth, writeAuth, fetchImpl) {
    if (!auth.tokens)
        return { connected: false, calendars: [], selectedCalendarIds: [] };
    const accessToken = await validAccessToken(auth, config, writeAuth, fetchImpl);
    if (!accessToken) {
        return {
            connected: false, email: auth.email, calendars: [],
            selectedCalendarIds: auth.selectedCalendarIds ?? [],
            lastSyncAt: auth.lastSyncAt, error: 'Google session expired — please reconnect.',
            pushCalendarId: auth.pushCalendarId,
            lastPushAt: auth.lastPushAt,
            lastPushError: auth.lastPushError,
        };
    }
    try {
        const [entries, email] = await Promise.all([
            listCalendars(accessToken, fetchImpl),
            auth.email ? Promise.resolve(auth.email) : fetchAccountEmail(accessToken, fetchImpl),
        ]);
        const calendars = entries.map(mapCalendarEntryToRef);
        const primary = entries.find((e) => e.primary)?.id;
        const selected = (auth.selectedCalendarIds ?? (primary ? [primary] : []))
            .filter((id) => calendars.some((c) => c.id === id));
        return {
            connected: true, email: email ?? auth.email, calendars,
            selectedCalendarIds: selected, lastSyncAt: auth.lastSyncAt, error: auth.lastError,
            pushCalendarId: auth.pushCalendarId,
            lastPushAt: auth.lastPushAt,
            lastPushError: auth.lastPushError,
        };
    }
    catch (err) {
        return {
            connected: false, email: auth.email, calendars: [],
            selectedCalendarIds: auth.selectedCalendarIds ?? [],
            lastSyncAt: auth.lastSyncAt, error: err instanceof Error ? err.message : 'Google request failed',
        };
    }
}
function selectedCalendars(auth) {
    if (auth.selectedCalendarIds && auth.selectedCalendarIds.length > 0) {
        return auth.selectedCalendarIds.slice(0, 50);
    }
    return ['primary'];
}
export async function handleGoogleRequest(req, res, url, deps = {}) {
    const path = url.split('?')[0];
    if (!isGooglePath(url))
        return false;
    const readAuth = deps.readAuth ?? readGoogleAuth;
    const writeAuth = deps.writeAuth ?? writeGoogleAuth;
    const fetchImpl = deps.fetchImpl ?? fetch;
    const now = deps.now ?? Date.now;
    const config = googleConfig();
    if (!config) {
        if (path === '/api/google/status' && req.method === 'GET') {
            json(res, 200, {
                connected: false, calendars: [], selectedCalendarIds: [],
                error: 'Google integration is not configured on the server.',
            });
            return true;
        }
        text(res, 501, 'Google integration is not configured on the server');
        return true;
    }
    const qs = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '');
    if (path === '/api/google/status' && req.method === 'GET') {
        json(res, 200, await buildStatus(config, readAuth(), writeAuth, fetchImpl));
        return true;
    }
    if (path === '/api/google/login' && req.method === 'GET') {
        const { newOAuthState } = await import('./googleOAuth.js');
        const state = newOAuthState();
        rememberOAuthState(state, now());
        res.writeHead(302, { Location: buildAuthUrl(config, GOOGLE_SCOPES, state), 'Cache-Control': 'no-store' });
        res.end();
        return true;
    }
    if (path === '/api/google/callback' && req.method === 'GET') {
        const code = qs.get('code') ?? '';
        const state = qs.get('state') ?? '';
        const base = frontendBase(req);
        if (qs.get('error') || !code || !consumeOAuthState(state, now())) {
            res.writeHead(302, { Location: `${base}/?google=error`, 'Cache-Control': 'no-store' });
            res.end();
            return true;
        }
        try {
            const tokens = await exchangeCode(config, code, fetchImpl);
            let email;
            try {
                email = await fetchAccountEmail(tokens.access_token, fetchImpl);
            }
            catch {
                email = undefined;
            }
            const prev = readAuth();
            writeAuth({
                ...prev,
                tokens: {
                    accessToken: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000,
                    refreshToken: tokens.refresh_token ?? prev.tokens?.refreshToken,
                    scope: tokens.scope, tokenType: tokens.token_type,
                },
                email: email ?? prev.email, lastError: undefined,
            });
            res.writeHead(302, { Location: `${base}/?google=connected`, 'Cache-Control': 'no-store' });
            res.end();
        }
        catch {
            res.writeHead(302, { Location: `${base}/?google=error`, 'Cache-Control': 'no-store' });
            res.end();
        }
        return true;
    }
    if (path === '/api/google/logout' && req.method === 'POST') {
        const auth = readAuth();
        const access = auth.tokens?.accessToken;
        const refresh = auth.tokens?.refreshToken;
        // Keep the import selection and push mapping so a reconnect resumes
        // where we left off instead of re-importing / re-pushing everything.
        writeAuth({
            tokens: null, email: undefined,
            selectedCalendarIds: auth.selectedCalendarIds,
            pushCalendarId: auth.pushCalendarId,
            pushed: auth.pushed,
            lastPushAt: auth.lastPushAt,
            lastPushError: undefined,
        });
        void (async () => {
            try {
                if (access)
                    await revokeToken(access, fetchImpl);
                if (refresh)
                    await revokeToken(refresh, fetchImpl);
            }
            catch { /* ignore */ }
        })();
        json(res, 200, { ok: true });
        return true;
    }
    if (path === '/api/google/selection' && req.method === 'POST') {
        let parsed;
        try {
            parsed = await readJsonBody(req);
        }
        catch (e) {
            json(res, 400, { ok: false, error: e instanceof Error ? e.message : 'Bad request' });
            return true;
        }
        const ids = parsed.calendarIds;
        if (!Array.isArray(ids) || ids.length > 50 || ids.some((x) => typeof x !== 'string')) {
            json(res, 400, { ok: false, error: 'calendarIds must be an array of ≤50 strings' });
            return true;
        }
        writeAuth({ ...readAuth(), selectedCalendarIds: ids.map(String) });
        json(res, 200, { ok: true });
        return true;
    }
    if (path === '/api/google/events' && req.method === 'GET') {
        const auth0 = readAuth();
        const timeMin = qs.get('timeMin') ?? '';
        const timeMax = qs.get('timeMax') ?? '';
        if (!timeMin || !timeMax || Number.isNaN(new Date(timeMin).getTime()) ||
            Number.isNaN(new Date(timeMax).getTime())) {
            json(res, 400, { ok: false, error: 'timeMin/timeMax must be ISO date-times' });
            return true;
        }
        let accessToken = await validAccessToken(auth0, config, writeAuth, fetchImpl);
        if (!accessToken) {
            json(res, 401, { ok: false, error: 'Google is not connected' });
            return true;
        }
        const calendars = selectedCalendars(auth0);
        // Events we pushed to Google ourselves must never come back in as
        // imports (otherwise pushing into an imported calendar duplicates).
        const pushedExternal = new Set(Object.values(auth0.pushed ?? {}).map((p) => `${p.calendarId}:${p.eventId}`));
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const out = [];
                for (const calId of calendars) {
                    const raw = await listAllEvents(accessToken, calId, timeMin, timeMax, fetchImpl);
                    for (const ev of raw) {
                        const m = mapGoogleEventToExternal({
                            id: ev.id ?? '', summary: ev.summary, description: ev.description,
                            start: ev.start, end: ev.end, status: ev.status, updated: ev.updated,
                            extendedProperties: ev.extendedProperties,
                        }, calId);
                        // Skip our own copies (tagged with `pushTag`) and everything the
                        // mapping says we already pushed — both exist locally already.
                        if (m && !m.ownCopy && !pushedExternal.has(m.externalId))
                            out.push(m);
                    }
                }
                writeAuth({ ...readAuth(), lastSyncAt: Date.now(), lastError: undefined });
                json(res, 200, { ok: true, events: out });
                return true;
            }
            catch (err) {
                if (attempt === 0 && isAuthError(err) && auth0.tokens?.refreshToken) {
                    try {
                        const r = await refreshAccessToken(config, auth0.tokens.refreshToken, fetchImpl);
                        const next = {
                            ...auth0,
                            tokens: {
                                accessToken: r.access_token, expiresAt: Date.now() + r.expires_in * 1000,
                                refreshToken: r.refresh_token ?? auth0.tokens.refreshToken,
                                scope: r.scope ?? auth0.tokens.scope, tokenType: r.token_type ?? auth0.tokens.tokenType,
                            },
                        };
                        writeAuth(next);
                        accessToken = next.tokens?.accessToken ?? accessToken;
                        continue;
                    }
                    catch { /* fall through */ }
                }
                const msg = err instanceof Error ? err.message : 'Google request failed';
                writeAuth({ ...readAuth(), lastError: msg });
                const code = err?.googleApiError?.code;
                json(res, code === 429 ? 429 : 502, { ok: false, error: msg });
                return true;
            }
        }
        json(res, 502, { ok: false, error: 'Google request failed' });
        return true;
    }
    if (path === '/api/google/events' && req.method === 'POST') {
        let parsed;
        try {
            parsed = await readJsonBody(req);
        }
        catch (e) {
            json(res, 400, { ok: false, error: e instanceof Error ? e.message : 'Bad request' });
            return true;
        }
        const body = parsed;
        if (typeof body.title !== 'string' || body.title.trim().length === 0 ||
            typeof body.start !== 'string' || typeof body.end !== 'string' ||
            Number.isNaN(new Date(body.start).getTime()) || Number.isNaN(new Date(body.end).getTime())) {
            json(res, 400, { ok: false, error: 'title/start/end are required (ISO date-times)' });
            return true;
        }
        const auth = readAuth();
        const accessToken = await validAccessToken(auth, config, writeAuth, fetchImpl);
        if (!accessToken) {
            json(res, 401, { ok: false, error: 'Google is not connected' });
            return true;
        }
        const calendars = selectedCalendars(auth);
        const target = typeof body.calendarId === 'string' && calendars.includes(body.calendarId)
            ? body.calendarId : calendars[0] ?? 'primary';
        try {
            const id = await createGoogleEvent(accessToken, target, toGoogleEventBody({
                title: body.title.trim(), start: body.start, end: body.end,
                description: typeof body.description === 'string' ? body.description : undefined,
            }), fetchImpl);
            json(res, 201, { ok: true, id, calendarId: target });
        }
        catch (err) {
            json(res, 502, { ok: false, error: err instanceof Error ? err.message : 'Google request failed' });
        }
        return true;
    }
    if (path === '/api/google/push' && req.method === 'POST') {
        if (pushInFlight) {
            json(res, 429, { ok: false, error: 'A push is already in progress' });
            return true;
        }
        pushInFlight = true;
        try {
            let parsed;
            try {
                parsed = await readJsonBody(req, 512 * 1024);
            }
            catch (e) {
                json(res, 400, { ok: false, error: e instanceof Error ? e.message : 'Bad request' });
                return true;
            }
            const body = parsePushBody(parsed);
            if (!body.ok) {
                json(res, 400, { ok: false, error: body.error });
                return true;
            }
            const auth = readAuth();
            let accessToken = await validAccessToken(auth, config, writeAuth, fetchImpl);
            if (!accessToken) {
                json(res, 401, { ok: false, error: 'Google is not connected' });
                return true;
            }
            const existingPushed = auth.pushed ?? {};
            // Nothing to do: no events and nothing previously pushed.
            if (body.events.length === 0 && Object.keys(existingPushed).length === 0) {
                json(res, 200, pushResponse({ created: 0, updated: 0, deleted: 0, skipped: 0, errors: [] }));
                return true;
            }
            // Resolve + validate the target calendar (stored choice, else primary).
            let entries;
            try {
                entries = await listCalendars(accessToken, fetchImpl);
            }
            catch (err) {
                json(res, 502, { ok: false, error: err instanceof Error ? err.message : 'Google request failed' });
                return true;
            }
            const targetId = auth.pushCalendarId
                ?? entries.find((e) => e.primary)?.id
                ?? entries.find((e) => isWritableRole(e.accessRole))?.id
                ?? 'primary';
            const target = entries.find((e) => e.id === targetId);
            if (!target) {
                json(res, 400, { ok: false, error: 'The chosen push calendar no longer exists — pick another in Settings' });
                return true;
            }
            if (!isWritableRole(target.accessRole)) {
                json(res, 403, { ok: false, error: 'The push calendar is read-only — pick another in Settings' });
                return true;
            }
            let result;
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    result = await syncPushedEvents({
                        accessToken, calendarId: targetId, events: body.events,
                        pushed: existingPushed, fetchImpl,
                        // Persist progress batch by batch: a run that dies halfway (the
                        // 401 retry below, a dropped connection, a restart) must not lose
                        // the copies it already created — a retry would duplicate them.
                        persist: (pushed) => writeAuth({ ...readAuth(), pushed }),
                    });
                    break;
                }
                catch (err) {
                    if (attempt === 0 && isAuthError(err) && auth.tokens?.refreshToken) {
                        try {
                            const r = await refreshAccessToken(config, auth.tokens.refreshToken, fetchImpl);
                            writeAuth({
                                ...readAuth(),
                                tokens: {
                                    accessToken: r.access_token, expiresAt: Date.now() + r.expires_in * 1000,
                                    refreshToken: r.refresh_token ?? auth.tokens.refreshToken,
                                    scope: r.scope ?? auth.tokens.scope, tokenType: r.token_type ?? auth.tokens.tokenType,
                                },
                            });
                            accessToken = r.access_token;
                            continue;
                        }
                        catch { /* fall through to the error response below */ }
                    }
                    const msg = err instanceof Error ? err.message : 'Google request failed';
                    writeAuth({ ...readAuth(), lastPushError: msg });
                    json(res, 502, { ok: false, error: msg });
                    return true;
                }
            }
            if (!result) {
                json(res, 502, { ok: false, error: 'Google push failed' });
                return true;
            }
            const stats = result.stats;
            // Repair pass: copies of local events that an earlier — possibly failed —
            // push left behind in other imported calendars would come back as
            // duplicate imports, so they are removed once per push target (and again
            // after any failed push). Only provably-ours copies are touched; see
            // `sweepOwnCopies`.
            const shouldSweep = auth.sweepTarget !== targetId || auth.lastPushError != null;
            const sweepCalendars = shouldSweep
                ? (auth.selectedCalendarIds ?? []).filter((id) => id !== targetId &&
                    isWritableRole(entries.find((e) => e.id === id)?.accessRole))
                : [];
            const sweep = sweepCalendars.length > 0
                ? await sweepOwnCopies({
                    accessToken, pushCalendarId: targetId, calendarIds: sweepCalendars,
                    events: body.events, pushed: result.pushed, fetchImpl,
                })
                : undefined;
            // A sweep that failed is retried on the next push (no target recorded).
            const sweepDone = sweep !== undefined && sweep.errors.length === 0;
            writeAuth({
                ...readAuth(),
                pushed: result.pushed,
                pushCalendarId: targetId,
                lastPushAt: now(),
                lastPushError: pushErrorSummary(stats),
                ...(sweepDone ? { sweepTarget: targetId, sweepAt: now() } : {}),
            });
            json(res, 200, pushResponse(stats, sweep?.deleted ?? 0));
            return true;
        }
        finally {
            pushInFlight = false;
        }
    }
    if (path === '/api/google/push-target' && req.method === 'POST') {
        let parsed;
        try {
            parsed = await readJsonBody(req);
        }
        catch (e) {
            json(res, 400, { ok: false, error: e instanceof Error ? e.message : 'Bad request' });
            return true;
        }
        const calendarId = parsed.calendarId;
        if (typeof calendarId !== 'string' || calendarId.trim().length === 0 || calendarId.length > 512) {
            json(res, 400, { ok: false, error: 'calendarId must be a non-empty string' });
            return true;
        }
        const auth = readAuth();
        const accessToken = await validAccessToken(auth, config, writeAuth, fetchImpl);
        if (!accessToken) {
            json(res, 401, { ok: false, error: 'Google is not connected' });
            return true;
        }
        try {
            const entries = await listCalendars(accessToken, fetchImpl);
            const target = entries.find((e) => e.id === calendarId);
            if (!target) {
                json(res, 400, { ok: false, error: 'No such calendar for this account' });
                return true;
            }
            if (!isWritableRole(target.accessRole)) {
                json(res, 403, { ok: false, error: 'That calendar is read-only' });
                return true;
            }
            writeAuth({ ...readAuth(), pushCalendarId: calendarId });
            json(res, 200, { ok: true });
            return true;
        }
        catch (err) {
            json(res, 502, { ok: false, error: err instanceof Error ? err.message : 'Google request failed' });
            return true;
        }
    }
    text(res, 405, 'Method Not Allowed');
    return true;
}
