/**
 * Minimal, strictly-scoped server-side proxy for the Magister iCalendar feed.
 *
 * This runs on the app's own HTTP server (Vite dev/preview middleware) and is
 * intentionally NOT a general-purpose URL proxy:
 *   - only the Magister feed host is allowed
 *   - only the feed path `/api/icalendar/feeds/<id>` is allowed
 *   - the request must be https (webcal:// is converted first)
 *
 * The private feed URL is never touched here as source: it arrives as a
 * single `?url=` query parameter that the frontend sends from configuration.
 * The backend simply retrieves the ICS document and returns it — the ICS
 * parser stays in the frontend (`src/integrations/icsParser.ts`), never here.
 */

export const MAGISTER_ICS_HOST = 'calendar.magister.net';
export const FEED_PATH_PREFIX = '/api/icalendar/feeds/';

export interface ProxyTarget {
  ok: true;
  httpsUrl: string;
}

export interface ProxyTargetRejected {
  ok: false;
  status: number;
  message: string;
}

export type ProxyTargetResult = ProxyTarget | ProxyTargetRejected;

/**
 * Validates a client-supplied target URL and normalizes it to the exact
 * HTTPS feed URL the proxy will fetch. Rejects everything else.
 */
export function resolveFeedTarget(rawUrl: string): ProxyTargetResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, status: 400, message: 'Invalid feed URL' };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'webcal:') {
    return { ok: false, status: 400, message: 'Only https/webcal feed URLs are allowed' };
  }
  if (parsed.hostname.toLowerCase() !== MAGISTER_ICS_HOST) {
    return { ok: false, status: 400, message: `Host '${parsed.hostname}' is not allowed` };
  }
  if (!parsed.pathname.startsWith(FEED_PATH_PREFIX)) {
    return { ok: false, status: 400, message: 'Only Magister calendar feed paths are allowed' };
  }
  const feedId = parsed.pathname.slice(FEED_PATH_PREFIX.length);
  if (feedId.length === 0) {
    return { ok: false, status: 400, message: 'Missing feed id' };
  }

  // Normalize to HTTPS and drop any query/fragment the client may have sent.
  return { ok: true, httpsUrl: `https://${MAGISTER_ICS_HOST}${parsed.pathname}` };
}

/** Minimal structural surface used by the handler (also present on connect req/res). */
export interface ProxyRequest {
  method?: string;
  url?: string;
}

export interface ProxyResponse {
  statusCode: number;
  setHeader(name: string, value: string | number): void;
  end(chunk?: string): void;
}

/**
 * Creates the ICS proxy handler. `fetchFn` is injectable for tests.
 * Maps failures to appropriate HTTP status codes without ever logging the
 * upstream URL.
 */
export function createIcsProxyHandler(fetchFn: typeof fetch = fetch) {
  return async (req: ProxyRequest, res: ProxyResponse): Promise<void> => {
    if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET');
      res.end();
      return;
    }

    const targetRaw = new URL(req.url ?? '/', `http://${MAGISTER_ICS_HOST}`).searchParams.get('url');
    if (!targetRaw || targetRaw.trim().length === 0) {
      res.statusCode = 400;
      res.end('Missing url parameter');
      return;
    }

    const target = resolveFeedTarget(targetRaw);
    if (!target.ok) {
      res.statusCode = target.status;
      res.end(target.message);
      return;
    }

    let upstream: Response;
    try {
      upstream = await fetchFn(target.httpsUrl, {
        headers: { Accept: 'text/calendar' },
        redirect: 'follow',
      });
    } catch {
      res.statusCode = 502;
      res.end('Failed to reach the Magister feed');
      return;
    }

    const body = await upstream.text();
    res.statusCode = upstream.status;
    if (upstream.status >= 400) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(body.length ? `Magister feed request failed (HTTP ${upstream.status})` : `HTTP ${upstream.status}`);
      return;
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'text/calendar; charset=utf-8');
    res.end(body);
  };
}