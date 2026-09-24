# UI Design Notes — polish opportunities

A running list of UI/UX improvements observed from inspecting `src/App.tsx`,
`src/index.css`, and all component files. Each item is a potential future task.

---

## 1. Focus management & keyboard accessibility

| Component | Issue | Suggestion |
|-----------|-------|------------|
| CalendarGrid / MonthView | Event blocks and time slots are not focusable | Add `tabIndex={0}` to slots and blocks; implement roving tabindex navigation |
| All dialogs | No visible focus ring | Add CSS: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` |
| CalendarToolbar | `Today` button is disabled when in range, but no tooltip explains why | Add `title="Already on today"` when disabled |

---

## 2. CSS spacing / layout polish

| Element | Issue | Suggestion |
|---------|-------|------------|
| `.mobile-panes > .tasks-pane` | Fixed 300px width can overflow on very narrow screens | Consider `minmax(250px, 35vw)` for responsive width |
| Task cards in `TaskPanel.tsx` | No explicit `gap` on `.task-card` elements; margin relies on flex padding | Add CSS gap or consistent bottom margin |
| QuickAdd preview (`quickadd-preview-row`) | Label width inconsistent; "Due:" vs "Estimate:" widths differ | Use CSS grid with `text-align: end` on labels |
| Mobile nav bar | The "Tasks(N)" tab can wrap if count is large | Use `flex-shrink: 0` on badge + ellipsis truncation |

---

## 3. Colour & theme gaps

| Component | Issue | Suggestion |
|-----------|-------|------------|
| EventDialog / TaskDialog | Hard-coded 6 colour swatches (blue, green, amber, red, purple, cyan) | Allow any HEX via colour input; show recently used colours |
| OLED mode | Limited to two presets (manual + auto window) | Consider an accent-colour picker (CSS custom property) |
| `.task-overdue-badge` | Uses default red; could use theme's `--ev-red` | Align with the same CSS variable pattern |

---

## 4. Feedback & affordances

| Component | Issue | Suggestion |
|-----------|-------|------------|
| Toast timing | Fixed 2.4 s auto-dismiss in `App.tsx:390` | Add "Dismissible" button; support keyboard `Esc` to dismiss |
| Delete actions | Immediate with no undo | Show toast with "Undo" button within 5 s window |
| Swipe navigation | Visual feedback only via tiny animation | Add transient background shift or progress indicator |
| Loading state | Spinner centered; no visible reason for load | Add brief text: "Loading your calendar…" under spinner |

---

## 5. Mobile-specific pain points

| Feature | Issue | Suggestion |
|---------|-------|------------|
| PWA install banner | Dismiss persists for session only; no "Never" option | Add permanent dismiss or reset option in Settings |
| Fab button | Positioned at bottom-right; may clash with task footer on very short pages | Use `calc()` so it clears the footer |
| Month chips | Truncate long titles, but "+N more" text can be unclear | Add tooltip on chip showing full title(s) |

---

## 6. Interaction polish

| Action | Issue | Suggestion |
|--------|-------|------------|
| Dragging event from task card | No visual cue that the card is draggable | Add `cursor: grab` on drag start, `cursor: grabbing` while dragging |
| Time inputs in dialogs | Native timepickers vary by browser | Consider a lightweight custom time scroller |
| Date input | Native browser picker on mobile; may not match theme | Style `input[type="date"]` or use a themed calendar pop-up |

---

## 7. ARIA & screen-reader accessibility

| Element | Issue | Suggestion |
|---------|-------|------------|
| Mobile nav buttons | Have `aria-pressed` ✓; but "Calendar" vs "Tasks" tabs | Keep as role="tablist" + role="tab" ✓ |
| Event chips in MonthView | `type="button"` ✓; but missing `aria-label` for truncated titles | Add `aria-label={ev.title}` for each chip |
| Delete button in dialogs | No confirmation | Add `aria-describedby` to confirm destructive action |

---

## 8. Open questions / future research

- Should we add a "Command palette" (`Ctrl+K`) as noted in GameIdea §2.2?
- Can we use CSS `@property` for smooth colour transitions in dialogs?
- Is the 2400 ms toast timing tested with screen readers?