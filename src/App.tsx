import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, startOfDay, startOfWeek } from './calendar/lib';
import type { CalendarEvent, CalendarView } from './calendar/types';
import { CalendarToolbar } from './calendar/CalendarToolbar';
import { CalendarGrid } from './calendar/CalendarGrid';
import { EventDialog } from './calendar/EventDialog';
import type { Task } from './tasks/types';
import { TaskPanel } from './tasks/TaskPanel';
import { TaskDialog } from './tasks/TaskDialog';
import { QuickAdd } from './quickAdd/QuickAdd';
import type { ParsedQuickAdd } from './quickAdd/types';
import { loadSnapshot, saveSnapshot } from './storage/storage';
import { useScheduleSync } from './integrations/useScheduleSync';
import { Settings } from './components/Settings';
import { loadFromServer, saveToServer } from './serverStorage';

const uid = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** Phone-width media query — the single source of truth for the mobile layout. */
const PHONE_QUERY = '(max-width: 700px)';

/** Whether a compact phone layout should be the starting point. */
function prefersPhoneLayout(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches
  );
}

/** True when focus is inside an input, textarea, select, or [contenteditable]. */
function isEditingElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    el.hasAttribute('contenteditable')
  );
}

interface Toast {
  id: number;
  message: string;
}

let toastId = 0;

/** Read the currently-configured feed URL (localStorage or env). */
function getCurrentFeedUrl(): string | null {
  try {
    const stored = localStorage.getItem('calendar-app/feedUrl');
    if (stored && stored.trim().length > 0) return stored.trim();
  } catch {/* ignore */}
  const envFeed = import.meta.env.VITE_MAGISTER_FEED_URL as string | undefined;
  if (envFeed && envFeed.trim().length > 0) return envFeed.trim();
  return null;
}

export default function App() {
  // Whether we've finished loading the initial dataset. The first render
  // shows a brief loading state so we don't flash mock/empty data before
  // the server has had a chance to respond.
  const [loading, setLoading] = useState(true);

  // The user's runtime-configured feed URL. Empty string means "not set".
  const [feedUrl, setFeedUrl] = useState<string>(getCurrentFeedUrl() ?? '');

  // Track if a server load has been attempted (so we don't keep retrying
  // on every render if the server is unreachable).
  const [serverAttempted, setServerAttempted] = useState(false);

  const [view, setView] = useState<CalendarView>(() =>
    prefersPhoneLayout() ? 'day' : 'week',
  );
  const [anchor, setAnchor] = useState(() =>
    prefersPhoneLayout() ? startOfDay(new Date()) : startOfWeek(new Date()),
  );
  const [isMobile, setIsMobile] = useState(prefersPhoneLayout);
  const [activePane, setActivePane] = useState<'calendar' | 'tasks'>(
    'calendar',
  );

  // Default dataset — replaced by the loaded snapshot once it arrives.
  const [initial] = useState<{ events: CalendarEvent[]; tasks: Task[] }>(() => {
    const stored = loadSnapshot();
    return stored ?? { events: [], tasks: [] };
  });
  const [events, setEvents] = useState<CalendarEvent[]>(initial.events);
  const [tasks, setTasks] = useState<Task[]>(initial.tasks);
  const [dialogEvent, setDialogEvent] = useState<CalendarEvent | null>(null);
  const [isNewEvent, setIsNewEvent] = useState(false);
  const [dialogTask, setDialogTask] = useState<Task | null>(null);
  const [isNewTask, setIsNewTask] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const now = new Date();

  // On mount, try to load the full dataset from the server. The server is
  // the source of truth — it lets us sync events/tasks across devices.
  // Falls back to the local localStorage snapshot if the server is
  // unreachable (e.g. during local dev without the proxy).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const remote = await loadFromServer();
        if (cancelled) return;
        if (remote) {
          if (remote.events.length > 0) setEvents(remote.events);
          if (remote.tasks.length > 0) setTasks(remote.tasks);
          if (remote.feedUrl) setFeedUrl(remote.feedUrl);
        }
      } catch {
        // Server unreachable — local data is the best we have
      } finally {
        if (!cancelled) {
          setServerAttempted(true);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Restore the last-used view + anchor from localStorage. We do this AFTER
  // the server load so that anchor updates coming from the server (if any)
  // take precedence over the localStorage value.
  useEffect(() => {
    if (!serverAttempted) return;
    try {
      const storedView = localStorage.getItem('calendar-app/view');
      if (storedView === 'day' || storedView === 'week') {
        // Don't override if the user is on a phone and the stored view
        // would be wrong for the screen size
        if (!prefersPhoneLayout() || storedView === 'day') {
          setView(storedView);
        }
      }
      const storedAnchor = localStorage.getItem('calendar-app/anchor');
      if (storedAnchor) {
        const t = new Date(storedAnchor).getTime();
        if (Number.isFinite(t)) {
          setAnchor(new Date(t));
        }
      }
    } catch {/* ignore */}
  }, [serverAttempted]);

  // Keep the phone-layout flag in sync when the viewport crosses the
  // breakpoint (rotation, window resize). Layout-only concern: the existing
  // view/pane state is preserved either way.
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const handleSaveSettings = (newFeedUrl: string) => {
    const trimmed = newFeedUrl.trim();
    setFeedUrl(trimmed);
    try {
      if (trimmed) {
        localStorage.setItem('calendar-app/feedUrl', trimmed);
      } else {
        localStorage.removeItem('calendar-app/feedUrl');
      }
    } catch {/* ignore */}
    // Also persist to server so other devices can see the change
    saveToServer({ events, tasks, feedUrl: trimmed || null });
    showToast(trimmed ? 'Settings saved. Reload to apply.' : 'Settings saved.');
  };

  /**
   * Pull the latest events/tasks/feedUrl from the server and replace local state.
   * Used by the Reload button so the user can pick up changes made on other
   * devices without a full page refresh. The server is the source of truth
   * for cross-device sync.
   */
  const [reloading, setReloading] = useState(false);
  const handleReloadFromServer = async () => {
    if (reloading) return;
    setReloading(true);
    try {
      const remote = await loadFromServer();
      if (remote) {
        if (remote.events.length > 0) setEvents(remote.events);
        if (remote.tasks.length > 0) setTasks(remote.tasks);
        if (remote.feedUrl) setFeedUrl(remote.feedUrl);
        showToast('Reloaded from server.');
      } else {
        showToast('Server unreachable — using local data.');
      }
      // Also refresh the Magister feed so we get the latest external events.
      if (sync.configured) sync.syncNow();
    } catch {
      showToast('Reload failed.');
    } finally {
      setReloading(false);
    }
  };

  const showToast = (message: string) => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2400);
  };

  // Global desktop shortcut: "N" opens the quick-add dialog.
  // Ignored when the user is typing inside an input/textarea/select/dialog/contenteditable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditingElement(document.activeElement)) return;
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setQuickAddOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Persist automatically whenever the data changes. While the state still
  // refers to the initial dataset (mock or loaded) nothing has been modified
  // yet, so nothing is written — a fresh browser keeps meaning mock data.
  // (Reference-equality guard instead of a "first run" flag: safe under
  // StrictMode's double-invoked effects.)
  useEffect(() => {
    if (events === initial.events && tasks === initial.tasks) return;
    saveSnapshot({ events, tasks });
    saveToServer({ events, tasks, feedUrl: feedUrl || null });
  }, [events, tasks, initial, feedUrl]);

  // Persist view + anchor to localStorage so the user comes back to the
  // same spot. The server snapshot intentionally does NOT include these —
  // each device has its own preferred view.
  useEffect(() => {
    try {
      localStorage.setItem('calendar-app/view', view);
      localStorage.setItem('calendar-app/anchor', anchor.toISOString());
    } catch {/* ignore */}
  }, [view, anchor]);

  // External schedule sync — handled by the reusable orchestration hook
  // (see src/integrations/useScheduleSync.ts). It runs once on startup when a
  // real feed is configured, and on manual "Sync". Sync state is separate
  // from calendar events.
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const sync = useScheduleSync({
    getEvents: () => eventsRef.current,
    commitEvents: (next) => setEvents(next),
    persist: (next) => {
      saveSnapshot({ events: next, tasks });
      saveToServer({ events: next, tasks, feedUrl: feedUrl || null });
    },
    // Use `anchor` (the stable navigation anchor) rather than `now` (which
    // is a new Date on every render). Basing the range on anchor means the
    // range only changes when the user navigates, not on every re-render.
    fetchRange: () => ({
      from: startOfDay(anchor),
      // 60 days gives ~8 weeks of forward coverage, reducing the chance
      // the visible range grows faster than the fetched window.
      to: addDays(anchor, 60),
    }),
  });

  // On every navigation (anchor changes), call syncIfNeeded. This extends
  // the synced coverage whenever the visible range grows. The hook itself
  // guards against duplicate syncs (runningRef) and only fetches the union
  // of the new visible range and whatever is already covered.
  useEffect(() => {
    if (sync.configured) void sync.syncIfNeeded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, sync.configured]);

  const days = useMemo(() => {
    if (view === 'day') return [startOfDay(anchor)];
    return Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));
  }, [view, anchor]);

  const goPrev = () => setAnchor((a) => addDays(a, view === 'day' ? -1 : -7));
  const goNext = () => setAnchor((a) => addDays(a, view === 'day' ? 1 : 7));
  const goToday = () =>
    setAnchor(view === 'week' ? startOfWeek(now) : startOfDay(now));

  const handleEventChange = (id: string, start: Date, end: Date) => {
    setEvents((prev) =>
      prev.map((e) =>
        e.id === id
          ? { ...e, start: start.toISOString(), end: end.toISOString() }
          : e,
      ),
    );
  };

  const handleSlotClick = (day: Date, startMin: number) => {
    const start = new Date(day);
    start.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
    const end = new Date(start.getTime() + 60 * 60_000);
    setDialogEvent({
      id: uid('ev'),
      title: '',
      start: start.toISOString(),
      end: end.toISOString(),
      color: 'blue',
    });
    setIsNewEvent(true);
  };

  const handleEventClick = (event: CalendarEvent) => {
    setDialogEvent(event);
    setIsNewEvent(false);
  };

  const handleSaveEvent = (event: CalendarEvent) => {
    setEvents((prev) => {
      const exists = prev.some((e) => e.id === event.id);
      return exists
        ? prev.map((e) => (e.id === event.id ? event : e))
        : [...prev, event];
    });
    // keep the task's link in sync with the event's date/time
    if (event.taskId) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === event.taskId ? { ...t, eventId: event.id } : t,
        ),
      );
    }
    setDialogEvent(null);
  };

  const handleDeleteEvent = (id: string) => {
    const removed = events.find((e) => e.id === id);
    setEvents((prev) => prev.filter((e) => e.id !== id));
    if (removed?.taskId) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === removed.taskId ? { ...t, eventId: undefined } : t,
        ),
      );
    }
    setDialogEvent(null);
  };

  // ----- tasks -----

  const handleToggleTask = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)),
    );
  };

  // ----- quick-add ----

  const handleQuickAdd = (parsed: ParsedQuickAdd) => {
    const task: Task = {
      id: uid('task'),
      title: parsed.title,
      completed: false,
      priority: 'medium',
      color: 'blue',
      subtasks: [],
      dueDate: parsed.dueDate,
      estimatedMinutes: parsed.estimatedMinutes,
    };
    setTasks((prev) => [...prev, task]);
    showToast(`Added "${parsed.title}"`);
    setQuickAddOpen(false);
  };

  const handleTaskClick = (task: Task) => {
    setDialogTask(task);
    setIsNewTask(false);
  };

  const handleNewTask = () => {
    setDialogTask({
      id: uid('task'),
      title: '',
      completed: false,
      priority: 'medium',
      color: 'blue',
      subtasks: [],
    });
    setIsNewTask(true);
  };

  const handleSaveTask = (task: Task) => {
    setTasks((prev) => {
      const exists = prev.some((t) => t.id === task.id);
      return exists
        ? prev.map((t) => (t.id === task.id ? task : t))
        : [...prev, task];
    });
    setDialogTask(null);
  };

  const handleDeleteTask = (id: string) => {
    const removed = tasks.find((t) => t.id === id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (removed?.eventId) {
      setEvents((prev) => prev.filter((e) => e.id !== removed.eventId));
    }
    setDialogTask(null);
  };

  // ----- task → calendar drag & drop -----

  const handleTaskDragStart = (task: Task, e: React.DragEvent) => {
    e.dataTransfer.setData('text/task-id', task.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleTaskDrop = (taskId: string, day: Date, startMin: number) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const start = new Date(day);
    start.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
    const duration = (task.estimatedMinutes ?? 60) * 60_000;
    const event: CalendarEvent = {
      id: uid('ev'),
      title: task.title,
      description: task.description,
      start: start.toISOString(),
      end: new Date(start.getTime() + duration).toISOString(),
      color: task.color,
      category: task.category,
      taskId: task.id,
    };
    setEvents((prev) => [...prev, event]);
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, eventId: event.id } : t)),
    );
  };

  const selectedEvent = dialogEvent
    ? (events.find((e) => e.id === dialogEvent.id) ?? dialogEvent)
    : null;
  const selectedTask = dialogTask
    ? (tasks.find((t) => t.id === dialogTask.id) ?? dialogTask)
    : null;
  /** Open (not completed) tasks — shown as a count on the mobile Tasks tab. */
  const openTaskCount = tasks.filter((t) => !t.completed).length;

  return (
    <div className={`app with-tasks${isMobile ? ' mobile' : ''}${loading ? ' loading' : ''}`}>
      {loading && (
        <div className="app-loading-overlay" aria-hidden={!loading}>
          <div className="app-loading-spinner" />
        </div>
      )}
      <div className="mobile-panes">
        <div
          className={`tasks-pane${isMobile && activePane !== 'tasks' ? ' pane-hidden' : ''}`}
        >
          <TaskPanel
            tasks={tasks}
            onToggle={handleToggleTask}
            onTaskClick={handleTaskClick}
            onNewTask={handleNewTask}
            onTaskDragStart={handleTaskDragStart}
            onTaskDragEnd={() => undefined}
          />
        </div>
        <div
          className={`calendar-pane view-${view}${isMobile && activePane !== 'calendar' ? ' pane-hidden' : ''}`}
        >
          <CalendarToolbar
            view={view}
            days={days}
            today={now}
            onViewChange={setView}
            onPrev={goPrev}
            onNext={goNext}
            onToday={goToday}
            syncState={sync.state}
            syncConfigured={sync.configured}
            onSync={sync.syncNow}
            isMobile={isMobile}
            onSettings={() => setSettingsOpen(true)}
            onReload={handleReloadFromServer}
          />
          <CalendarGrid
            days={days}
            events={events}
            now={now}
            onEventChange={handleEventChange}
            onEventClick={handleEventClick}
            onSlotClick={handleSlotClick}
            onTaskDrop={handleTaskDrop}
          />
        </div>
      </div>
      {isMobile && (
        <nav
          className="mobile-nav"
          aria-label="Switch between calendar and tasks"
        >
          <button
            className={`mobile-nav-btn${activePane === 'calendar' ? ' active' : ''}`}
            aria-pressed={activePane === 'calendar'}
            onClick={() => setActivePane('calendar')}
          >
            Calendar
          </button>
          <button
            className={`mobile-nav-btn${activePane === 'tasks' ? ' active' : ''}`}
            aria-pressed={activePane === 'tasks'}
            onClick={() => setActivePane('tasks')}
          >
            Tasks{openTaskCount > 0 ? ` (${openTaskCount})` : ''}
          </button>
        </nav>
      )}
      {isMobile && (
        <button
          className="mobile-fab"
          aria-label="Quick add a task"
          onClick={() => setQuickAddOpen(true)}
        >
          +
        </button>
      )}
      {selectedEvent && (
        <EventDialog
          event={selectedEvent}
          isNew={isNewEvent || !events.some((e) => e.id === selectedEvent.id)}
          readOnly={selectedEvent.source === 'external'}
          onSave={handleSaveEvent}
          onDelete={handleDeleteEvent}
          onClose={() => setDialogEvent(null)}
        />
      )}
      {selectedTask && (
        <TaskDialog
          task={selectedTask}
          isNew={isNewTask || !tasks.some((t) => t.id === selectedTask.id)}
          onSave={handleSaveTask}
          onDelete={handleDeleteTask}
          onClose={() => setDialogTask(null)}
        />
      )}
      {quickAddOpen && (
        <QuickAdd
          open={quickAddOpen}
          onClose={() => setQuickAddOpen(false)}
          onAddTask={handleQuickAdd}
        />
      )}
      {settingsOpen && (
        <Settings
          feedUrl={feedUrl}
          onSave={handleSaveSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.message}
        </div>
      ))}
    </div>
  );
}
