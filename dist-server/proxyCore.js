/**
 * Server-side URL validation — identical security rules to the browser-side
 * src/integrations/webcal.ts. This is intentionally duplicated (rather than
 * imported) so the server is self-contained and does not pull in any
 * browser/React bundles.
 */
const ALLOWED_HOSTS = new Set(['calendar.magister.net']);
const ALLOWED_PATH_PREFIX = '/api/icalendar/feeds/';
/**
 * Validates and normalizes the `url` query parameter.
 * - Only HTTPS and webcal:// protocols
 * - Only the allowlisted host (calendar.magister.net)
 * - Only the expected path prefix (/api/icalendar/feeds/...)
 * - Converts webcal:// to https://
 * - Never returns the full feed URL in an error message (it contains a private
 *   feed identifier).
 */
export function validateProxyUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return { ok: false, status: 400, message: 'Missing "url" query parameter' };
    }
    let parsed;
    try {
        parsed = new URL(rawUrl);
    }
    catch {
        return { ok: false, status: 400, message: 'Invalid URL' };
    }
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'https:' && protocol !== 'webcal:') {
        return {
            ok: false,
            status: 400,
            message: 'Only https and webcal protocols are allowed',
        };
    }
    const host = parsed.hostname.toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) {
        // Deliberately vague — we don't confirm whether a host is known
        return { ok: false, status: 400, message: 'Host not allowed' };
    }
    const path = parsed.pathname;
    if (!path.startsWith(ALLOWED_PATH_PREFIX) || path === ALLOWED_PATH_PREFIX) {
        return { ok: false, status: 400, message: 'Path not allowed' };
    }
    // Rebuild as HTTPS (URL protocol mutation not supported for webcal:)
    const httpsUrl = new URL(`https://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`).toString();
    return { ok: true, httpsUrl };
}
/** Maps an HTTP status code to a typed provider error code used by the frontend. */
export function errorCodeForStatus(status) {
    if (status === 401 || status === 403)
        return 'auth';
    if (status === 429)
        return 'rate-limit';
    return 'network';
}
