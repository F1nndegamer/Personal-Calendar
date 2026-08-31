import { useEffect, useMemo, useRef, useState } from 'react';
import {
  HOUR_HEIGHT,
  addDays,
  formatDayLabel,
  formatDayNumber,
  isSameDay,
  layoutEvents,
  minutesFromDayStart,
  snapMinutes,
} from './lib';
import type { CalendarEvent } from './types';
import { EventBlock } from './EventBlock';
import { useEventDrag } from './useEventDrag';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const GUTTER_WIDTH = 56;

interface Props {
  days: Date[];
  events: CalendarEvent[];
  now: Date;
  onEventChange: (id: string, start: Date, end: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  onSlotClick: (day: Date, startMin: number) => void;
  /** Called when a task from the task panel is dropped onto a time slot */
  onTaskDrop?: (taskId: string, day: Date, startMin: number) => void;
}

export function CalendarGrid({ days, events, now, onEventChange, onEventClick, onSlotClick, onTaskDrop }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<(HTMLElement | null)[]>([]);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);

  const { drag, draft, beginDrag, movedRef } = useEventDrag({
    dayRectsRef: dayRefs,
    bodyRectRef: bodyRef,
    events,
    onEventChange,
  });

  // scroll to a sensible position on mount (around current time)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = Math.max(0, (now.getHours() - 2) * HOUR_HEIGHT);
    el.scrollTop = target;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const minutesAt = (e: { clientY: number }): number => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return snapMinutes(((e.clientY - rect.top) / rect.height) * 24 * 60);
  };

  const handleSlotPointerDown = (day: Date, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const min = minutesAt(e);
    onSlotClick(day, Math.min(min, 23 * 60 + 30));
  };

  const nowMin = minutesFromDayStart(now);

  // static rows — never change, so keep them out of drag re-renders
  const hourLines = useMemo(
    () =>
      HOURS.map((h) => (
        <div key={h} className="grid-hour-line" style={{ height: HOUR_HEIGHT }} />
      )),
    [],
  );
  const hourLabels = useMemo(
    () =>
      HOURS.map((h) => (
        <div key={h} className="grid-hour-label" style={{ height: HOUR_HEIGHT }}>
          <span>{h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}</span>
        </div>
      )),
    [],
  );

  return (
    <div className="grid-scroll" ref={scrollRef}>
      <div className="grid-inner">
        {/* sticky day header */}
        <div className="grid-header" style={{ paddingLeft: GUTTER_WIDTH }}>
          {days.map((day, i) => {
            const isToday = isSameDay(day, now);
            return (
              <div key={i} className={`grid-header-cell${isToday ? ' today' : ''}`}>
                <span className="header-day">{formatDayLabel(day)}</span>
                <span className={`header-number${isToday ? ' accent' : ''}`}>
                  {formatDayNumber(day)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="grid-body">
          {/* sticky time column */}
          <div className="grid-times" style={{ width: GUTTER_WIDTH }}>
            {hourLabels}
          </div>

          <div className="grid-days" ref={bodyRef} style={{ height: 24 * HOUR_HEIGHT }}>
            {days.map((day, dayIdx) => {
              const isToday = isSameDay(day, now);
              const dayEvents = events.filter((ev) => isSameDay(new Date(ev.start), day));
              const positioned = layoutEvents(dayEvents);

              // while dragging over another day, highlight the pending drop target
              let isDropTarget = false;
              if (drag?.mode === 'move' && draft && draft.dayOffset !== 0) {
                const dragged = events.find((ev) => ev.id === drag.id);
                if (dragged) {
                  const target = addDays(new Date(dragged.start), draft.dayOffset);
                  isDropTarget = isSameDay(day, target);
                }
              }

              return (
                <div
                  key={dayIdx}
                  ref={(el) => {
                    dayRefs.current[dayIdx] = el;
                  }}
                  data-time={day.getTime()}
                  className={`grid-day${isToday ? ' today' : ''}${isDropTarget ? ' drop-target' : ''}${
                    dragOverDay === dayIdx ? ' drag-over' : ''
                  }`}
                  onPointerDown={(e) => handleSlotPointerDown(day, e)}
                  onDragOver={(e) => {
                    if (!onTaskDrop) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverDay(dayIdx);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverDay(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverDay(null);
                    if (!onTaskDrop) return;
                    const taskId = e.dataTransfer.getData('text/task-id');
                    if (!taskId) return;
                    onTaskDrop(taskId, day, minutesAt(e));
                  }}
                >
                  {hourLines}

                  {isToday && (
                    <div className="now-indicator" style={{ top: (nowMin / 60) * HOUR_HEIGHT }}>
                      <div className="now-dot" />
                    </div>
                  )}

                  {positioned.map(({ event, column, columns }) => {
                    const isDragging = drag?.id === event.id;
                    // block stays in its own column while dragging; times come
                    // from the snapped live draft; day change lands on release
                    const startMin = isDragging && draft ? draft.startMin : minutesFromDayStart(new Date(event.start));
                    const endMin = isDragging && draft ? draft.endMin : minutesFromDayStart(new Date(event.end));
                    const top = (startMin / 60) * HOUR_HEIGHT;
                    const height = Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT - 2, 18);
                    const widthPct = 100 / columns;
                    return (
                      <EventBlock
                        key={event.id}
                        event={event}
                        top={top}
                        height={height}
                        left={column * widthPct}
                        width={widthPct}
                        dragging={isDragging}
                        isLocked={event.source === 'external'}
                        onPointerDown={(mode, e) => beginDrag(event, mode, e)}
                        onClick={() => {
                          if (!movedRef.current) onEventClick(event);
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
