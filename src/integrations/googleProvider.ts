/**
 * Google Calendar schedule provider.
 *
 * Talks to the *same-origin* server endpoints (`/api/google/events`),
 * never to Google directly — OAuth tokens live server-side in
 * `google-auth.json` (0600) and are never exposed to the browser.
 * The server expands recurrences (`singleEvents`) so this provider
 * only filters by the requested range, exactly like the Magister feed.
 */
import type {
  DateRange,
  ExternalFetchResult,
  ExternalScheduleEvent,
  ScheduleProvider,
} from './types';

export interface GoogleProviderConfig {
  /** Fetch implementation override (for tests). */
  fetchImpl?: typeof fetch;
  /** Request timeout in ms (default 15s). */
  timeoutMs?: number;
}

interface GoogleEventsResponse {
  ok?: boolean;
  events?: ExternalScheduleEvent[];
  error?: string;
}

export function createGoogleProvider(config: GoogleProviderConfig = {}): ScheduleProvider {
  const doFetch = config.fetchImpl ?? fetch;

  return {
    id: 'google',
    displayName: 'Google Calendar',

    async fetchSchedule(range: DateRange): Promise<ExternalFetchResult> {
      const fetchedAt = new Date().toISOString();
      const params = new URLSearchParams({
        timeMin: range.from.toISOString(),
        timeMax: range.to.toISOString(),
      });
      const controller = new AbortController();
      const timeoutMs = config.timeoutMs ?? 15_000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await doFetch(`/api/google/events?${params.toString()}`, {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          });
        } catch (err) {
          const isTimeout =
            err instanceof Error &&
            (err.name === 'AbortError' || /abort/i.test(err.name) || /abort/i.test(err.message));
          return {
            providerId: 'google',
            fetchedAt,
            events: [],
            error: {
              code: 'network',
              message: isTimeout
                ? 'Google sync timed out — the server did not respond in time'
                : err instanceof Error
                  ? err.message
                  : 'Failed to reach the Google sync endpoint',
            },
          };
        }
        if (response.status === 401) {
          return {
            providerId: 'google',
            fetchedAt,
            events: [],
            error: { code: 'auth', message: 'Google is not connected — reconnect in Settings' },
          };
        }
        if (response.status === 429) {
          return {
            providerId: 'google',
            fetchedAt,
            events: [],
            error: { code: 'rate-limit', message: 'Google rate limit hit — try again later' },
          };
        }
        if (!response.ok) {
          return {
            providerId: 'google',
            fetchedAt,
            events: [],
            error: { code: 'network', message: `Google sync failed with HTTP ${response.status}` },
          };
        }
        let parsed: GoogleEventsResponse;
        try {
          parsed = (await response.json()) as GoogleEventsResponse;
        } catch {
          return {
            providerId: 'google',
            fetchedAt,
            events: [],
            error: { code: 'parse', message: 'Google sync returned an unexpected response' },
          };
        }
        if (parsed.ok === false || !Array.isArray(parsed.events)) {
          return {
            providerId: 'google',
            fetchedAt,
            events: [],
            error: {
              code: 'unknown',
              message: parsed.error ?? 'Google sync returned an unexpected response',
            },
          };
        }
        const from = range.from.getTime();
        const to = range.to.getTime();
        const events = parsed.events.filter((e) => {
          if (!e || typeof e.start !== 'string' || typeof e.end !== 'string') return false;
          const s = new Date(e.start).getTime();
          const en = new Date(e.end).getTime();
          return Number.isFinite(s) && Number.isFinite(en) && s < to && en > from;
        });
        return { providerId: 'google', fetchedAt, events };
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
