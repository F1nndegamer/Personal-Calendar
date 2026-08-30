import { describe, expect, it, vi } from 'vitest';
import {
  createIcsProxyHandler,
  resolveFeedTarget,
  type ProxyResponse,
} from '../proxyCore';

const VALID = 'https://calendar.magister.net/api/icalendar/feeds/some-feed-id';

describe('resolveFeedTarget', () => {
  it('accepts an https Magister feed URL', () => {
    const r = resolveFeedTarget(VALID);
    expect(r).toEqual({ ok: true, httpsUrl: VALID });
  });

  it('converts webcal:// to https for the allowlisted host', () => {
    const r = resolveFeedTarget('webcal://calendar.magister.net/api/icalendar/feeds/x');
    expect(r.ok && r.httpsUrl).toBe('https://calendar.magister.net/api/icalendar/feeds/x');
  });

  it('normalizes and strips query/fragment from the target', () => {
    const r = resolveFeedTarget(VALID + '?extra=1#frag');
    expect(r.ok && r.httpsUrl).toBe(VALID);
  });

  it('rejects hosts that are not calendar.magister.net', () => {
    expect(resolveFeedTarget('https://evil.example.com/api/icalendar/feeds/x').ok).toBe(false);
    expect(resolveFeedTarget('https://calendar.magister.org/api/icalendar/feeds/x').ok).toBe(false);
  });

  it('rejects non-feed paths', () => {
    expect(resolveFeedTarget('https://calendar.magister.net/api/secret').ok).toBe(false);
    expect(resolveFeedTarget('https://calendar.magister.net/other/icalendar/feeds/x').ok).toBe(false);
  });

  it('rejects unsupported protocols', () => {
    expect(resolveFeedTarget('http://calendar.magister.net/api/icalendar/feeds/x').ok).toBe(false);
    expect(resolveFeedTarget('ftp://calendar.magister.net/x').ok).toBe(false);
    expect(resolveFeedTarget('file:///etc/passwd').ok).toBe(false);
  });

  it('rejects garbage and an empty feed id', () => {
    expect(resolveFeedTarget('not a url').ok).toBe(false);
    expect(resolveFeedTarget('https://calendar.magister.net/api/icalendar/feeds/').ok).toBe(false);
  });
});

describe('createIcsProxyHandler', () => {
  function makeRes() {
    const r: ProxyResponse = {
      statusCode: 0,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    return r;
  }

  it('returns the ICS body with 200 on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('BEGIN:VCALENDAR\nEND:VCALENDAR', {
        status: 200,
        headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
      }),
    ) as typeof fetch;
    const handler = createIcsProxyHandler(fetchImpl);
    const res = makeRes();
    await handler({ method: 'GET', url: '/ics?url=' + encodeURIComponent(VALID) }, res);

    expect(fetchImpl).toHaveBeenCalledWith(
      VALID,
      expect.objectContaining({ headers: { Accept: 'text/calendar' } }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.end).toHaveBeenCalledWith('BEGIN:VCALENDAR\nEND:VCALENDAR');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/calendar; charset=utf-8',
    );
  });

  it('passes through upstream error status codes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('gone', { status: 403 })) as typeof fetch;
    const handler = createIcsProxyHandler(fetchImpl);
    const res = makeRes();
    await handler({ method: 'GET', url: '/ics?url=' + encodeURIComponent(VALID) }, res);
    expect(res.statusCode).toBe(403);
  });

  it('maps a 5xx upstream to the upstream status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('err', { status: 503 })) as typeof fetch;
    const handler = createIcsProxyHandler(fetchImpl);
    const res = makeRes();
    await handler({ method: 'GET', url: '/ics?url=' + encodeURIComponent(VALID) }, res);
    expect(res.statusCode).toBe(503);
  });

  it('maps an upstream network failure to 502', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down')) as typeof fetch;
    const handler = createIcsProxyHandler(fetchImpl);
    const res = makeRes();
    await handler({ method: 'GET', url: '/ics?url=' + encodeURIComponent(VALID) }, res);
    expect(res.statusCode).toBe(502);
  });

  it('rejects a missing url parameter with 400', async () => {
    const handler = createIcsProxyHandler(vi.fn() as typeof fetch);
    const res = makeRes();
    await handler({ method: 'GET', url: '/ics' }, res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects a disallowed target with 400 (never becomes an open proxy)', async () => {
    const handler = createIcsProxyHandler(vi.fn() as typeof fetch);
    const res = makeRes();
    await handler(
      { method: 'GET', url: '/ics?url=' + encodeURIComponent('https://evil.example.com/x') },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.end).toHaveBeenCalled();
  });

  it('returns 405 for non-GET methods', async () => {
    const handler = createIcsProxyHandler(vi.fn() as typeof fetch);
    const res = makeRes();
    await handler({ method: 'POST', url: '/ics?url=x' }, res);
    expect(res.statusCode).toBe(405);
    expect(res.setHeader).toHaveBeenCalledWith('Allow', 'GET');
  });
});