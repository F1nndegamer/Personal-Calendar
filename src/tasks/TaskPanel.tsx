import { useMemo, useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import { formatDue, isOverdue, matchesQuery, sortTasks } from './lib';
import type { Task } from './types';

interface Props {
  tasks: Task[];
  onToggle: (id: string) => void;
  onTaskClick: (task: Task) => void;
  onNewTask: () => void;
  onTaskDragStart: (task: Task, e: React.DragEvent) => void;
  onTaskDragEnd: () => void;
}

export function TaskPanel({ tasks, onToggle, onTaskClick, onNewTask, onTaskDragStart, onTaskDragEnd }: Props) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [query, setQuery] = useState('');

  const { overdue, open, done } = useMemo(() => {
    const sorted = sortTasks(tasks);
    // Overdue tasks are split into their own group so they can't get buried
    // further down the list.
    return {
      overdue: sorted.filter((t) => isOverdue(t)),
      open: sorted.filter((t) => !t.completed && !isOverdue(t)),
      done: sorted.filter((t) => t.completed),
    };
  }, [tasks]);

  const searching = query.trim().length > 0;
  const filter = (list: Task[]) =>
    searching ? list.filter((t) => matchesQuery(t, query)) : list;

  const visibleOverdue = filter(overdue);
  const visibleOpen = filter(open);
  const visibleDone = filter(done);
  const totalOpen = overdue.length + open.length;
  const noMatches =
    searching &&
    visibleOverdue.length === 0 &&
    visibleOpen.length === 0 &&
    visibleDone.length === 0;

  const renderTask = (task: Task) => {
    const doneSubs = task.subtasks.filter((s) => s.completed).length;
    const overdueTask = isOverdue(task);
    return (
      <div
        key={task.id}
        className={`task-card${task.completed ? ' completed' : ''}${task.eventId ? ' scheduled' : ''}${overdueTask ? ' overdue' : ''}`}
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
              <span className={`task-due${overdueTask ? ' overdue' : ''}`}>
                {formatDue(task.dueDate)}{overdueTask && <span className="task-overdue-badge">OVERDUE</span>}
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
        <span className="task-count">
          {totalOpen} open
          {overdue.length > 0 && (
            <span className="task-count-overdue"> · {overdue.length} overdue</span>
          )}
        </span>
        <button className="btn primary task-new-btn" onClick={onNewTask}>
          <Plus size={14} /> New
        </button>
      </div>

      {tasks.length > 0 && (
        <div className="task-search">
          <Search size={14} className="task-search-icon" aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="Filter tasks…"
            aria-label="Filter tasks"
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching && (
            <button className="task-search-clear" aria-label="Clear filter" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>
      )}

      <div className="task-list">
        {visibleOverdue.length > 0 && (
          <div className="task-group">
            <div className="task-group-label overdue">Overdue ({visibleOverdue.length})</div>
            {visibleOverdue.map(renderTask)}
          </div>
        )}
        {visibleOpen.map(renderTask)}
        {visibleDone.length > 0 && (
          <>
            <button className="btn subtle toggle-completed" onClick={() => setShowCompleted((v) => !v)}>
              {showCompleted ? 'Hide' : 'Show'} completed ({visibleDone.length})
            </button>
            {showCompleted && visibleDone.map(renderTask)}
          </>
        )}
        {noMatches && <div className="task-empty">No tasks match “{query}”.</div>}
        {!searching && totalOpen === 0 && done.length === 0 && (
          <div className="task-empty">No tasks yet. Create one to get started.</div>
        )}
      </div>
      <div className="task-panel-footer">Drag a task onto the calendar to schedule it</div>
    </aside>
  );
}
