/**
 * Shared Google Calendar integration types.
 *
 * This module is intentionally dependency-free (no Node builtins, no DOM
 * APIs) so it can be imported from both the browser bundle (`src/`) and
 * the Node server (`server/`).
 */
/** Least-privilege scopes for this integration. */
export const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
    'openid',
    'email',
];
export const GOOGLE_SCOPE_STRING = GOOGLE_SCOPES.join(' ');
/**
 * Stamp every event this app creates on Google with `extendedProperties`,
 * so a copy can always be recognised as ours — even when the local `pushed`
 * mapping no longer knows about it (a push run that failed after it created
 * events, an interrupted deploy, a restored auth file, …). Without the stamp
 * such copies come back through the import as duplicates of the very event
 * they mirror.
 */
export const PUSH_TAG_KEY = 'pcApp';
/** Value of `PUSH_TAG_KEY` written by this app. */
export const PUSH_TAG_VALUE = 'personal-calendar';
/** Key of the local event id inside the same private property bag. */
export const PUSH_LOCAL_ID_KEY = 'pcLocalId';
/** Private extended-property bag marking one Google event as our copy. */
export function pushTag(localId) {
    return { [PUSH_TAG_KEY]: PUSH_TAG_VALUE, [PUSH_LOCAL_ID_KEY]: localId };
}
/** True when a `extendedProperties.private` bag was written by this app. */
export function isOwnCopyTag(privateProps) {
    return !!privateProps && privateProps[PUSH_TAG_KEY] === PUSH_TAG_VALUE;
}
