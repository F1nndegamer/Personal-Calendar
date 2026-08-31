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
 * Resolves the active schedule provider from environment configuration.
 *
 * - `VITE_MAGISTER_FEED_URL`: the user's private Magister iCalendar feed URL
 *   (webcal:// or https://). Supplied via `.env.local` (git-ignored) — the
 *   real URL must never be committed.
 * - `VITE_SCHEDULE_PROXY_URL`: optional backend proxy that performs the
 *   server-side fetch of the feed.
 *
 * Returns `null` when no feed is configured — syncing is then unavailable
 * until a real feed URL is provided.
 */
export function resolveScheduleProvider(): ScheduleProvider | null {
  return getScheduleProviderInfo().provider;
}

/**
 * Like `resolveScheduleProvider`, but also reports whether a real feed is
 * configured. Used to decide whether automatic/manual syncing should run.
 */
export function getScheduleProviderInfo(): {
  provider: ScheduleProvider | null;
  configured: boolean;
} {
  const feedUrl = import.meta.env.VITE_MAGISTER_FEED_URL as string | undefined;
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
