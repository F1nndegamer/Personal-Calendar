import { parseIcs } from './icsParser';
import { buildRequestUrl } from './webcal';
import type {
  DateRange,
  ExternalFetchResult,
  ScheduleProvider,
} from './types';

/**
 * Real Magister provider, consuming the school schedule through the
 * iCalendar subscription feed.
 *
 * Architecture (per the approved design):
 *
 *   Magister webcal feed → HTTP(S) fetch/proxy → ICS parser
 *   → ExternalScheduleEvent[] → syncExternalEvents() → App state → Calendar
 *
 * - The browser NEVER fetches `webcal://` directly. The user-facing URL is
 *   normalized to HTTPS here, optionally routed through a backend proxy.
 * - The feed URL is user-specific and private: it is passed in via
 *   configuration (e.g. `VITE_MAGISTER_FEED_URL`) and is never hardcoded,
 *   logged, or included in committed test data.
 * - Errors are reported as typed `ProviderError`s through the standard
 *   `ExternalFetchResult` channel.
 */

export interface MagisterProviderConfig {
  /**
   * The user's personal Magister iCalendar feed URL. Accepts the public
   * `webcal://` form; it is normalized to HTTPS internally. Configure via
   * an environment variable — do NOT commit a real feed URL.
   */
  feedUrl: string;
  /**
   * Optional HTTP(S) endpoint of a backend proxy that fetches the feed
   * server-side. The target URL is passed as `?url=<encoded https url>`.
   * Use this when the feed host's CORS headers block direct browser access
   * (the usual case in production).
   */
  proxyBaseUrl?: string;
  /** Fetch implementation override (for tests). */
  fetchImpl?: typeof fetch;
}

function errorCodeForStatus(status: number) {
  if (status === 401 || status === 403) return 'auth' as const;
  if (status === 429) return 'rate-limit' as const;
  return 'network' as const;
}

/**
 * Creates a Magister schedule provider. `fetchSchedule` returns a typed
 * error instead of throwing for every expected failure mode.
 */
export function createMagisterProvider(config: MagisterProviderConfig): ScheduleProvider {
  const doFetch = config.fetchImpl ?? fetch;

  return {
    id: 'magister',
    displayName: 'Magister',

    async fetchSchedule(range: DateRange): Promise<ExternalFetchResult> {
      const requestUrl = buildRequestUrl(config.feedUrl, config.proxyBaseUrl);
      if (!requestUrl.ok) {
        return {
          providerId: 'magister',
          fetchedAt: new Date().toISOString(),
          events: [],
          error: { code: 'unknown', message: requestUrl.reason },
        };
      }

      let icsText: string;
      try {
        const response = await doFetch(requestUrl.httpsUrl, {
          headers: { Accept: 'text/calendar' },
        });
        if (!response.ok) {
          return {
            providerId: 'magister',
            fetchedAt: new Date().toISOString(),
            events: [],
            error: {
              code: errorCodeForStatus(response.status),
              message: `Feed request failed with HTTP ${response.status}`,
            },
          };
        }
        icsText = await response.text();
      } catch (err) {
        return {
          providerId: 'magister',
          fetchedAt: new Date().toISOString(),
          events: [],
          error: {
            code: 'network',
            message: err instanceof Error ? err.message : 'Failed to fetch the schedule feed',
          },
        };
      }

      try {
        const events = parseIcs(icsText, range);
        return {
          providerId: 'magister',
          fetchedAt: new Date().toISOString(),
          events,
        };
      } catch (err) {
        return {
          providerId: 'magister',
          fetchedAt: new Date().toISOString(),
          events: [],
          error: {
            code: 'parse',
            message: err instanceof Error ? err.message : 'Failed to parse the schedule feed',
          },
        };
      }
    },
  };
}
