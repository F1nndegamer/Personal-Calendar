/**
 * Production iCalendar proxy + data storage server.
 *
 * Routes:
 *   GET  /ics?url=…   → proxies to Magister
 *   GET  /api/storage → returns { events, tasks, feedUrl }
 *   PUT  /api/storage → saves { events, tasks, feedUrl }
 *
 * STORAGE_PATH env var controls where data is saved.
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { validateProxyUrl } from './proxyCore.js';
import { readStorage, writeStorage, type StoredData } from './storage.js';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;

function handleStorageRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const path = req.url?.split('?')[0] ?? '';

  if (req.method === 'GET' && path === '/api/storage') {
    try {
      const data = readStorage();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(err instanceof Error ? err.message : 'Read failed');
    }
    return;
  }

  if (req.method === 'PUT' && path === '/api/storage') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body) as Partial<StoredData>;
        const current = readStorage();
        const next: StoredData = {
          events: Array.isArray(parsed.events) ? parsed.events : current.events,
          tasks: Array.isArray(parsed.tasks) ? parsed.tasks : current.tasks,
          feedUrl: typeof parsed.feedUrl === 'string' ? parsed.feedUrl : current.feedUrl,
        };
        writeStorage(next);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(err instanceof Error ? err.message : 'Write failed');
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

export async function handleIcsRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = req.url ?? '/';
  const pathAndQuery = url.split('?')[0];
  if (pathAndQuery !== '/ics') return;

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain', Allow: 'GET' });
    res.end('Method Not Allowed');
    return;
  }

  const qs = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?')) : '');
  const rawUrl = qs.get('url') ?? '';
  const validation = validateProxyUrl(rawUrl);
  if (!validation.ok) {
    res.writeHead(validation.status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(validation.message);
    return;
  }

  let upstreamResponse: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    upstreamResponse = await fetch(validation.httpsUrl, {
      headers: { Accept: 'text/calendar' },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const msg =
      err instanceof Error && err.name === 'AbortError'
        ? 'Upstream request timed out after 30s'
        : err instanceof Error ? err.message : 'Upstream request failed';
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Upstream network error: ${msg}`);
    return;
  } finally {
    clearTimeout(timeout);
  }

  if (!upstreamResponse.ok) {
    const body = await upstreamResponse.text().catch(() => '');
    res.writeHead(upstreamResponse.status, {
      'Content-Type':
        upstreamResponse.headers.get('content-type') || 'text/plain; charset=utf-8',
    });
    res.end(body);
    return;
  }

  const contentType =
    upstreamResponse.headers.get('content-type') || 'text/calendar; charset=utf-8';
  const body = await upstreamResponse.text();
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

export async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const path = req.url?.split('?')[0] ?? '';

  if (path === '/api/storage') {
    handleStorageRequest(req, res);
    return;
  }

  if (path === '/ics' || path.startsWith('/ics?')) {
    await handleIcsRequest(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

function startListener(): void {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      const msg = err instanceof Error ? err.message : 'Internal server error';
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end(`Internal server error: ${msg}`);
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`Calendar server listening on http://${HOST}:${PORT}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startListener();
}
