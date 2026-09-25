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
