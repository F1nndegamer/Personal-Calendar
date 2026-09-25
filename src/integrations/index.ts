/**
 * External schedule integrations. The app consumes normalized
 * `CalendarEvent`s via the `ScheduleProvider` interface — it knows nothing
 * about any specific provider (e.g. Magister).
 */
import { createMagisterProvider } from './magisterProvider';
import { createGoogleProvider } from './googleProvider';
import type { ScheduleProvider } from './types';

export * from './types';
export * from './sync';
export { normalizeExternalEvent } from './normalizeExternalEvent';
export { createMagisterProvider } from './magisterProvider';
export type { MagisterProviderConfig } from './magisterProvider';
export { createGoogleProvider } from './googleProvider';
export type { GoogleProviderConfig } from './googleProvider';
export { normalizeFeedUrl, buildRequestUrl } from './webcal';

/**
 * Resolves the active schedule providers.
 *
 * Order: Magister feed first (when configured), then Google (when the
 * browser can reach `/api/google/status` and it reports connected).
 * Google availability is cached per page load — `getScheduleProviderInfo`
 * stays synchronous, and the async probe fills the cache in the
 * background on first sync.
 *
 * Lookup order for Magister (first match wins):
 *   1. localStorage['calendar-app/feedUrl']  — runtime override (set via Settings dialog)
 *   2. VITE_MAGISTER_FEED_URL               — build-time env var (.env.local)
 */
export function resolveScheduleProviders(): ScheduleProvider[] {
  return getScheduleProvidersInfo().providers;
}

export function resolveScheduleProvider(): ScheduleProvider | null {
  const providers = resolveScheduleProviders();
  return providers.length > 0 ? providers[0] : null;
}

/**
 * Like `resolveScheduleProviders`, also reports whether any source is
 * configured. Used to decide whether automatic/manual syncing should run.
 */
export function getScheduleProvidersInfo(): {
  providers: ScheduleProvider[];
  configured: boolean;
} {
  const providers: ScheduleProvider[] = [];
  // 1) Magister feed: runtime override from Settings (preferred — set by user)
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
    providers.push(
      createMagisterProvider({
        feedUrl: feedUrl.trim(),
        proxyBaseUrl: (import.meta.env.VITE_SCHEDULE_PROXY_URL as string | undefined)?.trim() || undefined,
      }),
    );
  }

  // 3) Google Calendar — only when the cached probe says it is connected.
  // The probe runs async (see `refreshGoogleAvailability`); until it
  // resolves we sync Magister only, then pick Google up on the next sync.
  if (googleAvailableCache === true) {
    providers.push(createGoogleProvider());
  }

  return { providers, configured: providers.length > 0 };
}

/**
 * Legacy single-provider accessor (kept for tests + older call sites).
 * Prefer `getScheduleProvidersInfo` for new code.
 */
export function getScheduleProviderInfo(): {
  provider: ScheduleProvider | null;
  configured: boolean;
} {
  const { providers, configured } = getScheduleProvidersInfo();
  return { provider: providers.length > 0 ? providers[0] : null, configured };
}

let googleAvailableCache: boolean | null = null;
let googleProbeInFlight = false;

/**
 * Probe `/api/google/status` once per page load. Resolves `true` when the
 * server reports a connected Google account. Never throws; on any failure
 * Google simply stays out of the provider list.
 */
export async function refreshGoogleAvailability(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (googleAvailableCache !== null) return googleAvailableCache;
  if (googleProbeInFlight) return false;
  googleProbeInFlight = true;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetchImpl('/api/google/status', {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        googleAvailableCache = false;
        return false;
      }
      const parsed = (await res.json()) as { connected?: unknown };
      googleAvailableCache = parsed.connected === true;
      return googleAvailableCache;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    googleAvailableCache = false;
    return false;
  } finally {
    googleProbeInFlight = false;
  }
}

/** Test hook — resets the cached Google availability probe. */
export function resetGoogleAvailabilityCache(): void {
  googleAvailableCache = null;
  googleProbeInFlight = false;
}

/** Test hook — forces the cached Google availability value. */
export function setGoogleAvailabilityCache(value: boolean | null): void {
  googleAvailableCache = value;
}
