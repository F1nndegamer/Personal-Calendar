import { useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { isSameDay } from '../calendar/lib';
import type { Task } from './types';

interface Props {
  tasks: Task[];
  onToggle: (id: string) => void;
  onTaskClick: (task: Task) => void;
  onNewTask: () => void;
  onTaskDragStart: (task: Task, e: React.DragEvent) => void;
  onTaskDragEnd: () => void;
}

function isOverdue(task: Task): boolean {
  if (task.completed || !task.dueDate) return false;
  const due = new Date(task.dueDate);
  const now = new Date();
  return due < now;
}

function formatDue(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (isSameDay(d, today)) return `Today ${time}`;
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (isSameDay(d, tomorrow)) return `Tomorrow ${time}`;
  // If the time is midnight, the user specified only a date (no time)
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  const label = d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return hasTime ? `${label} ${time}` : label;
}

export function TaskPanel({ tasks, onToggle, onTaskClick, onNewTask, onTaskDragStart, onTaskDragEnd }: Props) {
  const [showCompleted, setShowCompleted] = useState(false);

  const { open, done } = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => {
      const prio = { high: 0, medium: 1, low: 2 } as const;
      const pa = a.completed ? 3 : prio[a.priority];
      const pb = b.completed ? 3 : prio[b.priority];
      if (pa !== pb) return pa - pb;
      const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return da - db;
    });
    return {
      open: sorted.filter((t) => !t.completed),
      done: sorted.filter((t) => t.completed),
    };
  }, [tasks]);

    const renderTask = (task: Task) => {
    const doneSubs = task.subtasks.filter((s) => s.completed).length;
    const overdue = isOverdue(task);
    return (
      <div
        key={task.id}
        className={`task-card${task.completed ? ' completed' : ''}${task.eventId ? ' scheduled' : ''}${overdue ? ' overdue' : ''}`}
        draggable
        onDragStart={(e) => onTaskDragStart(task, e)}
        onDragEnd={onTaskDragEnd}
        onClick={() => onTaskClick(task)}
      >
        <button
          className="task-check"
          aria-label={task.completed ? 'Mark uncompleted' : 'Mark completed'}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(task.id);
          }}
        >
          {task.completed && <Check size={12} strokeWidth={3} />}
        </button>
        <div className="task-body">
          <div className="task-title">{task.title}</div>
          <div className="task-meta">
            <span className={`task-priority prio-${task.priority}`} title={`${task.priority} priority`} />
            {task.category && <span className="task-category">{task.category}</span>}
                                    {task.dueDate && (
              <span className={`task-due${overdue ? ' overdue' : ''}`}>
                {formatDue(task.dueDate)}{overdue && <span className="task-overdue-badge">OVERDUE</span>}
              </span>
            )}
            {task.estimatedMinutes && <span className="task-estimate">{task.estimatedMinutes}m</span>}
            {task.subtasks.length > 0 && (
              <span className="task-subcount">{doneSubs}/{task.subtasks.length}</span>
            )}
            {task.eventId && <span className="task-scheduled" title="Scheduled on calendar">⇥ cal</span>}
          </div>
          {task.subtasks.length > 0 && (
            <div className="task-progress">
              <div
                className="task-progress-fill"
                style={{ width: `${(doneSubs / task.subtasks.length) * 100}%` }}
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <aside className="task-panel">
      <div className="task-panel-header">
        <h2>Tasks</h2>
        <span className="task-count">{open.length} open</span>
        <button className="btn primary task-new-btn" onClick={onNewTask}>
          <Plus size={14} /> New
        </button>
      </div>
      <div className="task-list">
        {open.map(renderTask)}
        {done.length > 0 && (
          <>
            <button className="btn subtle toggle-completed" onClick={() => setShowCompleted((v) => !v)}>
              {showCompleted ? 'Hide' : 'Show'} completed ({done.length})
            </button>
            {showCompleted && done.map(renderTask)}
          </>
        )}
        {open.length === 0 && done.length === 0 && (
          <div className="task-empty">No tasks yet. Create one to get started.</div>
        )}
      </div>
      <div className="task-panel-footer">Drag a task onto the calendar to schedule it</div>
    </aside>
  );
}
