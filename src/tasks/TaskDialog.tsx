import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { EventColor } from '../calendar/types';
import type { Priority, Subtask, Task } from './types';

const COLORS: EventColor[] = ['blue', 'green', 'amber', 'red', 'purple', 'cyan'];
const PRIORITIES: Priority[] = ['low', 'medium', 'high'];

const uid = () => `st-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function toInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  task: Task;
  isNew: boolean;
  onSave: (task: Task) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}

export function TaskDialog({ task, isNew, onSave, onDelete, onClose }: Props) {
  const [draft, setDraft] = useState(task);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (patch: Partial<Task>) => setDraft((d) => ({ ...d, ...patch }));

  const setSubtasks = (fn: (subs: Subtask[]) => Subtask[]) =>
    setDraft((d) => ({ ...d, subtasks: fn(d.subtasks) }));

  const save = () => {
    onSave({
      ...draft,
      title: draft.title.trim() || 'Untitled task',
      estimatedMinutes: draft.estimatedMinutes || undefined,
    });
  };

  const due = draft.dueDate ? new Date(draft.dueDate) : null;

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="dialog" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>{isNew ? 'New task' : 'Task details'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>

        <label className="field">
          <span>Title</span>
          <input
            autoFocus
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Task title"
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Priority</span>
            <select
              value={draft.priority}
              onChange={(e) => set({ priority: e.target.value as Priority })}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Category</span>
            <input
              value={draft.category ?? ''}
              onChange={(e) => set({ category: e.target.value })}
              placeholder="e.g. School, Work"
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Due date</span>
            <input
              type="datetime-local"
              value={due ? toInputValue(due) : ''}
              onChange={(e) =>
                set({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : undefined })
              }
            />
          </label>
          <label className="field">
            <span>Estimate (min)</span>
            <input
              type="number"
              min={5}
              step={5}
              value={draft.estimatedMinutes ?? ''}
              onChange={(e) =>
                set({ estimatedMinutes: e.target.value ? Number(e.target.value) : undefined })
              }
              placeholder="—"
            />
          </label>
        </div>

        <label className="field">
          <span>Description</span>
          <textarea
            rows={3}
            value={draft.description ?? ''}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Notes…"
          />
        </label>

        <div className="field">
          <span>Subtasks</span>
          <div className="subtask-list">
            {draft.subtasks.map((st) => (
              <div key={st.id} className="subtask-row">
                <input
                  type="checkbox"
                  checked={st.completed}
                  onChange={() =>
                    setSubtasks((subs) =>
                      subs.map((s) => (s.id === st.id ? { ...s, completed: !s.completed } : s)),
                    )
                  }
                />
                <input
                  className="subtask-title"
                  value={st.title}
                  onChange={(e) =>
                    setSubtasks((subs) =>
                      subs.map((s) => (s.id === st.id ? { ...s, title: e.target.value } : s)),
                    )
                  }
                />
                <button
                  className="icon-btn"
                  aria-label="Remove subtask"
                  onClick={() => setSubtasks((subs) => subs.filter((s) => s.id !== st.id))}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <button
              className="btn subtle"
              onClick={() => setSubtasks((subs) => [...subs, { id: uid(), title: '', completed: false }])}
            >
              <Plus size={13} /> Add subtask
            </button>
          </div>
        </div>

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
            <button className="btn danger" onClick={() => onDelete(task.id)}>
              Delete
            </button>
          )}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </div>

        <div className="dialog-meta">
          {due
            ? `Due ${due.toLocaleDateString()} ${due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`
            : 'No due date'}
          {draft.eventId && ' · Scheduled on calendar'}
        </div>
      </div>
    </div>
  );
}
