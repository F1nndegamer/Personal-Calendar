import { describe, expect, it, vi } from 'vitest';
import {
  collectPushEvents,
  collectPushPayload,
  collectPushTasks,
  pushToGoogle,
  setPushTarget,
  TASK_PUSH_ID_PREFIX,
} from '../googlePush';
import type { CalendarEvent } from '../../calendar/types';
import type { Task } from '../../tasks/types';

function local(id: string, over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    title: 'Event',
    start: '2026-09-08T08:00:00.000Z',
    end: '2026-09-08T09:00:00.000Z',
    color: 'blue',
    source: 'local',
    ...over,
  };
}

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: 'Homework',
    completed: false,
    priority: 'medium',
    color: 'blue',
    subtasks: [],
    ...over,
  };
}

/** Local wall-clock → ISO; keeps the assertions timezone-independent. */
const at = (y: number, m: number, d: number, h = 0, min = 0): string =>
  new Date(y, m - 1, d, h, min).toISOString();


describe('collectPushEvents', () => {
  it('includes manual and Magister events but never Google-sourced ones', () => {
    const manual = local('m1');
    const magister = local('x1', { source: 'external', externalId: 'magister:123' });
    const google = local('g1', { source: 'external', externalId: 'google:abc' });
    const out = collectPushEvents([manual, magister, google]);
    expect(out.map((e) => e.id)).toEqual(['m1', 'x1']);
  });

  it('normalizes titles and only sends descriptions that exist', () => {
    const out = collectPushEvents([local('a', { title: '  ', description: 'room 4' })]);
    expect(out[0].title).toBe('Untitled event');
    expect(out[0].description).toBe('room 4');
    const plain = collectPushEvents([local('b')]);
    expect(plain[0]).not.toHaveProperty('description');
    expect(plain[0]).toMatchObject({ id: 'b', start: local('b').start, end: local('b').end });
  });
});

describe('collectPushTasks', () => {
  it('mirrors a due time as a block of its estimate', () => {
    const out = collectPushTasks([
      task('t1', { dueDate: at(2026, 9, 30, 14, 30), estimatedMinutes: 45 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'task:t1',
      title: 'Homework',
      start: at(2026, 9, 30, 14, 30),
      end: at(2026, 9, 30, 15, 15),
    });
  });

  it('defaults to a 30 minute block and floors silly estimates', () => {
    const dflt = collectPushTasks([task('a', { dueDate: at(2026, 9, 30, 9, 0) })])[0];
    expect(dflt.end).toBe(at(2026, 9, 30, 9, 30));
    const tiny = collectPushTasks([
      task('b', { dueDate: at(2026, 9, 30, 9, 0), estimatedMinutes: 1 }),
    ])[0];
    expect(tiny.end).toBe(at(2026, 9, 30, 9, 5));
  });

  it('turns a date-only due date into an all-day event (exclusive end)', () => {
    const out = collectPushTasks([task('t2', { dueDate: at(2026, 9, 30) })]);
    expect(out[0].start).toBe('2026-09-30');
    expect(out[0].end).toBe('2026-10-01');
  });

  it('skips undated, unparseable and already scheduled tasks', () => {
    const out = collectPushTasks([
      task('a'),
      task('b', { dueDate: 'nonsense' }),
      task('c', { dueDate: at(2026, 9, 30, 10, 0), eventId: 'ev-1' }),
    ]);
    expect(out).toEqual([]);
  });

  it('keeps a completed task, marked with ✓ and explained', () => {
    const done = collectPushTasks([
      task('t3', { completed: true, dueDate: at(2026, 9, 30, 10, 0) }),
    ])[0];
    expect(done.title).toBe('✓ Homework');
    expect(done.description).toContain('Completed in Personal Calendar.');
    const open = collectPushTasks([task('t4', { dueDate: at(2026, 9, 30, 10, 0) })])[0];
    expect(open.title).toBe('Homework');
    expect(open).not.toHaveProperty('description');
  });

  it('folds notes, subtasks, priority and category into the description', () => {
    const out = collectPushTasks([
      task('t5', {
        dueDate: at(2026, 9, 30, 10, 0),
        description: 'Chapters 1-3',
        category: ' School ',
        priority: 'high',
        subtasks: [
          { id: 's1', title: 'Read', completed: true },
          { id: 's2', title: 'Summarize', completed: false },
        ],
      }),
    ])[0];
    expect(out.description).toContain('Chapters 1-3');
    expect(out.description).toContain('☑ Read');
    expect(out.description).toContain('☐ Summarize');
    expect(out.description).toContain('Priority: high · Category: School');
    expect(out.description).toContain('— Personal Calendar task');
  });

  it('falls back to a readable title for a blank one', () => {
    const out = collectPushTasks([task('t6', { title: '   ', dueDate: at(2026, 9, 30, 10, 0) })]);
    expect(out[0].title).toBe('Untitled task');
  });
});

describe('collectPushPayload', () => {
  it('sends events first and mirrored tasks after, keyed with a task: prefix', () => {
    const out = collectPushPayload(
      [local('e1'), local('g1', { source: 'external', externalId: 'google:abc' })],
      [task('t1', { dueDate: at(2026, 9, 30, 10, 0) })],
    );
    expect(TASK_PUSH_ID_PREFIX).toBe('task:');
    expect(out.map((e) => e.id)).toEqual(['e1', 'task:t1']);
  });

  it('is events-only when no tasks are passed', () => {
    expect(collectPushPayload([local('e1')]).map((e) => e.id)).toEqual(['e1']);
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('pushToGoogle', () => {
  it('posts the full event list and maps the response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { ok: true, created: 2, updated: 1, deleted: 0, skipped: 3, errors: [] }),
    );
    const events = [{ id: 'a', title: 'T', start: '2026-09-08T08:00:00Z', end: '2026-09-08T09:00:00Z' }];
    const r = await pushToGoogle(events, fetchImpl);
    expect(r).toMatchObject({ ok: true, created: 2, updated: 1, skipped: 3, error: undefined });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/google/push');
    expect(JSON.parse(String(init.body))).toEqual({ events });
  });

  it('treats 429 as a benign busy signal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { ok: false, error: 'busy' }));
    const r = await pushToGoogle([], fetchImpl);
    expect(r).toMatchObject({ ok: true, busy: true });
  });

  it('surfaces HTTP and partial-failure errors', async () => {
    const fatal = vi.fn().mockResolvedValue(jsonResponse(500, { ok: false, error: 'server exploded' }));
    const r1 = await pushToGoogle([], fatal);
    expect(r1).toMatchObject({ ok: false, error: 'server exploded' });

    const partial = vi.fn().mockResolvedValue(jsonResponse(200, {
      ok: false, created: 1, updated: 0, deleted: 0, skipped: 0,
      errors: [{ id: 'a', error: 'Event create failed with HTTP 500' }],
    }));
    const r2 = await pushToGoogle([], partial);
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/HTTP 500/);
  });

  it('never throws on a network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const r = await pushToGoogle([], fetchImpl);
    expect(r).toMatchObject({ ok: false, error: 'offline' });
  });
});

describe('setPushTarget', () => {
  it('posts the calendar id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    await setPushTarget('work@example.com', fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/google/push-target');
    expect(JSON.parse(String(init.body))).toEqual({ calendarId: 'work@example.com' });
  });

  it('throws the server error message on failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { ok: false, error: 'That calendar is read-only' }));
    await expect(setPushTarget('primary', fetchImpl)).rejects.toThrow(/read-only/);
  });
});
