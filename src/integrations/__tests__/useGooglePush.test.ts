import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useGooglePush } from '../useGooglePush';
import type { CalendarEvent } from '../../calendar/types';
import type { Task } from '../../tasks/types';

const mocks = vi.hoisted(() => ({
  refreshGoogleAvailability: vi.fn<(impl?: unknown) => Promise<boolean>>(),
  pushToGoogle: vi.fn(),
}));

vi.mock('../index', () => ({
  refreshGoogleAvailability: mocks.refreshGoogleAvailability,
}));
vi.mock('../googlePush', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../googlePush')>();
  return { ...actual, pushToGoogle: mocks.pushToGoogle };
});

const manualEvent: CalendarEvent = {
  id: 'ev1',
  title: 'Wiskunde',
  start: '2026-09-08T08:00:00.000Z',
  end: '2026-09-08T09:00:00.000Z',
  color: 'blue',
  source: 'local',
};

const OK = { ok: true, created: 1, updated: 0, deleted: 0, skipped: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.refreshGoogleAvailability.mockResolvedValue(true);
  mocks.pushToGoogle.mockResolvedValue(OK);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useGooglePush', () => {
  it('pushes the current events and reports success', async () => {
    const { result } = renderHook(() => useGooglePush({ getEvents: () => [manualEvent] }));
    await act(async () => {
      await result.current.pushNow();
    });
    expect(mocks.pushToGoogle).toHaveBeenCalledTimes(1);
    expect(mocks.pushToGoogle.mock.calls[0][0]).toEqual([
      expect.objectContaining({ id: 'ev1', title: 'Wiskunde' }),
    ]);
    expect(result.current.state.status).toBe('success');
    expect(result.current.state.created).toBe(1);
    expect(result.current.state.lastPushAt).toBeDefined();
  });

  it('mirrors tasks with a due date alongside events', async () => {
    const homework: Task = {
      id: 't1',
      title: 'Math homework',
      completed: false,
      priority: 'medium',
      color: 'blue',
      dueDate: '2026-09-30T12:00:00.000Z',
      estimatedMinutes: 45,
      subtasks: [],
    };
    const { result } = renderHook(() =>
      useGooglePush({ getEvents: () => [manualEvent], getTasks: () => [homework] }),
    );
    await act(async () => {
      await result.current.pushNow();
    });
    const payload = mocks.pushToGoogle.mock.calls[0][0] as { id: string }[];
    expect(payload.map((e) => e.id)).toEqual(['ev1', 'task:t1']);
    expect(payload[1]).toMatchObject({
      title: 'Math homework',
      start: '2026-09-30T12:00:00.000Z',
      end: '2026-09-30T12:45:00.000Z',
    });
  });

  it('stays silent when Google is not connected', async () => {
    mocks.refreshGoogleAvailability.mockResolvedValue(false);
    const { result } = renderHook(() => useGooglePush({ getEvents: () => [manualEvent] }));
    await act(async () => {
      await result.current.pushNow();
    });
    expect(mocks.pushToGoogle).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe('idle');
  });

  it('reports push failures on the state', async () => {
    mocks.pushToGoogle.mockResolvedValue({ ...OK, ok: false, created: 0, error: 'server exploded' });
    const { result } = renderHook(() => useGooglePush({ getEvents: () => [manualEvent] }));
    await act(async () => {
      await result.current.pushNow();
    });
    expect(result.current.state.status).toBe('error');
    expect(result.current.state.errorMessage).toBe('server exploded');
  });

  it('returns to idle when another tab is already pushing', async () => {
    mocks.pushToGoogle.mockResolvedValue({ ...OK, busy: true, created: 0 });
    const { result } = renderHook(() => useGooglePush({ getEvents: () => [manualEvent] }));
    await act(async () => {
      await result.current.pushNow();
    });
    expect(result.current.state.status).toBe('idle');
  });

  it('schedulePush is debounced and coalesces rapid calls', async () => {
    const { result } = renderHook(() => useGooglePush({ getEvents: () => [manualEvent] }));
    act(() => {
      result.current.schedulePush(20);
    });
    expect(mocks.pushToGoogle).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.pushToGoogle).toHaveBeenCalledTimes(1));
    // Coalescing: a second schedule while one is pending fires only once.
    act(() => {
      result.current.schedulePush(30);
      result.current.schedulePush(30);
    });
    await waitFor(() => expect(mocks.pushToGoogle).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 80));
    expect(mocks.pushToGoogle).toHaveBeenCalledTimes(2);
  });

  it('coalesces pushes requested while one is running', async () => {
    vi.useFakeTimers();
    mocks.refreshGoogleAvailability.mockResolvedValue(true);
    let resolveFirst: (v: typeof OK) => void = () => {};
    mocks.pushToGoogle
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValue({ ...OK, created: 0 });

    const { result } = renderHook(() => useGooglePush({ getEvents: () => [manualEvent] }));

    let first!: Promise<void>;
    await act(async () => {
      first = result.current.pushNow();
      await Promise.resolve();
    });
    expect(mocks.pushToGoogle).toHaveBeenCalledTimes(1);

    // Requested again while running → recorded as pending, not started.
    await act(async () => {
      void result.current.pushNow();
      await Promise.resolve();
    });
    expect(mocks.pushToGoogle).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst(OK);
      await first;
    });
    expect(result.current.state.status).toBe('success');

    // The pending request is re-scheduled (1500 ms) and then runs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(mocks.pushToGoogle).toHaveBeenCalledTimes(2);
  });
});
