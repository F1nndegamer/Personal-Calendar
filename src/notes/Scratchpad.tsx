import { useState } from 'react';

/**
 * Quick notes & scratchpad (GameIdea.md) — a free-form text area in the
 * task panel for things that don't deserve a whole task or event.
 *
 * Persistence is deliberately localStorage-only: the scratchpad is personal
 * jotting space, and keeping it out of the server snapshot means the
 * sync/storage contract is untouched.
 */

const STORAGE_KEY = 'calendar-app/scratchpad';

function loadNote(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function Scratchpad() {
  const [text, setText] = useState(loadNote);
  const [saved, setSaved] = useState(true);

  /** Update the text and persist it immediately (localStorage is synchronous). */
  const update = (next: string) => {
    setText(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
      setSaved(true);
    } catch {
      setSaved(false);
    }
  };

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="scratchpad">
      <div className="scratchpad-header">
        <span className="scratchpad-title">Scratchpad</span>
        <span className="scratchpad-meta">
          {saved ? `${words} word${words === 1 ? '' : 's'}` : 'Not saved'}
        </span>
        {text && (
          <button
            className="btn subtle scratchpad-clear"
            onClick={() => update('')}
            aria-label="Clear scratchpad"
          >
            Clear
          </button>
        )}
      </div>
      <textarea
        className="scratchpad-input"
        value={text}
        placeholder="Jot down anything — locker code, homework page, ideas…"
        onChange={(e) => update(e.target.value)}
        aria-label="Scratchpad notes"
      />
    </div>
  );
}
