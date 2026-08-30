/**
 * External schedule integrations. The app consumes normalized
 * `CalendarEvent`s via the `ScheduleProvider` interface — it knows nothing
 * about any specific provider (e.g. Magister).
 */
import { mockMagisterProvider } from './mockMagisterProvider';
import { createMagisterProvider } from './magisterProvider';
import type { ScheduleProvider } from './types';

export * from './types';
export * from './sync';
export { mockMagisterProvider, normalizeExternalEvent } from './mockMagisterProvider';
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
 * Falls back to the built-in mock provider when no feed is configured, so
 * the app keeps working in development/demo mode.
 */
export function resolveScheduleProvider(): ScheduleProvider {
  return getScheduleProviderInfo().provider;
}

/**
 * Like `resolveScheduleProvider`, but also reports whether a real feed is
 * configured. Used to decide whether automatic/manual syncing should run —
 * syncing the mock provider would be pointless.
 */
export function getScheduleProviderInfo(): { provider: ScheduleProvider; configured: boolean } {
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
  return { provider: mockMagisterProvider, configured: false };
}
