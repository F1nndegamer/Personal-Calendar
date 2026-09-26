import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedSession, fetchSession, lockNow, unlock } from '../access';

/** JSON response stub; `Response` is not available in the node environment. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchSession', () => {
  it('reads the lock state and remembers it', async () => {
    stubFetch(async () => jsonResponse(200, { ok: true, required: true, unlocked: false }));
    expect(await fetchSession()).toEqual({ required: true, unlocked: false });
    expect(cachedSession()).toEqual({ required: true, unlocked: false });
  });

  it('normalises a missing/garbled body into booleans', async () => {
    stubFetch(async () => jsonResponse(200, {}));
    expect(await fetchSession()).toEqual({ required: false, unlocked: false });
  });

  it('returns null when the server is unreachable or unhappy', async () => {
    stubFetch(async () => jsonResponse(500, {}));
    expect(await fetchSession()).toBeNull();
    stubFetch(async () => {
      throw new Error('offline');
    });
    expect(await fetchSession()).toBeNull();
  });
});

describe('unlock', () => {
  it('posts the password and reports success', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, { ok: true }));
    expect(await unlock('hunter2')).toEqual({ ok: true, notRequired: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/unlock');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ password: 'hunter2' });
  });

  it('flags a server that has no password configured', async () => {
    stubFetch(async () => jsonResponse(200, { ok: true, required: false }));
    expect(await unlock('anything')).toEqual({ ok: true, notRequired: true });
  });

  it('surfaces the server message for a wrong password', async () => {
    stubFetch(async () => jsonResponse(401, { ok: false, error: 'Incorrect password' }));
    expect(await unlock('nope')).toEqual({ ok: false, error: 'Incorrect password' });
  });

  it('explains a throttled attempt', async () => {
    stubFetch(async () => jsonResponse(429, { ok: false }));
    const r = await unlock('nope');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Too many attempts/);
  });

  it('never throws when the request fails', async () => {
    stubFetch(async () => {
      throw new Error('offline');
    });
    expect(await unlock('x')).toEqual({ ok: false, error: 'Could not reach the server' });
  });
});

describe('lockNow', () => {
  it('posts to /api/lock and forgets the cached state', async () => {
    stubFetch(async () => jsonResponse(200, { ok: true, required: true, unlocked: true }));
    await fetchSession();
    expect(cachedSession()).not.toBeNull();
    const fetchMock = stubFetch(async () => jsonResponse(200, { ok: true }));
    await lockNow();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/lock');
    expect(cachedSession()).toBeNull();
  });

  it('swallows a failed request', async () => {
    stubFetch(async () => {
      throw new Error('offline');
    });
    await expect(lockNow()).resolves.toBeUndefined();
  });
});
