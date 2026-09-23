import { ChevronLeft, ChevronRight, RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import { formatDayLabel, formatDayNumber, formatMonthLabel, formatWeekRange, isSameDay, isSameMonth } from './lib';
import type { CalendarView } from './types';
import type { SyncState } from '../integrations/useScheduleSync';

interface Props {
  view: CalendarView;
  days: Date[];
  /** Any day inside the visible period — the month-view label is built from it. */
  anchor: Date;
  today: Date;
  onViewChange: (v: CalendarView) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  /** Sync control state (null when no real provider configured) */
  syncState?: SyncState;
  syncConfigured?: boolean;
  onSync?: () => void;
  /** Opens the Settings dialog (feed URL configuration) */
  onSettings?: () => void;
  /** Reloads events/tasks/feedUrl from the server (source of truth across devices) */
  onReload?: () => void;
  /** Phone layout hint (from the app's single media query listener) */
  isMobile?: boolean;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function syncTitle(state: SyncState | undefined, lastSyncAt: string | undefined): string {
  if (state?.errorMessage) return state.errorMessage;
  const parts: string[] = [];
  if (state?.status === 'success' && lastSyncAt) {
    const t = new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    parts.push(`Last synced ${t}`);
  }
  // The feed's own coverage — many school feeds only publish a few weeks ahead.
  if (state?.coverageFrom != null && state?.coverageTo != null) {
    parts.push(
      `Feed contains ${state.coverageCount ?? '?'} events (${formatDate(state.coverageFrom)} – ${formatDate(state.coverageTo)}). ` +
        'Dates beyond this are not published by the feed yet.',
    );
  }
  if (parts.length > 0) return parts.join(' — ');
  if (state?.status === 'error') return 'Sync failed — click to retry';
  return 'Sync schedule';
}

export function CalendarToolbar({
  view,
  days,
  anchor,
  today,
  onViewChange,
  onPrev,
  onNext,
  onToday,
  syncState,
  syncConfigured,
  onSync,
  isMobile,
  onSettings,
  onReload,
}: Props) {
  // The month grid always spills into the neighbouring months, so "am I on the
  // current period?" has to be a month comparison rather than a day lookup —
  // otherwise Today would be disabled while an out-of-month cell (i.e. today)
  // is on screen.
  const inRange =
    view === 'month' ? isSameMonth(anchor, today) : days.some((d) => isSameDay(d, today));
  const label =
    view === 'week'
      ? formatWeekRange(days[0])
      : view === 'month'
        ? formatMonthLabel(anchor)
        : `${formatDayLabel(days[0])} ${formatDayNumber(days[0])} ${days[0].toLocaleDateString([], {
            month: 'long',
            year: 'numeric',
          })}`;

  const syncing = syncState?.status === 'syncing';
  const showSync = !!onSync && syncConfigured !== false;

  return (
    <div className={`toolbar${isMobile ? ' toolbar-mobile' : ''}`}>
      <div className="toolbar-row toolbar-row-main">
        <button
          className="toolbar-btn today-btn"
          onClick={onToday}
          disabled={inRange}
          title="Jump to today"
        >
          Today
        </button>
        <div className="nav-group">
          <button className="toolbar-btn icon-only" onClick={onPrev} aria-label="Previous period" title="Previous">
            <ChevronLeft size={16} />
          </button>
          <button className="toolbar-btn icon-only" onClick={onNext} aria-label="Next period" title="Next">
            <ChevronRight size={16} />
          </button>
        </div>
        {/* Desktop shows the range inline; mobile renders it as its own row. */}
        {!isMobile && <span className="range-label">{label}</span>}
        <span className="toolbar-spacer" />
        <div className="view-toggle" role="tablist" aria-label="Calendar view">
          {(['day', 'week', 'month'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={`view-btn${view === v ? ' active' : ''}`}
              onClick={() => onViewChange(v)}
            >
              {v === 'day' ? 'Day' : v === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>
        {showSync && (
          <button
            className={`toolbar-btn sync-btn${syncState?.status === 'error' ? ' error' : ''}`}
            onClick={onSync}
            disabled={syncing}
            title={syncTitle(syncState, syncState?.lastSyncAt)}
            aria-label="Sync schedule"
          >
            <RefreshCw size={14} className={syncing ? 'spin' : ''} />
            {/* Icon-only on phones — "Syncing…" would overflow the row. */}
            {!isMobile && <span>{syncing ? 'Syncing…' : 'Sync'}</span>}
          </button>
        )}
        {onSettings && (
          <button
            className="toolbar-btn icon-only"
            onClick={onSettings}
            title="Settings"
            aria-label="Open settings"
          >
            <SettingsIcon size={16} />
          </button>
        )}
        {onReload && (
          <button
            className="toolbar-btn icon-only"
            onClick={onReload}
            title="Reload from server"
            aria-label="Reload from server"
          >
            <RefreshCw size={16} />
          </button>
        )}
      </div>
      {/* Phones get the range on its own row so it never competes for space. */}
      {isMobile && (
        <div className="toolbar-row toolbar-row-date">
          <span className="range-label">{label}</span>
        </div>
      )}
    </div>
  );
}
