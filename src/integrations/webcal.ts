/**
 * webcal → HTTPS URL handling with a strict allowlist.
 *
 * Magister publishes feeds as `webcal://calendar.magister.net/api/icalendar/feeds/<feed-id>`.
 * Browsers must never fetch `webcal:` directly — this module normalizes the
 * user-facing URL into a safe HTTPS request target, optionally routed through
 * a backend proxy, and refuses anything outside the allowlisted host(s).
 *
 * This is deliberately NOT an open proxy helper: arbitrary hosts and
 * arbitrary protocols are rejected.
 */

/** Hosts allowed to be fetched as schedule feeds. */
const ALLOWED_FEED_HOSTS = new Set(['calendar.magister.net']);

export type UrlNormalizationResult =
  | { ok: true; httpsUrl: string }
  | { ok: false; reason: string };

/**
 * Normalizes a user-facing feed URL (webcal:// or https://) into an HTTPS URL.
 * Rejects other protocols and non-allowlisted hosts.
 */
export function normalizeFeedUrl(rawUrl: string): UrlNormalizationResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Feed URL is not a valid URL' };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'webcal:' && protocol !== 'https:') {
    return { ok: false, reason: `Unsupported protocol "${parsed.protocol}" — only webcal: and https: are allowed` };
  }

  if (!ALLOWED_FEED_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { ok: false, reason: `Host "${parsed.hostname}" is not an allowed schedule feed host` };
  }

  // Rebuild as HTTPS (URL protocol mutation is not supported for webcal:)
  const rebuilt = new URL(`https://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`);
  return { ok: true, httpsUrl: rebuilt.toString() };
}

/**
 * Builds the actual request target for fetching a feed.
 *
 * - Without `proxyBaseUrl`: the normalized HTTPS feed URL is requested directly
 *   (works when the feed host sends permissive CORS headers, e.g. in dev).
 * - With `proxyBaseUrl`: the HTTPS feed URL is passed as the `url` query
 *   parameter to a backend proxy, which performs the server-side fetch.
 *   The proxy must enforce the same host allowlist — the frontend never
 *   becomes an open proxy.
 */
export function buildRequestUrl(feedUrl: string, proxyBaseUrl?: string): UrlNormalizationResult {
  const normalized = normalizeFeedUrl(feedUrl);
  if (!normalized.ok) return normalized;
  if (!proxyBaseUrl) return normalized;

  try {
    const proxy = new URL(proxyBaseUrl);
    if (proxy.protocol !== 'https:' && proxy.protocol !== 'http:') {
      return { ok: false, reason: 'Proxy base URL must be http(s)' };
    }
    proxy.searchParams.set('url', normalized.httpsUrl);
    return { ok: true, httpsUrl: proxy.toString() };
  } catch {
    return { ok: false, reason: 'Proxy base URL is not a valid URL' };
  }
}
