import { useCallback, useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import { APP_VERSION } from '../version';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { cachedSession, lockNow } from '../access';
import { refreshGoogleAvailability, resetGoogleAvailabilityCache } from '../integrations';
import { setPushTarget } from '../integrations/googlePush';
import type { GoogleStatusResponse } from '../../server/googleTypes';
import { isWritableRole } from '../../server/googleApi';

interface Props {
  feedUrl: string;
  oledMode: boolean;
  autoOledMode: boolean;
  oledModeStart: string;   // HH:MM
  oledModeEnd: string;     // HH:MM
  /** Whether class/deadline notifications are enabled. */
  notificationsOn: boolean;
  /** Current Notification.permission value ('unsupported' when unavailable). */
  notifyPermission: 'granted' | 'denied' | 'default' | 'unsupported';
  onNotificationsToggle: (on: boolean) => void;
  onSave: (url: string) => void;
  onOledToggle: (on: boolean) => void;
  onAutoOledToggle: (on: boolean) => void;
  onOledWindowChange: (start: string, end: string) => void;
  /** Smart-buffer minutes between events (0 disables). */
  bufferMinutes: number;
  onBufferMinutesChange: (minutes: number) => void;
  onClose: () => void;
}

export function Settings({
  feedUrl,
  oledMode,
  autoOledMode,
  oledModeStart,
  oledModeEnd,
  notificationsOn,
  notifyPermission,
  onNotificationsToggle,
  onSave,
  onOledToggle,
  onAutoOledToggle,
  onOledWindowChange,
  bufferMinutes,
  onBufferMinutesChange,
  onClose,
}: Props) {
  const [value, setValue] = useState(feedUrl);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Whether the server has a password configured. AppGate already asked, so
  // the answer is cached — no request needed just to render this button.
  const [lockEnabled, setLockEnabled] = useState(() => cachedSession()?.required === true);
  const titleId = useId();
  // Focus trap + `Escape` + focus restore. Initial focus stays with the
  // first-input effect below (plus text select for fast URL replacement).
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);

  useEffect(() => {
    const input = panelRef.current?.querySelector<HTMLInputElement>('input');
    input?.focus();
    input?.select();
  }, [panelRef]);

  // ---------- Google Calendar connection ----------
  const [google, setGoogle] = useState<GoogleStatusResponse | null>(null);
  const [googleLoading, setGoogleLoading] = useState(true);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const loadGoogleStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/google/status', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as GoogleStatusResponse;
      setGoogle(data);
      setGoogleError(data.connected ? null : (data.error ?? null));
    } catch (err) {
      setGoogle(null);
      setGoogleError(err instanceof Error ? err.message : 'Could not reach the server');
    } finally {
      setGoogleLoading(false);
    }
  }, []);

  useEffect(() => {
    // Defer to a task callback: state updates must not run synchronously in
    // the effect body (react-hooks/set-state-in-effect). Cleared on unmount.
    const timer = setTimeout(() => void loadGoogleStatus(), 0);
    return () => clearTimeout(timer);
  }, [loadGoogleStatus]);

  const connectGoogle = () => {
    // Full-page navigation: the server 302s to Google's consent screen and
    // the OAuth callback redirects back to "/" with a fresh page load.
    window.location.href = '/api/google/login';
  };

  const disconnectGoogle = async () => {
    setGoogleBusy(true);
    try {
      const res = await fetch('/api/google/logout', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Availability changed — drop the cached probe and re-run it so the
      // next sync stops including Google.
      resetGoogleAvailabilityCache();
      void refreshGoogleAvailability();
      await loadGoogleStatus();
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setGoogleBusy(false);
    }
  };

  const toggleGoogleCalendar = async (id: string, on: boolean) => {
    const current = google?.selectedCalendarIds ?? [];
    const next = on ? [...current, id] : current.filter((x) => x !== id);
    setGoogleBusy(true);
    try {
      const res = await fetch('/api/google/selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarIds: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGoogle((s) => (s ? { ...s, selectedCalendarIds: next } : s));
      setGoogleError(null);
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : 'Could not save the calendar selection');
    } finally {
      setGoogleBusy(false);
    }
  };

  const changePushTarget = async (calendarId: string) => {
    setGoogleBusy(true);
    try {
      await setPushTarget(calendarId);
      setGoogle((s) => (s ? { ...s, pushCalendarId: calendarId } : s));
      setGoogleError(null);
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : 'Could not save the push calendar');
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleSave = () => {
    setSaving(true);
    onSave(value.trim());
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div
        className="dialog"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 id={titleId}>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <p style={{ marginTop: 0, color: 'var(--text-secondary, #666)', fontSize: 13 }}>
          Paste your personal Magister iCalendar feed URL below. Find it in Magister under{' '}
          <strong>Rooster &rarr; iCalendar</strong>.
        </p>

        <label className="field">
          <span>iCalendar feed URL</span>
          <input
            type="url"
            placeholder="webcal://calendar.magister.net/api/icalendar/feeds/…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
          />
        </label>

        <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: -4 }}>
          The URL is stored locally in your browser and on the server
          (for cross-device sync).
        </p>

        {/* ---------- Google Calendar ---------- */}
        <div className="settings-section">
          <div className="settings-section-title">Google Calendar</div>
          <p className="settings-section-desc">
            Connect a Google account to import events from the calendars you
            pick, and to keep your own calendar synced back to Google.
            Authorization runs on the server — your tokens never reach the
            browser.
          </p>
          {googleLoading ? (
            <span className="settings-hint">Checking connection…</span>
          ) : google?.connected ? (
            <>
              <div className="settings-row">
                <span className="settings-row-label">
                  {google.email ?? 'Google account connected'}
                </span>
                <button
                  className="btn"
                  disabled={googleBusy}
                  onClick={() => void disconnectGoogle()}
                >
                  {googleBusy ? 'Working…' : 'Disconnect'}
                </button>
              </div>
              {google.calendars.length === 0 ? (
                <span className="settings-hint">No calendars found for this account.</span>
              ) : (
                google.calendars.map((cal) => (
                  <label className="settings-row" key={cal.id}>
                    <span className="settings-row-label">{cal.summary}</span>
                    <input
                      type="checkbox"
                      checked={google.selectedCalendarIds.includes(cal.id)}
                      disabled={googleBusy}
                      onChange={(e) => void toggleGoogleCalendar(cal.id, e.target.checked)}
                    />
                  </label>
                ))
              )}
              <span className="settings-hint">
                Only the checked calendars are imported.
              </span>
              {(() => {
                const writable = google.calendars.filter((c) => isWritableRole(c.accessRole));
                if (writable.length === 0) return null;
                const current =
                  google.pushCalendarId ??
                  google.calendars.find((c) => c.primary)?.id ??
                  writable[0].id;
                return (
                  <>
                    <label className="field">
                      <span>Push my calendar to</span>
                      <select
                        value={current}
                        disabled={googleBusy}
                        onChange={(e) => void changePushTarget(e.target.value)}
                      >
                        {writable.map((cal) => (
                          <option key={cal.id} value={cal.id}>
                            {cal.summary}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="settings-hint">
                      Your Magister lessons, events you create in the app and
                      your tasks with a due date are kept up to date in this
                      calendar automatically. Tasks appear on their due date
                      (all-day when no time is set) and are marked ✓ once done.
                      Events imported from Google are never pushed back.
                    </span>
                    {google.lastPushAt != null && (
                      <span className="settings-hint">
                        Last pushed {new Date(google.lastPushAt).toLocaleString()}
                      </span>
                    )}
                    {google.lastPushError && (
                      <span className="settings-hint">{google.lastPushError}</span>
                    )}
                  </>
                );
              })()}
              {googleError && <span className="settings-hint">{googleError}</span>}
            </>
          ) : (
            <>
              <button className="btn" disabled={googleBusy} onClick={connectGoogle}>
                Connect Google Calendar
              </button>
              {googleError && <span className="settings-hint">{googleError}</span>}
            </>
          )}
        </div>

        {/* ---------- Smart buffers ---------- */}
        <div className="settings-section">
          <div className="settings-section-title">Smart buffers</div>
          <p className="settings-section-desc">
            Automatically keep breathing room between events. New and moved
            events are shifted so they never sit flush against their
            neighbours.
          </p>
          <label className="field">
            <span>Buffer between events</span>
            <select
              value={bufferMinutes}
              onChange={(e) => onBufferMinutesChange(Number(e.target.value))}
            >
              <option value={0}>Off</option>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={20}>20 minutes</option>
            </select>
          </label>
        </div>

        {/* ---------- Notifications ---------- */}
        <div className="settings-section">
          <div className="settings-section-title">Notifications</div>
          <p className="settings-section-desc">
            Reminders for classes starting soon (10 min), tasks due within the
            hour, and Pomodoro phase changes. Notifications fire while the app
            is open.
          </p>

          <label className="settings-row">
            <span className="settings-row-label">
              {notifyPermission === 'denied'
                ? 'Blocked in browser settings'
                : notifyPermission === 'unsupported'
                  ? 'Not supported on this device'
                  : 'Class & task reminders'}
            </span>
            <label className="switch">
              <input
                type="checkbox"
                checked={notificationsOn && notifyPermission === 'granted'}
                disabled={notifyPermission === 'denied' || notifyPermission === 'unsupported'}
                onChange={(e) => onNotificationsToggle(e.target.checked)}
              />
              <span className="switch-track" />
            </label>
          </label>
          {notifyPermission === 'denied' && (
            <span className="settings-hint">
              Allow notifications for this site in your browser settings, then reload.
            </span>
          )}
        </div>

        {/* ---------- OLED theme ---------- */}
        <div className="settings-section">
          <div className="settings-section-title">OLED theme</div>
          <p className="settings-section-desc">
            Pure-black AMOLED palette with dimmed night colours, pulsing
            current-time indicator (burn-in prevention), and reduced backdrop
            blur. Especially useful on phones and tablets with OLED panels.
          </p>

          <label className="settings-row">
            <span className="settings-row-label">OLED mode</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={oledMode}
                onChange={(e) => onOledToggle(e.target.checked)}
              />
              <span className="switch-track" />
            </label>
          </label>

          <label className="settings-row">
            <span className="settings-row-label">Auto (night hours)</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={autoOledMode}
                onChange={(e) => onAutoOledToggle(e.target.checked)}
                disabled={!oledMode}
              />
              <span className="switch-track" />
            </label>
            {!oledMode && <span className="settings-hint">Enable OLED mode first</span>}
          </label>

          {autoOledMode && (
            <div className="settings-row settings-row-group">
              <span className="settings-row-label">Night window</span>
              <div className="time-picker-pair">
                <input
                  type="time"
                  value={oledModeStart}
                  onChange={(e) => onOledWindowChange(e.target.value, oledModeEnd)}
                  className="time-picker"
                  aria-label="OLED mode start time"
                />
                <span className="time-picker-sep">→</span>
                <input
                  type="time"
                  value={oledModeEnd}
                  onChange={(e) => onOledWindowChange(oledModeStart, e.target.value)}
                  className="time-picker"
                  aria-label="OLED mode end time"
                />
              </div>
              <span className="settings-hint">
                Local device time. Leave end before start for all-day mode.
              </span>
            </div>
          )}
        </div>

        <div className="dialog-footer">
          <div className="spacer" />
          {lockEnabled && (
            <button
              className="btn"
              onClick={() => {
                setLockEnabled(false);
                void lockNow().then(() => window.location.reload());
              }}
            >
              Lock
            </button>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            onClick={handleSave}
            disabled={saving || value.trim() === feedUrl}
          >
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted, #888)', textAlign: 'center', marginTop: 8 }}>
          v{APP_VERSION}
        </p>
      </div>
    </div>
  );
}
