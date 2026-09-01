import { useEffect, useState } from 'react';
import { formatTimeFull, startOfDay } from './lib';
import type { CalendarEvent, EventColor } from './types';

const COLORS: EventColor[] = ['blue', 'green', 'amber', 'red', 'purple', 'cyan'];

interface Props {
  /** Event being edited, or partial event for a new one */
  event: CalendarEvent;
  isNew: boolean;
  readOnly?: boolean;
  onSave: (event: CalendarEvent) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}

function toInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventDialog({ event, isNew, readOnly, onSave, onDelete, onClose }: Props) {
  const [draft, setDraft] = useState(event);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (patch: Partial<CalendarEvent>) => setDraft((d) => ({ ...d, ...patch }));

  const start = new Date(draft.start);
  const end = new Date(draft.end);

  
  const save = () => {
    const s = new Date(draft.start);
    const e = new Date(draft.end);
    if (e <= s) e.setTime(s.getTime() + 30 * 60_000);
    onSave({ ...draft, title: draft.title.trim() || 'Untitled event', start: s.toISOString(), end: e.toISOString() });
  };

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="dialog" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>{isNew ? 'New event' : 'Event details'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <label className="field">
          <span>Title</span>
          <input
            autoFocus
            readOnly={readOnly}
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Event title"
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Date</span>
            <input
              type="date"
              readOnly={readOnly}
              value={toInputValue(startOfDay(start)).slice(0, 10)}
              onChange={(e) => {
                if (readOnly) return;
                const [y, m, d] = e.target.value.split('-').map(Number);
                const next = new Date(start);
                next.setFullYear(y, m - 1, d);
                const nextEnd = new Date(end);
                nextEnd.setFullYear(y, m - 1, d);
                set({ start: next.toISOString(), end: nextEnd.toISOString() });
              }}
            />
          </label>
          <label className="field">
            <span>Start</span>
            <input
              type="time"
              readOnly={readOnly}
              value={toInputValue(start).slice(11)}
              onChange={(e) => {
                if (readOnly) return;
                const [h, min] = e.target.value.split(':').map(Number);
                const next = new Date(start);
                next.setHours(h, min);
                set({ start: next.toISOString() });
              }}
            />
          </label>
          <label className="field">
            <span>End</span>
            <input
              type="time"
              readOnly={readOnly}
              value={toInputValue(end).slice(11)}
              onChange={(e) => {
                if (readOnly) return;
                const [h, min] = e.target.value.split(':').map(Number);
                const next = new Date(end);
                next.setHours(h, min);
                set({ end: next.toISOString() });
              }}
            />
          </label>
        </div>

        <label className="field">
          <span>Category</span>
          <input
            readOnly={readOnly}
            value={draft.category ?? ''}
            onChange={(e) => set({ category: e.target.value })}
            placeholder="e.g. School, Work"
          />
        </label>

        <label className="field">
          <span>Description</span>
          <textarea
            rows={3}
            readOnly={readOnly}
            value={draft.description ?? ''}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Notes…"
          />
        </label>

        <div className="field">
          <span>Color</span>
          <div className="color-picker">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`color-swatch color-${c}${draft.color === c ? ' selected' : ''}`}
                onClick={() => set({ color: c })}
                aria-label={c}
              />
            ))}
          </div>
        </div>

        <div className="dialog-footer">
          {!isNew && onDelete && (
            <button className="btn danger" onClick={() => onDelete(event.id)}>
              Delete
            </button>
          )}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </div>

        <div className="dialog-meta">
          {formatTimeFull(start)} – {formatTimeFull(end)}
        </div>
      </div>
    </div>
  );
}
