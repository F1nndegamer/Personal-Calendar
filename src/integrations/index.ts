/**
 * External schedule integrations. The app consumes normalized
 * `CalendarEvent`s via the `ScheduleProvider` interface — it knows nothing
 * about any specific provider (e.g. Magister).
 */
import { createMagisterProvider } from './magisterProvider';
import type { ScheduleProvider } from './types';

export * from './types';
export * from './sync';
export { normalizeExternalEvent } from './normalizeExternalEvent';
export { createMagisterProvider } from './magisterProvider';
export type { MagisterProviderConfig } from './magisterProvider';
export { normalizeFeedUrl, buildRequestUrl } from './webcal';

/**
 * Resolves the active schedule provider.
 *
 * Lookup order (first match wins):
 *   1. localStorage['calendar-app/feedUrl']  — runtime override (set via Settings dialog)
 *   2. VITE_MAGISTER_FEED_URL               — build-time env var (.env.local)
 *
 * The runtime override means the Sync button is always available even if
 * the .env.local was missing at build time. The user pastes the feed URL
 * into Settings and sync just works.
 *
 * Returns `null` when no feed is configured — syncing is then unavailable
 * until the user provides a feed URL through Settings.
 */
export function resolveScheduleProvider(): ScheduleProvider | null {
  return getScheduleProviderInfo().provider;
}

/**
 * Like `resolveScheduleProvider`, also reports whether a real feed is
 * configured. Used to decide whether automatic/manual syncing should run.
 */
export function getScheduleProviderInfo(): {
  provider: ScheduleProvider | null;
  configured: boolean;
} {
  // 1) Runtime override from Settings (preferred — set by user)
  let feedUrl: string | undefined;
  try {
    const stored = localStorage.getItem('calendar-app/feedUrl');
    if (stored && stored.trim().length > 0) feedUrl = stored.trim();
  } catch {
    // localStorage unavailable — fall through to env
  }

  // 2) Build-time env fallback
  if (!feedUrl) {
    const envFeed = import.meta.env.VITE_MAGISTER_FEED_URL as string | undefined;
    if (envFeed && envFeed.trim().length > 0) feedUrl = envFeed.trim();
  }

  if (feedUrl && feedUrl.trim().length > 0) {
    return {
      provider: createMagisterProvider({
        feedUrl: feedUrl.trim(),
        proxyBaseUrl: (import.meta.env.VITE_SCHEDULE_PROXY_URL as string | undefined)?.trim() || undefined,
      }),
      configured: true,
    };
  }
  return { provider: null, configured: false };
}
