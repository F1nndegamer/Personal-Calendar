import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CommandPalette } from '../CommandPalette';
import type { CalendarEvent } from '../../calendar/types';
import type { Task } from '../../tasks/types';
import type { CommandItem } from '../search';

// RTL only auto-cleans up when vitest globals are enabled and this repo keeps
// them off, so each test cleans up explicitly.
afterEach(cleanup);

const NOW = new Date('2026-09-27T12:00:00');

const EVENTS: CalendarEvent[] = [
  {
    id: 'ev1',
    title: 'Maths lesson',
    start: '2026-09-27T14:00:00',
    end: '2026-09-27T15:00:00',
    color: 'blue',
  },
];

const TASKS: Task[] = [
  {
    id: 't1',
    title: 'Physics homework',
    completed: false,
    priority: 'high',
    color: 'blue',
    subtasks: [],
    dueDate: '2026-09-27T17:00:00',
  },
];

/** Two actions with distinct spies, so "which one ran" is unambiguous. */
function makeActions() {
  const today = vi.fn();
  const settings = vi.fn();
  const actions: CommandItem[] = [
    { id: 'action:today', group: 'action', title: 'Go to today', hint: 'T', run: today },
    { id: 'action:settings', group: 'action', title: 'Open settings', run: settings },
  ];
  return { actions, today, settings };
}

function renderPalette(
  actions: CommandItem[],
  onClose: () => void = vi.fn(),
  { events = EVENTS, tasks = TASKS } = {},
) {
  render(
    <CommandPalette onClose={onClose} actions={actions} events={events} tasks={tasks} now={NOW} />,
  );
  return { onClose };
}

const input = () => screen.getByRole('combobox') as HTMLInputElement;

describe('CommandPalette', () => {
  it('groups results under Actions, Events and Tasks', () => {
    const { actions } = makeActions();
    renderPalette(actions);
    expect(screen.getByRole('group', { name: 'Actions' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Events' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Tasks' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Maths lesson/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Physics homework/ })).toBeTruthy();
  });

  it('focuses the search field on mount', () => {
    const { actions } = makeActions();
    renderPalette(actions);
    expect(document.activeElement).toBe(input());
  });

  it('filters as you type', () => {
    const { actions } = makeActions();
    renderPalette(actions);
    fireEvent.change(input(), { target: { value: 'settings' } });
    expect(screen.getByRole('option', { name: /Open settings/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Go to today/ })).toBeNull();
  });

  it('shows an empty state when nothing matches', () => {
    const { actions } = makeActions();
    renderPalette(actions, vi.fn(), { events: [], tasks: [] });
    fireEvent.change(input(), { target: { value: 'zzzzzz' } });
    expect(screen.getByText(/No matches for/)).toBeTruthy();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('highlights the first result and runs it on Enter', () => {
    const { actions, today, settings } = makeActions();
    const onClose = vi.fn();
    renderPalette(actions, onClose);

    expect(screen.getByRole('option', { name: /Go to today/ }).getAttribute('aria-selected'))
      .toBe('true');

    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(today).toHaveBeenCalledTimes(1);
    expect(settings).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves the highlight with the arrow keys and wraps at the end', () => {
    const { actions, today, settings } = makeActions();
    renderPalette(actions, vi.fn());
    const selected = (name: RegExp) =>
      screen.getByRole('option', { name }).getAttribute('aria-selected');

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(selected(/Open settings/)).toBe('true');
    expect(selected(/Go to today/)).toBe('false');

    // Arrow keys walk the whole list, not just within a group.
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(selected(/Maths lesson/)).toBe('true');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(selected(/Physics homework/)).toBe('true');

    // Wrapping keeps the list circular rather than dead-ending at either end.
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(selected(/Go to today/)).toBe('true');
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(selected(/Physics homework/)).toBe('true');

    fireEvent.keyDown(input(), { key: 'End' });
    expect(selected(/Physics homework/)).toBe('true');
    fireEvent.keyDown(input(), { key: 'Home' });
    expect(selected(/Go to today/)).toBe('true');

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(settings).toHaveBeenCalledTimes(1);
    expect(today).not.toHaveBeenCalled();
  });

  it('closes on Escape without running anything', () => {
    const { actions, today, settings } = makeActions();
    const onClose = vi.fn();
    renderPalette(actions, onClose);

    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(today).not.toHaveBeenCalled();
    expect(settings).not.toHaveBeenCalled();
  });

  it('runs an item on pointer-down', () => {
    const { actions, settings } = makeActions();
    const onClose = vi.fn();
    renderPalette(actions, onClose);

    fireEvent.pointerDown(screen.getByRole('option', { name: /Open settings/ }));
    expect(settings).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('points aria-activedescendant at the highlighted option', () => {
    const { actions } = makeActions();
    renderPalette(actions);

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    const active = input().getAttribute('aria-activedescendant');
    expect(active).toBe(screen.getByRole('option', { name: /Open settings/ }).id);
    expect(document.getElementById(active ?? '')?.getAttribute('aria-selected')).toBe('true');
  });
});
