import type { Plugin } from 'vite';
import { createIcsProxyHandler } from './proxyCore.ts';

/**
 * Vite plugin: serves the Magister feed proxy on `<dev-origin>/ics`.
 *
 * While developing, set:
 *   VITE_SCHEDULE_PROXY_URL=http://localhost:5173/ics
 * so the frontend routes feed fetches through this same-origin endpoint.
 * (The port must match the dev/preview server.)
 *
 * Registered for both the dev server and `vite preview` so a production
 * build preview also works.
 */
export function icsProxyPlugin(): Plugin {
  // connect middleware: (req, res, next) => void — matches ProxyRequest/Response
  const middleware = createIcsProxyHandler();

  return {
    name: 'ics-proxy',
    configureServer(server) {
      server.middlewares.use('/ics', (req, res) => {
        void middleware(req as never, res as never);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use('/ics', (req, res) => {
        void middleware(req as never, res as never);
      });
    },
  };
}