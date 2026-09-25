import { describe, expect, it, vi } from 'vitest';
import { createGoogleProvider } from '../googleProvider';

const RANGE = {
  from: new Date('2026-09-07T00:00:00.000Z'),
  to: new Date('2026-09-14T00:00:00.000Z'),
};

/** Minimal Response stand-in — the provider only reads ok/status/json(). */
function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function provider(fetchImpl: unknown) {
  return createGoogleProvider({ fetchImpl: fetchImpl as typeof fetch });
}

describe('createGoogleProvider', () => {
  it('requests the given range and returns only overlapping events', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        ok: true,
        events: [
          {
            externalId: 'in-range',
            subject: 'Wiskunde',
            start: '2026-09-08T08:00:00.000Z',
            end: '2026-09-08T09:00:00.000Z',
          },
          {
            externalId: 'out-of-range',
            subject: 'Ver weg',
            start: '2026-10-01T08:00:00.000Z',
            end: '2026-10-01T09:00:00.000Z',
          },
          { externalId: 'malformed', subject: 'Geen tijden' },
        ],
      }),
    );
    const result = await provider(fetchImpl).fetchSchedule(RANGE);

    expect(result.providerId).toBe('google');
    expect(result.error).toBeUndefined();
    expect(result.events.map((e) => e.externalId)).toEqual(['in-range']);

    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain('/api/google/events?');
    expect(url).toContain('timeMin=2026-09-07');
    expect(url).toContain('timeMax=2026-09-14');
  });

  it('maps HTTP 401 to an auth error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({}, 401));
    const result = await provider(fetchImpl).fetchSchedule(RANGE);
    expect(result.error?.code).toBe('auth');
    expect(result.error?.message).toContain('reconnect in Settings');
    expect(result.events).toEqual([]);
  });

  it('maps HTTP 429 to a rate-limit error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({}, 429));
    const result = await provider(fetchImpl).fetchSchedule(RANGE);
    expect(result.error?.code).toBe('rate-limit');
  });

  it('maps other HTTP failures to a network error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({}, 500));
    const result = await provider(fetchImpl).fetchSchedule(RANGE);
    expect(result.error?.code).toBe('network');
    expect(result.error?.message).toBe('Google sync failed with HTTP 500');
  });

  it('maps an unparsable body to a parse error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    const result = await provider(fetchImpl).fetchSchedule(RANGE);
    expect(result.error?.code).toBe('parse');
  });

  it('surfaces a server-reported failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({ ok: false, error: 'no calendars selected' }),
    );
    const result = await provider(fetchImpl).fetchSchedule(RANGE);
    expect(result.error?.code).toBe('unknown');
    expect(result.error?.message).toBe('no calendars selected');
  });

  it('rejects a body without an events array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ ok: true }));
    const result = await provider(fetchImpl).fetchSchedule(RANGE);
    expect(result.error?.code).toBe('unknown');
    expect(result.events).toEqual([]);
  });

  it('maps a fetch rejection to a network error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connection refused'));
    const result = await provider(fetchImpl).fetchSchedule(RANGE);
    expect(result.error?.code).toBe('network');
    expect(result.error?.message).toBe('connection refused');
  });

  it('reports a timeout when the request is aborted', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    const fetchImpl = vi.fn().mockRejectedValue(abortErr);
    const result = await provider(fetchImpl).fetchSchedule(RANGE);
    expect(result.error?.code).toBe('network');
    expect(result.error?.message).toContain('timed out');
  });
});
