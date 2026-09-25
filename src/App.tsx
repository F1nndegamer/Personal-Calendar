import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { addDays, addMonths, addYears, monthGrid, startOfDay, startOfMonth, startOfWeek } from './calendar/lib';
import type { CalendarEvent, CalendarView } from './calendar/types';
import { CalendarToolbar } from './calendar/CalendarToolbar';
import { CalendarGrid } from './calendar/CalendarGrid';
import { MonthView } from './calendar/MonthView';
import { NextUp } from './calendar/NextUp';
import { EventDialog } from './calendar/EventDialog';
import type { Task } from './tasks/types';
import { TaskPanel } from './tasks/TaskPanel';
import { isOverdue } from './tasks/lib';
import { applyBuffer, timesChanged, DEFAULT_BUFFER_MIN } from './calendar/buffer';
import { TaskDialog } from './tasks/TaskDialog';
import { QuickAdd } from './quickAdd/QuickAdd';
import type { ParsedQuickAdd } from './quickAdd/types';
import { loadSnapshot, saveSnapshot } from './storage/storage';
import { useScheduleSync } from './integrations/useScheduleSync';
import { useGooglePush } from './integrations/useGooglePush';
import { Settings } from './components/Settings';
import { loadFromServer, saveToServer } from './serverStorage';
import { usePwaInstall } from './pwa';
import {
  EVENT_LEAD_MINUTES,
  REMINDER_SCAN_MS,
  TASK_LEAD_MINUTES,
  describeEventReminder,
  describeTaskDeadline,
  notificationPermission,
  notify,
  requestNotifyPermission,
  setNotificationsEnabled,
} from './notifications/notify';

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

/**
 * The last-used view, falling back to the screen-appropriate default.
 *
 * This is read during the first render (via a lazy `useState` initialiser)
 * rather than restored from an effect: an effect would render one frame with
 * the wrong view and then immediately re-render — the "cascading render" that
 * makes the calendar visibly flicker on load.
 */
function getInitialView(): CalendarView {
  try {
    const stored = localStorage.getItem('calendar-app/view');
    if (stored === 'day') return 'day';
    // Month view is the one multi-day view that fits a phone, so it is kept on
    // both layouts; only 'week' is desktop-only.
    if (stored === 'month') return 'month';
    // A stored 'week' doesn't fit a phone screen, which has room for one day.
    if (stored === 'week' && !prefersPhoneLayout()) return 'week';
  } catch {/* ignore */}
  return prefersPhoneLayout() ? 'day' : 'week';
}

/**
 * The last-used anchor, falling back to today (phone) or this week (desktop).
 * Restored the same way as {@link getInitialView}, for the same reason.
 */
function getInitialAnchor(): Date {
  try {
    const stored = localStorage.getItem('calendar-app/anchor');
    if (stored) {
      const t = new Date(stored).getTime();
      if (Number.isFinite(t)) return new Date(t);
    }
  } catch {/* ignore */}
  return prefersPhoneLayout() ? startOfDay(new Date()) : startOfWeek(new Date());
}

/* ---------- Phone-layout media query, as an external store ---------- */

function subscribePhoneQuery(onStoreChange: () => void): () => void {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener('change', onStoreChange);
  return () => mq.removeEventListener('change', onStoreChange);
}

/** Same breakpoint the CSS uses, so layout and logic can never disagree. */
const getPhoneQuerySnapshot = (): boolean => prefersPhoneLayout();

const getPhoneQueryServerSnapshot = (): boolean => false;

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

interface ToastAction {
  label: string;
  run: () => void;
}

interface Toast {
  id: number;
  message: string;
  /** Optional inline affordance (e.g. Undo) rendered as a button. */
  action?: ToastAction;
  /** How long the toast stays up, in ms. Defaults to 2400. */
  durationMs?: number;
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
  const [, setServerAttempted] = useState(false);

  const [view, setView] = useState<CalendarView>(getInitialView);
  const [anchor, setAnchor] = useState<Date>(getInitialAnchor);
  const isMobile = useSyncExternalStore(
    subscribePhoneQuery,
    getPhoneQuerySnapshot,
    getPhoneQueryServerSnapshot,
  );
  const [activePane, setActivePane] = useState<'calendar' | 'tasks'>(() => {
    // Remember which tab the user was on so a reload doesn't always dump them
    // back on the calendar.
    try {
      return localStorage.getItem('calendar-app/pane') === 'tasks'
        ? 'tasks'
        : 'calendar';
    } catch {
      return 'calendar';
    }
  });

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
  // PWA install state — drives the "Add to home screen" banner. Dismissal
  // lasts for the session only (so a future visit can still offer it).
  const { state: pwaState, install: pwaInstall } = usePwaInstall();
  const [installDismissed, setInstallDismissed] = useState(
    () => sessionStorage.getItem('calendar-app/installDismissed') === '1',
  );
  const dismissInstall = () => {
    sessionStorage.setItem('calendar-app/installDismissed', '1');
    setInstallDismissed(true);
  };
  // OLED theme state (persisted separately from the main data snapshot so
  // it survives across devices via localStorage but never touches the server)
  const [oledMode, setOledMode] = useState<boolean>(() => {
    try { return localStorage.getItem('calendar-app/oledMode') === 'true'; } catch {/* ignore */}
    return false;
  });
  const [autoOledMode, setAutoOledMode] = useState<boolean>(() => {
    try { return localStorage.getItem('calendar-app/autoOledMode') === 'true'; } catch {/* ignore */}
    return false;
  });
  const [oledModeStart, setOledModeStart] = useState<string>(() => {
    try { return localStorage.getItem('calendar-app/oledModeStart') ?? '22:00'; } catch {/* ignore */}
    return '22:00';
  });
  const [oledModeEnd, setOledModeEnd] = useState<string>(() => {
    try { return localStorage.getItem('calendar-app/oledModeEnd') ?? '07:00'; } catch {/* ignore */}
    return '07:00';
  });
  // Smart-buffer minutes kept between events (0 disables the feature).
  const [bufferMinutes, setBufferMinutes] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('calendar-app/bufferMinutes');
      if (raw !== null && Number.isFinite(Number(raw))) return Number(raw);
    } catch {/* ignore */}
    return DEFAULT_BUFFER_MIN;
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOn, setNotificationsOn] = useState(() => {
    try {
      return localStorage.getItem('calendar-app/notify') === 'on';
    } catch {
      return false;
    }
  });
  const [notifyPermission, setNotifyPermission] = useState(notificationPermission());
  const now = new Date();

  /** Enable/disable notifications; on first enable, request browser permission. */
  const handleNotificationsToggle = async (on: boolean) => {
    if (on) {
      const granted = await requestNotifyPermission();
      setNotifyPermission(notificationPermission());
      setNotificationsOn(granted);
      setNotificationsEnabled(granted);
      showToast(granted ? 'Notifications on' : 'Notifications blocked — check browser settings');
    } else {
      setNotificationsOn(false);
      setNotificationsEnabled(false);
      showToast('Notifications off');
    }
  };

  // ---- Notifications: upcoming class + task deadline reminders ----
  // The scan runs when data changes and on a one-minute tick while the app
  // is open. Each reminder fires at most once per (id, minute) via
  // sessionStorage, so re-renders never double-notify.
  const notifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (notificationPermission() !== 'granted') return;
    const notified = notifiedRef.current;
    const scan = () => {
      const t = Date.now();
      const tag = (key: string) => `cal-${key}`;
      for (const ev of events) {
        const start = new Date(ev.start).getTime();
        const delta = start - t;
        // inside the lead window and still in the future
        if (delta > 0 && delta <= EVENT_LEAD_MINUTES * 60_000) {
          const key = `${tag(ev.id)}@${new Date(ev.start).toISOString()}`;
          if (!notified.has(key)) {
            notified.add(key);
            const m = describeEventReminder(ev);
            notify(m.title, m.body, tag(ev.id));
          }
        }
      }
      for (const task of tasks) {
        if (task.completed || !task.dueDate) continue;
        const due = new Date(task.dueDate).getTime();
        const delta = due - t;
        if (delta > 0 && delta <= TASK_LEAD_MINUTES * 60_000) {
          const key = `${tag(task.id)}@${task.dueDate}`;
          if (!notified.has(key)) {
            notified.add(key);
            const m = describeTaskDeadline(task);
            notify(m.title, m.body, tag(task.id));
          }
        }
      }
    };
    scan();
    const id = window.setInterval(scan, REMINDER_SCAN_MS);
    return () => window.clearInterval(id);
  }, [events, tasks]);

  // Ask for notification permission on the first real interaction — browsers
  // require a user gesture, and prompting on load is bad practice anyway.
  useEffect(() => {
    try {
      if (localStorage.getItem('calendar-app/notify') !== 'on') return;
      if (notificationPermission() === 'default') {
        const once = () => {
          void requestNotifyPermission().then(() => setNotifyPermission(notificationPermission()));
          window.removeEventListener('pointerdown', once);
          window.removeEventListener('keydown', once);
        };
        window.addEventListener('pointerdown', once, { once: true });
        window.addEventListener('keydown', once, { once: true });
        return () => {
          window.removeEventListener('pointerdown', once);
          window.removeEventListener('keydown', once);
        };
      }
    } catch {/* ignore */}
  }, []);

  // OLED is on when explicitly enabled, or automatically during the
  // configured night window (which may wrap past midnight, e.g. 22:00–07:00).
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const oledActive = useMemo(() => {
    if (oledMode) return true;
    if (!autoOledMode) return false;
    const [sh, sm] = oledModeStart.split(':').map(Number);
    const [eh, em] = oledModeEnd.split(':').map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    return start <= end
      ? nowMinutes >= start && nowMinutes < end
      : nowMinutes >= start || nowMinutes < end;
  }, [oledMode, autoOledMode, oledModeStart, oledModeEnd, nowMinutes]);

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

  // View and anchor are restored during the first render (see getInitialView /
  // getInitialAnchor) — restoring them here instead would flash the wrong view
  // for a frame before switching, which reads as a visible flicker on load.
  // The phone-layout flag is kept in sync by useSyncExternalStore above.

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

  const showToast = (message: string, opts?: { action?: ToastAction; durationMs?: number }) => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, message, action: opts?.action, durationMs: opts?.durationMs }]);
    setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      opts?.durationMs ?? 2400,
    );
  };

  const dismissToast = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  // OAuth return: after the Google consent dance the server bounces the
  // browser back as `/?google=connected` or `/?google=error`. Acknowledge it
  // once (toast + open Settings on success) and strip the parameter so a
  // refresh or shared link doesn't re-trigger it.
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const result = qs.get('google');
    if (result !== 'connected' && result !== 'error') return;
    qs.delete('google');
    const query = qs.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    );
    if (result === 'connected') {
      showToast('Google Calendar connected');
      // Deferred one tick like the Settings status load: setState may not
      // run synchronously in an effect body (react-hooks/set-state-in-effect).
      const timer = window.setTimeout(() => setSettingsOpen(true), 0);
      return () => window.clearTimeout(timer);
    }
    showToast('Google Calendar connection failed — retry from Settings');
  }, []);

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
      localStorage.setItem('calendar-app/pane', activePane);
    } catch {/* ignore */}
  }, [view, anchor, activePane]);

  // External schedule sync — handled by the reusable orchestration hook
  // (see src/integrations/useScheduleSync.ts). It runs once on startup when a
  // real feed is configured, and on manual "Sync". Sync state is separate
  // from calendar events. Kept in sync via an effect (not during render) so
  // the sync callbacks always read the latest committed value.
  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);
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
    // Month view also shows the days around the month (the grid starts on the
    // Monday on/before the 1st), so its range starts at that Monday — the
    // leading cells would otherwise stay empty.
    fetchRange: () => ({
      from: view === 'month' ? startOfWeek(startOfMonth(anchor)) : startOfDay(anchor),
      // 10 years of forward coverage ensures events far in the future
      // (e.g., recurring school schedules) are never missed.
      to: addYears(anchor, 10),
    }),
  });

  // On every navigation (anchor changes), call syncIfNeeded. This extends
  // the synced coverage whenever the visible range grows. The hook itself
  // guards against duplicate syncs (runningRef) and only fetches the union
  // of the new visible range and whatever is already covered.
  useEffect(() => {
    if (sync.configured) void sync.syncIfNeeded();
    // `view` is a dependency too: switching into month view widens the visible
    // range (back to the Monday before the 1st) without moving the anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, view, sync.configured]);

  // Toast after each successful sync, including what the feed itself covered.
  // Magister-style feeds only publish a rolling ~3-week window, so saying so
  // up front prevents "events stop after <date>" confusion.
  const lastToastSyncRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const s = sync.state;
    if (s.status !== 'success' || !s.lastSyncAt || s.lastSyncAt === lastToastSyncRef.current) return;
    lastToastSyncRef.current = s.lastSyncAt;
    if (s.coverageFrom != null && s.coverageTo != null) {
      const day = { day: 'numeric', month: 'short' } as const;
      showToast(
        `Synced ${s.coverageCount ?? ''} events — feed covers ` +
          `${new Date(s.coverageFrom).toLocaleDateString([], day)} – ` +
          `${new Date(s.coverageTo).toLocaleDateString([], day)}`,
      );
    } else {
      showToast('Schedule synced');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.state.status, sync.state.lastSyncAt]);

  // Google push (app → Google) — mirrors local + Magister events into the
  // chosen Google calendar. Debounced after every event change (same shape
  // as the persist effect): the server diffs the payload, so pushes with
  // nothing to do are cheap no-ops. The hook also runs one kickoff push
  // shortly after mount, and skips silently when Google isn't connected.
  const push = useGooglePush({ getEvents: () => eventsRef.current });
  useEffect(() => {
    if (events === initial.events) return;
    push.schedulePush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  // Surface push failures as a toast (deduped so a persistent error only
  // announces once; successes stay quiet — they happen on every change).
  const lastPushErrorRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const p = push.state;
    if (p.status !== 'error' || !p.errorMessage || p.errorMessage === lastPushErrorRef.current) {
      return;
    }
    lastPushErrorRef.current = p.errorMessage;
    showToast(`Google push failed — ${p.errorMessage}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [push.state.status, push.state.errorMessage]);

  const days = useMemo(() => {
    if (view === 'day') return [startOfDay(anchor)];
    if (view === 'month') return monthGrid(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));
  }, [view, anchor]);

  const goPrev = () =>
    setAnchor((a) =>
      view === 'month' ? addMonths(a, -1) : addDays(a, view === 'day' ? -1 : -7),
    );
  const goNext = () =>
    setAnchor((a) => (view === 'month' ? addMonths(a, 1) : addDays(a, view === 'day' ? 1 : 7)));
  const goToday = () =>
    setAnchor(
      view === 'week'
        ? startOfWeek(now)
        : view === 'month'
          ? startOfMonth(now)
          : startOfDay(now),
    );

  /** Horizontal swipe on the grid pages a day, a week or a month. */
  const swipeTimerRef = useRef<number | undefined>(undefined);
  const [swipeDir, setSwipeDir] = useState<'swipe-next' | 'swipe-prev' | null>(null);
  const handleGridSwipe = (direction: -1 | 1) => {
    // Brief slide-in animation so a swipe reads as navigation, not a scroll.
    setSwipeDir(direction === 1 ? 'swipe-next' : 'swipe-prev');
    window.clearTimeout(swipeTimerRef.current);
    swipeTimerRef.current = window.setTimeout(() => setSwipeDir(null), 200);
    setAnchor((a) => {
      if (view === 'month') return addMonths(a, direction);
      // On a phone a swipe means "next/previous day" in both views — the week
      // grid is a sideways scroller there, so a week-sized jump feels wrong.
      const step = isMobile || view === 'day' ? 1 : 7;
      return addDays(a, direction * step);
    });
  };

  // Desktop keyboard navigation. Kept in a separate effect from the quick-add
  // shortcut below so the closure always sees the current `view` (which decides
  // whether an arrow key steps one day or one week) and can be skipped while a
  // dialog is open.
  useEffect(() => {
    const dialogOpen =
      dialogEvent !== null || dialogTask !== null || quickAddOpen || settingsOpen;
    if (dialogOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (isEditingElement(document.activeElement)) return;
      // Let the browser keep modifier combinations (Ctrl+←, Cmd+R, …).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          goPrev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          goNext();
          break;
        case 't':
        case 'T':
          e.preventDefault();
          goToday();
          break;
        case 'd':
        case 'D':
          e.preventDefault();
          setView('day');
          break;
        case 'w':
        case 'W':
          e.preventDefault();
          setView('week');
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          setView('month');
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, dialogEvent, dialogTask, quickAddOpen, settingsOpen]);

  const handleEventChange = (id: string, start: Date, end: Date) => {
    // Smart buffers: when dragging an event, keep it clear of its neighbours.
    const adjusted =
      bufferMinutes > 0
        ? applyBuffer({ start, end }, events, bufferMinutes, id)
        : { start, end };
    if (timesChanged({ start, end }, adjusted)) {
      showToast(`Shifted to keep a ${bufferMinutes} min buffer.`);
    }
    setEvents((prev) =>
      prev.map((e) =>
        e.id === id
          ? { ...e, start: adjusted.start.toISOString(), end: adjusted.end.toISOString() }
          : e,
      ),
    );
  };

  const handleSlotClick = (day: Date, startMin: number) => {
    const start = new Date(day);
    start.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
    const end = new Date(start.getTime() + 60 * 60_000);
    // Pre-adjust the dialog's proposed time so the buffer is respected from
    // the first frame (and the user sees the final time in the dialog).
    const adjusted = applyBuffer({ start, end }, events, bufferMinutes);
    setDialogEvent({
      id: uid('ev'),
      title: '',
      start: adjusted.start.toISOString(),
      end: adjusted.end.toISOString(),
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
    const linkedTaskId = removed?.taskId;
    setEvents((prev) => prev.filter((e) => e.id !== id));
    if (linkedTaskId) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === linkedTaskId ? { ...t, eventId: undefined } : t,
        ),
      );
    }
    setDialogEvent(null);
    // Deletion is reversible for 5 s: the toast hands back the snapshot.
    if (removed) {
      const snapshot = removed;
      showToast(`Deleted “${removed.title || 'Untitled event'}”.`, {
        durationMs: 5000,
        action: {
          label: 'Undo',
          run: () => {
            setEvents((prev) =>
              prev.some((e) => e.id === snapshot.id) ? prev : [...prev, snapshot],
            );
            if (linkedTaskId) {
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === linkedTaskId ? { ...t, eventId: snapshot.id } : t,
                ),
              );
            }
          },
        },
      });
    }
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
    const linkedEvent = removed?.eventId
      ? events.find((e) => e.id === removed.eventId)
      : undefined;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (removed?.eventId) {
      setEvents((prev) => prev.filter((e) => e.id !== removed.eventId));
    }
    setDialogTask(null);
    // Deletion is reversible for 5 s: the toast hands back the snapshots.
    if (removed) {
      const taskSnapshot = removed;
      const eventSnapshot = linkedEvent;
      showToast(`Deleted “${removed.title || 'Untitled task'}”.`, {
        durationMs: 5000,
        action: {
          label: 'Undo',
          run: () => {
            setTasks((prev) =>
              prev.some((t) => t.id === taskSnapshot.id) ? prev : [...prev, taskSnapshot],
            );
            if (eventSnapshot) {
              setEvents((prev) =>
                prev.some((e) => e.id === eventSnapshot.id) ? prev : [...prev, eventSnapshot],
              );
            }
          },
        },
      });
    }
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
    // Smart buffers: nudge the dropped placement clear of neighbours.
    const adjusted = applyBuffer({ start, end: new Date(start.getTime() + duration) }, events, bufferMinutes);
    const event: CalendarEvent = {
      id: uid('ev'),
      title: task.title,
      description: task.description,
      start: adjusted.start.toISOString(),
      end: adjusted.end.toISOString(),
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
  /** Overdue subset of the open tasks — surfaced so nothing quietly slips. */
  const overdueTaskCount = tasks.filter((t) => isOverdue(t)).length;

  return (
    <div
      className={`app with-tasks${isMobile ? ' mobile' : ''}${loading ? ' loading' : ''}${
        oledActive ? ' oled-mode' : ''
      }`}
    >
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
          className={`calendar-pane view-${view}${isMobile && activePane !== 'calendar' ? ' pane-hidden' : ''}${swipeDir ? ` ${swipeDir}` : ''}`}
        >
          <CalendarToolbar
            view={view}
            days={days}
            anchor={anchor}
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
          <NextUp events={events} now={now} />
          {view === 'month' ? (
            <MonthView
              days={days}
              anchor={anchor}
              events={events}
              now={now}
              onDayClick={(day) => {
                // A day cell is a doorway into day view, not a new event.
                setAnchor(startOfDay(day));
                setView('day');
              }}
              onEventClick={handleEventClick}
              onSwipe={handleGridSwipe}
            />
          ) : (
            <CalendarGrid
              days={days}
              events={events}
              now={now}
              onEventChange={handleEventChange}
              onEventClick={handleEventClick}
              onSlotClick={handleSlotClick}
              onTaskDrop={handleTaskDrop}
              onSwipe={handleGridSwipe}
            />
          )}
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
            className={`mobile-nav-btn${activePane === 'tasks' ? ' active' : ''}${
              overdueTaskCount > 0 ? ' has-overdue' : ''
            }`}
            aria-pressed={activePane === 'tasks'}
            onClick={() => setActivePane('tasks')}
          >
            Tasks{openTaskCount > 0 ? ` (${openTaskCount})` : ''}
            {overdueTaskCount > 0 && (
              <span className="mobile-nav-dot" aria-label={`${overdueTaskCount} overdue`} />
            )}
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
          oledMode={oledMode}
          autoOledMode={autoOledMode}
          oledModeStart={oledModeStart}
          oledModeEnd={oledModeEnd}
          notificationsOn={notificationsOn && notifyPermission === 'granted'}
          notifyPermission={notifyPermission}
          onNotificationsToggle={(on) => void handleNotificationsToggle(on)}
          onSave={handleSaveSettings}
          onOledToggle={(on) => {
            setOledMode(on);
            try { localStorage.setItem('calendar-app/oledMode', String(on)); } catch {/* ignore */}
          }}
          onAutoOledToggle={(on) => {
            setAutoOledMode(on);
            try { localStorage.setItem('calendar-app/autoOledMode', String(on)); } catch {/* ignore */}
          }}
          onOledWindowChange={(start, end) => {
            setOledModeStart(start);
            setOledModeEnd(end);
            try {
              localStorage.setItem('calendar-app/oledModeStart', start);
              localStorage.setItem('calendar-app/oledModeEnd', end);
            } catch {/* ignore */}
          }}
          bufferMinutes={bufferMinutes}
          onBufferMinutesChange={(min) => {
            setBufferMinutes(min);
            try { localStorage.setItem('calendar-app/bufferMinutes', String(min)); } catch {/* ignore */}
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {pwaState === 'available' && !installDismissed && (
        <div className="install-banner" role="dialog" aria-label="Install app">
          <span className="install-text">Install Calendar for offline use</span>
          <button className="btn primary" onClick={pwaInstall}>
            Install
          </button>
          <button
            className="icon-btn"
            aria-label="Dismiss install prompt"
            onClick={dismissInstall}
          >
            ✕
          </button>
        </div>
      )}
      {toasts.length > 0 && (
        <div className="toast-stack" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`toast${t.action ? ' toast-actionable' : ''}`}
              role="status"
            >
              <span>{t.message}</span>
              {t.action && (
                <button
                  className="toast-action"
                  onClick={() => {
                    t.action?.run();
                    dismissToast(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
