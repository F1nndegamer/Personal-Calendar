// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { validateProxyUrl, errorCodeForStatus } from '../proxyCore.js';

describe('validateProxyUrl', () => {
  describe('valid Magister URLs', () => {
    it('accepts a valid https Magister feed URL', () => {
      const result = validateProxyUrl(
        'https://calendar.magister.net/api/icalendar/feeds/abc123',
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.httpsUrl).toBe(
          'https://calendar.magister.net/api/icalendar/feeds/abc123',
        );
      }
    });

    it('normalizes webcal:// to https://', () => {
      const result = validateProxyUrl(
        'webcal://calendar.magister.net/api/icalendar/feeds/abc123',
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.httpsUrl).toBe(
          'https://calendar.magister.net/api/icalendar/feeds/abc123',
        );
      }
    });
  });

  describe('invalid URLs', () => {
    it('rejects missing url parameter', () => {
      const result = validateProxyUrl('');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.message).toContain('Missing');
      }
    });

    it('rejects malformed URL', () => {
      const result = validateProxyUrl('not-a-url');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.message).toBe('Invalid URL');
      }
    });

    it('rejects http:// protocol', () => {
      const result = validateProxyUrl(
        'http://calendar.magister.net/api/icalendar/feeds/abc123',
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.message).toContain('protocol');
      }
    });

    it('rejects arbitrary external host', () => {
      const result = validateProxyUrl(
        'https://evil.example.com/api/icalendar/feeds/abc123',
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.message).toBe('Host not allowed');
      }
    });

    it('rejects path outside the allowed prefix', () => {
      const result = validateProxyUrl(
        'https://calendar.magister.net/api/other/endpoint',
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.message).toBe('Path not allowed');
      }
    });

    it('rejects the bare prefix path (no feed id)', () => {
      const result = validateProxyUrl(
        'https://calendar.magister.net/api/icalendar/feeds/',
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.message).toBe('Path not allowed');
      }
    });

    it('never leaks the full feed URL in error messages', () => {
      const result = validateProxyUrl('https://evil.com/secret-feed-id');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).not.toContain('secret-feed-id');
      }
    });
  });
});

describe('errorCodeForStatus', () => {
  it('maps 401 to auth', () => {
    expect(errorCodeForStatus(401)).toBe('auth');
  });

  it('maps 403 to auth', () => {
    expect(errorCodeForStatus(403)).toBe('auth');
  });

  it('maps 429 to rate-limit', () => {
    expect(errorCodeForStatus(429)).toBe('rate-limit');
  });

  it('maps 500 to network', () => {
    expect(errorCodeForStatus(500)).toBe('network');
  });

  it('maps 503 to network', () => {
    expect(errorCodeForStatus(503)).toBe('network');
  });
});