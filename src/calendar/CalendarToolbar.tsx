import { ChevronLeft, ChevronRight, RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import { formatDayLabel, formatDayNumber, formatWeekRange, isSameDay } from './lib';
import type { CalendarView } from './types';
import type { SyncState } from '../integrations/useScheduleSync';

interface Props {
  view: CalendarView;
  days: Date[];
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

function syncTitle(state: SyncState | undefined, lastSyncAt: string | undefined): string {
  if (state?.errorMessage) return state.errorMessage;
  if (state?.status === 'success' && lastSyncAt) {
    const t = new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `Last synced ${t}`;
  }
  if (state?.status === 'error') return 'Sync failed — click to retry';
  return 'Sync schedule';
}

export function CalendarToolbar({
  view,
  days,
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
  const inRange = days.some((d) => isSameDay(d, today));
  const label =
    view === 'week'
      ? formatWeekRange(days[0])
      : `${formatDayLabel(days[0])} ${formatDayNumber(days[0])} ${days[0].toLocaleDateString([], {
          month: 'long',
          year: 'numeric',
        })}`;

  const syncing = syncState?.status === 'syncing';
  const showSync = !!onSync && syncConfigured !== false;

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <h1 className="app-title">Calendar</h1>
        <button className="btn today-btn" onClick={onToday} disabled={inRange}>
          Today
        </button>
        <div className="nav-group">
          <button className="icon-btn" onClick={onPrev} aria-label="Previous">
            <ChevronLeft size={16} />
          </button>
          <button className="icon-btn" onClick={onNext} aria-label="Next">
            <ChevronRight size={16} />
          </button>
        </div>
        <span className="range-label">{label}</span>
      </div>
      <div className="toolbar-right">
        <span className="toolbar-date" aria-hidden={!isMobile}>
          {label}
        </span>
        <button
          className="icon-btn"
          onClick={onSettings}
          title="Settings"
          aria-label="Open settings"
        >
          <SettingsIcon size={16} />
        </button>
        {showSync && (
          <button
            className={`sync-btn${syncState?.status === 'error' ? ' error' : ''}`}
            onClick={onSync}
            disabled={syncing}
            title={syncTitle(syncState, syncState?.lastSyncAt)}
            aria-label="Sync schedule"
          >
            <RefreshCw size={14} className={syncing ? 'spin' : ''} />
            <span>{syncing ? 'Syncing…' : 'Sync'}</span>
          </button>
        )}
        {onReload && (
          <button
            className="icon-btn reload-btn"
            onClick={onReload}
            title="Reload from server"
            aria-label="Reload from server"
          >
            <RefreshCw size={14} />
            <span>Reload</span>
          </button>
        )}
        <div className="view-toggle" role="tablist">
          {(['day', 'week'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={`view-btn${view === v ? ' active' : ''}`}
              onClick={() => onViewChange(v)}
            >
              {v === 'day' ? 'Day' : 'Week'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
