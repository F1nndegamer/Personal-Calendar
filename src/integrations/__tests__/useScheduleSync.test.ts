import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useScheduleSync } from '../useScheduleSync';
import type {
  ExternalFetchResult,
  ExternalScheduleEvent,
  ScheduleProvider,
} from '../types';
import type { CalendarEvent } from '../../calendar/types';

/**
 * The sync orchestration hook reads provider config from `getScheduleProviderInfo`,
 * which reads `import.meta.env.VITE_MAGISTER_FEED_URL`. We mock that module to
 * control whether a "real" provider is configured and what it returns.
 */
const infoMock = vi.hoisted(() => ({
  getScheduleProviderInfo: vi.fn(),
}));

vi.mock('../index', () => ({
  getScheduleProviderInfo: infoMock.getScheduleProviderInfo,
}));

const ext = (id: string): ExternalScheduleEvent => ({
  externalId: id,
  subject: `Vak ${id}`,
  start: '2026-09-07T08:00:00.000Z',
  end: '2026-09-07T08:45:00.000Z',
  category: 'School',
});

function makeProvider(result: Partial<ExternalFetchResult>): ScheduleProvider {
  return {
    id: 'magister',
    displayName: 'Magister',
    fetchSchedule: vi.fn().mockResolvedValue({
      providerId: 'magister',
      fetchedAt: '2026-08-30T00:00:00Z',
      events: [],
      ...result,
    }),
  };
}

const manual: CalendarEvent = {
  id: 'manual-1',
  title: 'Eigen afspraak',
  start: '2026-09-07T19:00:00.000Z',
  end: '2026-09-07T20:00:00.000Z',
  color: 'cyan',
};

function setup(opts: {
  configured?: boolean;
  provider?: ScheduleProvider;
  initialEvents?: CalendarEvent[];
  autoSyncOnStart?: boolean;
}) {
  const provider =
    opts.provider ??
    makeProvider({ events: [ext('les-1'), ext('les-2')] });
  infoMock.getScheduleProviderInfo.mockReturnValue({
    provider,
    configured: opts.configured ?? true,
  });

  let current = opts.initialEvents ?? [manual];
  const persisted: CalendarEvent[][] = [];

  const { result, unmount } = renderHook(() =>
    useScheduleSync({
      getEvents: () => current,
      commitEvents: (next) => {
        current = next;
      },
      persist: (next) => {
        persisted.push(next);
      },
      fetchRange: () => ({ from: new Date('2026-09-07'), to: new Date('2026-09-14') }),
      autoSyncOnStart: opts.autoSyncOnStart ?? true,
    }),
  );

  return {
    result,
    unmount,
    getCurrent: () => current,
    persisted,
    provider,
    readState: () => result.current.state,
  };
}

describe('useScheduleSync', () => {
  beforeEach(() => {
    infoMock.getScheduleProviderInfo.mockReset();
  });

  it('performs a successful sync: merges, commits, persists, marks success', async () => {
    const helper = setup({});
    await waitFor(() => expect(helper.readState().status).toBe('success'));
    const state = helper.readState();
    expect(state.status).toBe('success');
    expect(state.lastSyncAt).toBe('2026-08-30T00:00:00Z');
    expect(helper.getCurrent().some((e) => e.source === 'external')).toBe(true);
    expect(helper.getCurrent().some((e) => e.id === 'manual-1')).toBe(true);
    // persisted at least once with merged result
    expect(helper.persisted.length).toBeGreaterThan(0);
    expect(helper.persisted.at(-1)?.some((e) => e.source === 'external')).toBe(true);
    helper.unmount();
  });

  it('reports a provider failure as an error and does not touch events', async () => {
    const provider = makeProvider({ error: { code: 'network', message: 'CORS blocked' } });
    const helper = setup({ provider });
    await waitFor(() => expect(helper.readState().status).toBe('error'));
    expect(helper.readState().errorMessage).toBe('CORS blocked');
    expect(helper.getCurrent().every((e) => e.source !== 'external')).toBe(true);
    helper.unmount();
  });

  it('does not run startup sync when autoSyncOnStart is false', async () => {
    const provider = makeProvider({ events: [ext('les-1')] });
    const helper = setup({ provider, autoSyncOnStart: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(helper.readState().status).toBe('idle');
    expect(helper.persisted.length).toBe(0);
    helper.unmount();
  });

  it('runs startup sync only once', async () => {
    const provider = makeProvider({ events: [ext('les-1')] });
    const helper = setup({ provider });
    await waitFor(() => expect(helper.readState().status).toBe('success'));
    const calls = (provider.fetchSchedule as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(calls).toBe(1);
    helper.unmount();
  });

  it('does not sync when no feed is configured (mock fallback)', async () => {
    const provider = makeProvider({ events: [ext('les-1')] });
    const helper = setup({ configured: false, provider });
    await new Promise((r) => setTimeout(r, 30));
    expect(helper.readState().status).toBe('idle');
    expect(helper.persisted.length).toBe(0);
    helper.unmount();
  });

  it('prevents multiple simultaneous syncs', async () => {
    let resolveFetch: (v: ExternalFetchResult) => void = () => undefined;
    const provider: ScheduleProvider = {
      id: 'magister',
      displayName: 'Magister',
      fetchSchedule: vi.fn().mockReturnValue(
        new Promise<ExternalFetchResult>((resolve) => {
          resolveFetch = resolve;
        }),
      ),
    };
    const helper = setup({ provider, autoSyncOnStart: false });

    act(() => {
      void helper.result.current.syncNow();
      void helper.result.current.syncNow();
    });
    await waitFor(() => expect(helper.readState().status).toBe('syncing'));
    const callsBefore = (provider.fetchSchedule as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsBefore).toBe(1);

    await act(async () => {
      resolveFetch({ providerId: 'magister', fetchedAt: '2026-08-30T00:00:00Z', events: [ext('les-1')] });
    });
    await waitFor(() => expect(helper.readState().status).toBe('success'));
    const callsAfter = (provider.fetchSchedule as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfter).toBe(1);
    helper.unmount();
  });

  it('tracks the union of synced ranges so navigation extends, never shrinks coverage', async () => {
    // Direct unit test of the union logic without going through fetchRange.
    // We call syncNow with explicit range overrides and verify the tracked
    // range expands to the union (preventing events from being dropped).
    const provider: ScheduleProvider = {
      id: 'magister',
      displayName: 'Magister',
      fetchSchedule: vi.fn().mockImplementation((range: { from: Date; to: Date }) => {
        // Return one event unique to this range
        return Promise.resolve({
          providerId: 'magister',
          fetchedAt: new Date().toISOString(),
          events: [ext(`les-${range.from.toISOString()}`)],
        });
      }),
    };
    infoMock.getScheduleProviderInfo.mockReturnValue({ provider, configured: true });

    let current: CalendarEvent[] = [];
    const { result, unmount } = renderHook(() =>
      useScheduleSync({
        getEvents: () => current,
        commitEvents: (next) => { current = next; },
        persist: () => {/* noop */},
        fetchRange: () => ({ from: new Date('2026-09-07'), to: new Date('2026-09-14') }),
        autoSyncOnStart: false,
      }),
    );

    const WEEK_MS = 7 * 86_400_000;
    const DAY_MS = 86_400_000;
    const initial = new Date('2026-09-07');

    // First sync: initial 30-day window
    await act(async () => {
      await result.current.syncNow({
        from: initial,
        to: new Date(initial.getTime() + 30 * DAY_MS),
      });
    });

    // Second sync: navigate forward 5 weeks — the new range should include
    // the original window (via union) so previously imported events are kept.
    const week5 = new Date(initial.getTime() + 5 * WEEK_MS);
    await act(async () => {
      await result.current.syncNow({
        from: new Date(initial.getTime() + 5 * WEEK_MS - 5 * DAY_MS), // overlap with initial
        to: new Date(week5.getTime() + 30 * DAY_MS),
      });
    });

    // The tracked range must span the union: from initial to week5+30
    const state = result.current.state;
    const expectedFrom = initial.getTime();
    const expectedTo = week5.getTime() + 30 * DAY_MS;
    expect(state.syncedFrom).toBeLessThanOrEqual(expectedFrom);
    expect(state.syncedTo).toBeGreaterThanOrEqual(expectedTo);

    unmount();
  });

  it('supports a manual retry after an error', async () => {
    const provider = makeProvider({ error: { code: 'unknown', message: 'boom' } });
    const helper = setup({ provider, autoSyncOnStart: false });

    await act(async () => {
      await helper.result.current.syncNow();
    });
    expect(helper.readState().status).toBe('error');

    (provider.fetchSchedule as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      providerId: 'magister',
      fetchedAt: '2026-08-30T01:00:00Z',
      events: [ext('les-9')],
    });
    await act(async () => {
      await helper.result.current.syncNow();
    });
    expect(helper.readState().status).toBe('success');
    expect(helper.readState().lastSyncAt).toBe('2026-08-30T01:00:00Z');
    expect(helper.getCurrent().some((e) => e.source === 'external')).toBe(true);
    helper.unmount();
  });
});