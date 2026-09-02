import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  feedUrl: string;
  onSave: (url: string) => void;
  onClose: () => void;
}

export function Settings({ feedUrl, onSave, onClose }: Props) {
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
      </div>
    </div>
  );
}
