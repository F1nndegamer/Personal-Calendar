import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppGate } from '../AppGate';

/**
 * The gate is the difference between "nobody sees the calendar" and "everybody
 * does", so its contract is worth pinning down: the app is only mounted once
 * the server says this browser is allowed in, and a wrong password changes
 * nothing else.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Route the three endpoints the gate uses. */
function stubAccess(options: {
  session?: { required: boolean; unlocked: boolean } | 'unreachable';
  unlock?: { status: number; body: unknown };
}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/session') {
      if (options.session === 'unreachable') throw new Error('offline');
      return { ok: true, status: 200, json: async () => ({ ok: true, ...options.session }) };
    }
    if (url === '/api/unlock') {
      const status = options.unlock?.status ?? 200;
      return { ok: status < 400, status, json: async () => options.unlock?.body ?? { ok: true } };
    }
    if (init?.method === 'POST') return { ok: true, status: 200, json: async () => ({ ok: true }) };
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const APP = <p>the calendar</p>;

describe('AppGate', () => {
  it('shows the lock screen instead of the app while locked', async () => {
    stubAccess({ session: { required: true, unlocked: false } });
    render(<AppGate>{APP}</AppGate>);
    expect(await screen.findByText('This calendar is locked.')).toBeTruthy();
    expect(screen.queryByText('the calendar')).toBeNull();
  });

  it('renders the app when the session is already unlocked', async () => {
    stubAccess({ session: { required: true, unlocked: true } });
    render(<AppGate>{APP}</AppGate>);
    expect(await screen.findByText('the calendar')).toBeTruthy();
    expect(screen.queryByText('This calendar is locked.')).toBeNull();
  });

  it('skips the lock screen entirely when no password is configured', async () => {
    stubAccess({ session: { required: false, unlocked: true } });
    render(<AppGate>{APP}</AppGate>);
    expect(await screen.findByText('the calendar')).toBeTruthy();
  });

  it('fails open when the server cannot be reached (offline use)', async () => {
    stubAccess({ session: 'unreachable' });
    render(<AppGate>{APP}</AppGate>);
    expect(await screen.findByText('the calendar')).toBeTruthy();
  });

  it('unlocks with the right password and then shows the app', async () => {
    stubAccess({
      session: { required: true, unlocked: false },
      unlock: { status: 200, body: { ok: true } },
    });
    render(<AppGate>{APP}</AppGate>);
    const field = await screen.findByLabelText('Password');
    fireEvent.change(field, { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('the calendar')).toBeTruthy();
  });

  it('keeps the app hidden and explains a wrong password', async () => {
    stubAccess({
      session: { required: true, unlocked: false },
      unlock: { status: 401, body: { ok: false, error: 'Incorrect password' } },
    });
    render(<AppGate>{APP}</AppGate>);
    const field = await screen.findByLabelText('Password');
    fireEvent.change(field, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('Incorrect password')).toBeTruthy();
    expect(screen.queryByText('the calendar')).toBeNull();
    // The field is cleared and focused again, ready for another try.
    expect((field as HTMLInputElement).value).toBe('');
  });

  it('says it cannot reach the server instead of failing silently', async () => {
    stubAccess({
      session: { required: true, unlocked: false },
      unlock: { status: 500, body: {} },
    });
    render(<AppGate>{APP}</AppGate>);
    const field = await screen.findByLabelText('Password');
    fireEvent.change(field, { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('Incorrect password')).toBeTruthy();
  });
});
