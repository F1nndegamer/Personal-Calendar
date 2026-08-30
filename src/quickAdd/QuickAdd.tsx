import { useEffect, useRef, useState } from 'react';
import { formatTimeFull } from '../calendar/lib';
import { parseQuickAdd } from './parser';
import type { ParsedQuickAdd } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  onAddTask: (parsed: ParsedQuickAdd) => void;
}

/**
 * Minimal, keyboard-driven quick-add dialog.
 *
 * Appears as a small centered command-style overlay (reusing the existing
 * OLED `.dialog-backdrop` / `.dialog` styles) with a single text input.
 * As the user types, the parsed result is shown live as a preview below.
 *
 * Shortcuts:
 *   Enter  → create the item (if a title is present)
 *   Escape → close without creating
 */
export function QuickAdd({ open, onClose, onAddTask }: Props) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      // Move cursor to end so the user can immediately start typing
      const el = inputRef.current;
      if (el) {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    }
  }, [open]);

  // Close on Escape (global listener, like TaskDialog does)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const parsed = parseQuickAdd(input) || null;
  const canSubmit = parsed !== null && parsed.title.length > 0;

  const handleSubmit = () => {
    if (!parsed) return;
    onAddTask(parsed);
    setInput('');
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    // Escape is handled by the global listener above
  };

  if (!open) return null;

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div
        className="dialog quickadd-dialog"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h2>Quick add</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="field">
          <span>What do you need to do?</span>
          <input
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Math homework tomorrow 17:00 45m"
          />
        </div>

        {parsed && (
          <div className="quickadd-preview">
            <div className="quickadd-preview-title">→ {parsed.title}</div>
            {parsed.dueDate && (
              <div className="quickadd-preview-row">
                <span className="quickadd-preview-label">Due:</span>
                {' '}
                {formatDueDate(parsed.dueDate)}
              </div>
            )}
            {parsed.estimatedMinutes !== undefined && (
              <div className="quickadd-preview-row">
                <span className="quickadd-preview-label">Estimate:</span>
                {' '}{parsed.estimatedMinutes} min
              </div>
            )}
          </div>
        )}

        <div className="dialog-footer">
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            Add Task
          </button>
        </div>
      </div>
    </div>
  );
}

/** Format a due-date ISO string for the preview (date + time). */
function formatDueDate(iso: string): string {
  const d = new Date(iso);
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  const dateStr = d.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return hasTime ? `${dateStr} ${formatTimeFull(d)}` : dateStr;
}
