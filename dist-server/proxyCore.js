const ALLOWED_HOSTS = new Set(['calendar.magister.net']);
const ALLOWED_PATH_PREFIX = '/api/icalendar/feeds/';
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
        return { ok: false, status: 400, message: 'Host not allowed' };
    }
    const path = parsed.pathname;
    if (!path.startsWith(ALLOWED_PATH_PREFIX) || path === ALLOWED_PATH_PREFIX) {
        return { ok: false, status: 400, message: 'Path not allowed' };
    }
    const httpsUrl = new URL(`https://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`).toString();
    return { ok: true, httpsUrl };
}
export function errorCodeForStatus(status) {
    if (status === 401 || status === 403)
        return 'auth';
    if (status === 429)
        return 'rate-limit';
    return 'network';
}
