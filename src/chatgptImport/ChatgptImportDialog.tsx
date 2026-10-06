import { useEffect, useId, useMemo, useState } from 'react';
import { Copy, Loader2, X } from 'lucide-react';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { CHATGPT_PROMPTS, type ChatgptPromptId } from './types';
import { parseChatgptOutput } from './parser';
import type { CalendarEvent } from '../calendar/types';

interface Props {
  day: Date;
  onImport: (events: CalendarEvent[]) => void;
  onClose: () => void;
}

export function ChatgptImportDialog({ day, onImport, onClose }: Props) {
  const [input, setInput] = useState('');
  const [selectedPrompt, setSelectedPrompt] = useState<ChatgptPromptId>('day-schedule');
  const [copyingPrompt, setCopyingPrompt] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  const titleId = useId();
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);
  useEffect(() => {
    const ta = panelRef.current?.querySelector<HTMLTextAreaElement>('textarea');
    ta?.focus();
  }, [panelRef]);

  const formatDay = (d: Date) =>
    d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  const getPromptText = (promptId: ChatgptPromptId) => {
    const prompt = CHATGPT_PROMPTS.find((p) => p.id === promptId);
    if (!prompt) return '';
    return prompt.prompt.replace('{day}', formatDay(day)).replace('{startDate}', formatDay(day));
  };

  const handleCopyPrompt = async (promptId: ChatgptPromptId) => {
    const text = getPromptText(promptId);
    try { await navigator.clipboard.writeText(text); setCopyingPrompt(promptId); setTimeout(() => setCopyingPrompt(null), 1500); } catch {/* clipboard unavailable */}
  };

  // Live preview: parse as the user types so bad pastes fail loudly *before*
  // the import button is hit. Parse errors are swallowed here — the explicit
  // error message only appears on submit.
  const preview = useMemo(() => {
    if (input.trim().length === 0) return null;
    try {
      return parseChatgptOutput(input, { referenceDate: day });
    } catch {
      return null;
    }
    // day is a fresh Date each render from App's anchor state; including it
    // would re-parse on every keystroke's parent render anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  const handleImport = () => {
    setError(null);
    const result = parseChatgptOutput(input, { referenceDate: day });
    if (!result || result.events.length === 0) {
      setError('Could not parse any events. Check the format or try a different prompt.');
      return;
    }
    setImporting(true);
    try {
      onImport(result.events);
      setImportedCount(result.events.length);
      setTimeout(() => { setImporting(false); onClose(); }, 300);
    } catch { setError('Failed to import events.'); setImporting(false); }
  };

  const handleClose = () => { if (!importing) onClose(); };

  return (
    <div className="dialog-backdrop" onPointerDown={handleClose}>
      <div className="dialog" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2 id={titleId}>Import from ChatGPT</h2>
          <button className="icon-btn" onClick={handleClose} aria-label="Close"><X size={15} /></button>
        </div>
        <p className="dialog-desc">
            Copy one of the prompts below, paste it into ChatGPT, then paste the response here to import your schedule.
          </p>
          <div className="prompt-selector">
            <label htmlFor="prompt-select">Choose a prompt style:</label>
            <div className="prompt-cards">
              {CHATGPT_PROMPTS.map((p) => (
                <div key={p.id} className={`prompt-card${selectedPrompt === p.id ? ' active' : ''}`}>
                  <button
                    type="button"
                    className="prompt-select"
                    onClick={() => setSelectedPrompt(p.id)}
                    aria-pressed={selectedPrompt === p.id}
                  >
                    <span className="prompt-info">
                      <span className="prompt-title">{p.label}</span>
                      <span className="prompt-preview">{p.prompt.slice(0, 80)}…</span>
                    </span>
                  </button>
                  <button type="button" className="copy-btn" onClick={() => handleCopyPrompt(p.id)} disabled={copyingPrompt === p.id} aria-label={`Copy ${p.label} prompt`}>
                    {copyingPrompt === p.id ? <span className="copied-badge">Copied!</span> : <Copy size={16} />}
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="dialog-section">
            <label htmlFor="import-input" className="dialog-label">Paste ChatGPT output:</label>
            <textarea id="import-input" className="dialog-textarea" value={input} onChange={(e) => setInput(e.target.value)} placeholder={getPromptText(selectedPrompt)} rows={10} spellCheck={false} />
            {error && <p className="dialog-error" role="alert">{error}</p>}
            {input.trim().length > 0 && (
              <div className="import-preview" aria-live="polite">
                {preview && preview.events.length > 0 ? (
                  <ul className="import-preview-list">
                    {preview.events.slice(0, 8).map((ev) => (
                      <li key={ev.externalId ?? ev.id}>
                        <span className="import-preview-time">{formatTime(ev.start)}–{formatTime(ev.end)}</span>{' '}{ev.title}
                      </li>
                    ))}
                    {preview.events.length > 8 && (
                      <li className="import-preview-more">+{preview.events.length - 8} more…</li>
                    )}
                  </ul>
                ) : (
                  <p className="import-preview-empty">No events detected yet — check the format.</p>
                )}
              </div>
            )}
          </div>
          {importedCount !== null && <div className="import-success" role="status">✓ Imported {importedCount} event{importedCount !== 1 ? 's' : ''}</div>}
        <div className="dialog-footer">
          <div className="spacer" />
          <button className="btn" onClick={handleClose} disabled={importing}>Cancel</button>
          <button className="btn primary" onClick={handleImport} disabled={importing || !preview || preview.events.length === 0}>
            {importing ? (<><Loader2 size={16} className="spin" /> Importing…</>) : 'Import events'}
          </button>
        </div>
      </div>
    </div>
  );
}
