import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useDialogA11y } from '../hooks/useDialogA11y';
import type { CalendarEvent } from '../calendar/types';
import type { Task } from '../tasks/types';
import { collectCommands } from './collect';
import { GROUP_LABELS, searchCommands } from './search';
import type { CommandItem } from './search';

interface Props {
  onClose: () => void;
  /** Action entries — the only items carrying a `run` callback. */
  actions: readonly CommandItem[];
  events: readonly CalendarEvent[];
  tasks: readonly Task[];
  now: Date;
}

/**
 * Spotlight-style command palette, opened with `Ctrl` / `Cmd` + `K`.
 *
 * Searches actions, events and tasks in one place and lets the keyboard jump
 * straight to any of them. Uses the combobox + listbox pattern: focus stays in
 * the input for the whole session and `aria-activedescendant` points at the
 * highlighted row, so there is no focus juggling to get wrong.
 *
 * Mount this component only while it is open — its state (query, selection)
 * then starts fresh every time, so nothing has to be reset in an effect.
 */
export function CommandPalette({ onClose, actions, events, tasks, now }: Props) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);

  const sections = searchCommands(collectCommands(actions, events, tasks, now), query);
  const flat = sections.flatMap((section) => section.items);
  // Clamped so a selection left over from a longer result list still points at
  // a row that exists after the list shrinks.
  const activeFlatIndex = flat.length > 0 ? Math.min(activeIndex, flat.length - 1) : -1;
  const active = activeFlatIndex >= 0 ? flat[activeFlatIndex] : null;
  const activeId = active?.id ?? null;

  const choose = (item: CommandItem | null) => {
    if (!item) return;
    if (item.run) item.run();
    onClose();
  };

  // Keep the highlighted row in view as the keyboard moves through the list.
  useEffect(() => {
    if (activeId === null) return;
    optionRefs.current.get(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const onInput = e.target === inputRef.current;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (flat.length > 0) setActiveIndex((i) => (i + 1) % flat.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (flat.length > 0) setActiveIndex((i) => (i - 1 + flat.length) % flat.length);
        break;
      case 'Home':
        if (onInput && flat.length > 0) {
          e.preventDefault();
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (onInput && flat.length > 0) {
          e.preventDefault();
          setActiveIndex(flat.length - 1);
        }
        break;
      case 'Enter':
        // Only from the search field: `Enter` on the close button must still
        // activate that button.
        if (onInput) {
          e.preventDefault();
          choose(active);
        }
        break;
      default:
        break;
    }
  };

  /** Pointer-down (not click) so the input never loses focus first. */
  const handleItemPointerDown = (e: ReactPointerEvent<HTMLDivElement>, item: CommandItem) => {
    e.preventDefault();
    choose(item);
  };

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div
        className="dialog command-palette"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="command-palette-input">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            autoFocus
            type="text"
            role="combobox"
            aria-expanded
            aria-controls="command-palette-list"
            aria-autocomplete="list"
            aria-activedescendant={active ? `command-palette-option-${activeFlatIndex}` : undefined}
            aria-label="Search events, tasks and commands"
            placeholder="Search events, tasks, commands…"
            value={query}
            onChange={(e) => {
              // Typing restarts the selection at the top of the new results.
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
          />
          <kbd className="command-palette-esc">Esc</kbd>
        </div>

        <div
          className="command-palette-list"
          id="command-palette-list"
          role="listbox"
          aria-label="Results"
        >
          {flat.length === 0 ? (
            <p className="command-palette-empty">No matches for “{query.trim()}”.</p>
          ) : (
            sections.map((section) => (
              <div
                key={section.group}
                className="command-palette-group"
                role="group"
                aria-label={GROUP_LABELS[section.group]}
              >
                <div className="command-palette-group-label" aria-hidden="true">
                  {GROUP_LABELS[section.group]}
                </div>
                {section.items.map((item) => {
                  const index = flat.indexOf(item);
                  const selected = item.id === activeId;
                  return (
                    <div
                      key={item.id}
                      id={`command-palette-option-${index}`}
                      role="option"
                      aria-selected={selected}
                      className={`command-palette-item${selected ? ' active' : ''}`}
                      ref={(el) => {
                        if (el) optionRefs.current.set(item.id, el);
                        else optionRefs.current.delete(item.id);
                      }}
                      onPointerMove={() => setActiveIndex(index)}
                      onPointerDown={(e) => handleItemPointerDown(e, item)}
                    >
                      <div className="command-palette-item-text">
                        <span className="command-palette-item-title">{item.title}</span>
                        {item.detail && (
                          <span className="command-palette-item-detail">{item.detail}</span>
                        )}
                      </div>
                      {item.hint &&
                        (item.group === 'action' ? (
                          <kbd className="command-palette-item-key">{item.hint}</kbd>
                        ) : (
                          <span className="command-palette-item-hint">{item.hint}</span>
                        ))}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="command-palette-footer" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
