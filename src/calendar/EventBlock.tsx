import { memo } from 'react';
import { formatTimeFull } from './lib';
import type { CalendarEvent } from './types';

interface Props {
  event: CalendarEvent;
  top: number;
  height: number;
  left: number;
  width: number;
  dragging: boolean;
  onPointerDown: (mode: 'move' | 'resize', e: React.PointerEvent) => void;
  onClick: () => void;
}

function EventBlockImpl({ event, top, height, left, width, dragging, onPointerDown, onClick }: Props) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const compact = height < 36;

  return (
    <div
      className={`event-block color-${event.color}${dragging ? ' dragging' : ''}`}
      style={{ top, height, left: `${left}%`, width: `${width}%` }}
      onPointerDown={(e) => onPointerDown('move', e)}
      onClick={onClick}
    >
      <div className="event-title">{event.title}</div>
      {compact ? (
        <div className="event-time">{formatTimeFull(start)}</div>
      ) : (
        <div className="event-time">
          {formatTimeFull(start)} – {formatTimeFull(end)}
          {event.category && <span className="event-category"> · {event.category}</span>}
        </div>
      )}
      {!compact && height > 60 && event.description && (
        <div className="event-description">{event.description}</div>
      )}
      <div
        className="event-resize-handle"
        onPointerDown={(e) => onPointerDown('resize', e)}
      />
    </div>
  );
}

/**
 * Memoized so that during a drag only the dragged block re-renders.
 * Handler props are recreated every render, so compare only the props
 * that actually affect rendering.
 */
export const EventBlock = memo(
  EventBlockImpl,
  (a, b) =>
    a.event === b.event &&
    a.top === b.top &&
    a.height === b.height &&
    a.left === b.left &&
    a.width === b.width &&
    a.dragging === b.dragging,
);
