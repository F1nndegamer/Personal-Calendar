import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { APP_VERSION } from '../version';

interface Props {
  feedUrl: string;
  oledMode: boolean;
  autoOledMode: boolean;
  oledModeStart: string;   // HH:MM
  oledModeEnd: string;     // HH:MM
  onSave: (url: string) => void;
  onOledToggle: (on: boolean) => void;
  onAutoOledToggle: (on: boolean) => void;
  onOledWindowChange: (start: string, end: string) => void;
  onClose: () => void;
}

export function Settings({ feedUrl, oledMode, autoOledMode, oledModeStart, oledModeEnd, onSave, onOledToggle, onAutoOledToggle, onOledWindowChange, onClose }: Props) {
  const [value, setValue] = useState(feedUrl);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const input = dialogRef.current?.querySelector<HTMLInputElement>('input');
    input?.focus();
    input?.select();
  }, []);

  const handleSave = () => {
    setSaving(true);
    onSave(value.trim());
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="dialog" ref={dialogRef} onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Settings</h2>
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
