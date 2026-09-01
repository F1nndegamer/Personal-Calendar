/**
 * Production iCalendar proxy server.
 *
 * Architecture:
 *   Internet → calendar.f1nn.me → Cloudflare Tunnel → Nginx :80
 *     ├── /       → static dist/
 *     └── /ics    → Node proxy :3000 → calendar.magister.net
 *
 * The proxy enforces the same allowlist as the browser-side
 * src/integrations/webcal.ts: only HTTPS requests to
 * calendar.magister.net are permitted, and only under
 * /api/icalendar/feeds/. It is NOT an open proxy.
 *
 * The server never logs the full Magister feed URL — it contains a
 * private feed identifier.
 *
 * Handles GET /ics?url=<encoded-magister-url>
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { validateProxyUrl } from './proxyCore.js';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;

/**
 * Handles GET /ics?url=<encoded-magister-url>.
 *
 * Returns:
 *   200 with text/calendar — successful upstream fetch
   *   400 — missing/invalid url query parameter
   *   401/403 — upstream authentication failure (passed through)
   *   429 — upstream rate-limit (passed through)
   *   502 — upstream server error or network failure
   */
  export async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = req.url ?? '/';

    // Only handle the /ics path
    const pathAndQuery = url.split('?')[0];
    if (pathAndQuery !== '/ics') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    if (req.method !== 'GET') {
      res.writeHead(405, {
        'Content-Type': 'text/plain; charset=utf-8',
        Allow: 'GET',
      });
      res.end('Method Not Allowed');
      return;
    }

    // Extract the url query parameter
    const queryStart = url.indexOf('?');
    const searchParams =
      queryStart >= 0 ? new URLSearchParams(url.slice(queryStart + 1)) : new URLSearchParams();
    const rawUrl = searchParams.get('url') ?? '';

    const validation = validateProxyUrl(rawUrl);
    if (!validation.ok) {
      res.writeHead(validation.status, {
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end(validation.message);
      return;
    }

    // Fetch the validated upstream URL (with a hard timeout so a hanging upstream
    // never leaves the connection open indefinitely)
    let upstreamResponse: Response;
    const upstreamController = new AbortController();
    const upstreamTimeout = setTimeout(() => upstreamController.abort(), 30_000);
    try {
      upstreamResponse = await fetch(validation.httpsUrl, {
        headers: { Accept: 'text/calendar' },
        signal: upstreamController.signal,
      });
    } catch (err) {
      clearTimeout(upstreamTimeout);
      const message =
        err instanceof Error && err.name === 'AbortError'
          ? 'Upstream request timed out after 30s'
          : err instanceof Error
            ? err.message
            : 'Upstream request failed';
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Upstream network error: ${message}`);
      return;
    } finally {
      clearTimeout(upstreamTimeout);
    }

    // Forward the upstream status code transparently
    if (!upstreamResponse.ok) {
      const body = await upstreamResponse.text().catch(() => '');
      res.writeHead(upstreamResponse.status, {
        'Content-Type': upstreamResponse.headers.get('content-type') ||
          'text/plain; charset=utf-8',
      });
      res.end(body);
      return;
    }

    // Forward the successful iCalendar response
    const contentType =
      upstreamResponse.headers.get('content-type') || 'text/calendar; charset=utf-8';
    const body = await upstreamResponse.text();
    res.writeHead(200, {
      'Content-Type': contentType,
      // No caching — feeds are personal and change frequently
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

// Only start the live HTTP listener when this file is executed directly.
// `import.meta.url` equals `process.argv[1]` only for the entrypoint script.
// Tests import `handleRequest` via the testHarness and must not trigger listen.
function startListener(): void {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      // Unexpected error — never crash the server
      const message =
        err instanceof Error ? err.message : 'Internal server error';
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end(`Internal server error: ${message}`);
    });
  });

  server.listen(PORT, HOST, () => {
    // Intentionally does NOT print the feed URL — only the listen address
    console.log(`iCalendar proxy listening on http://${HOST}:${PORT}`);
  });

  // Graceful shutdown
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startListener();
}