# GameIdea — every idea, and where it stands

The original wishlist, reorganized into the two things that matter when reading
this file: **what is implemented** (§1) and **what is not implemented yet**,
including what gets added later (§2).

Every item of the original list appears in exactly one of the two sections,
quoted, so nothing gets lost. Features that were never on the list are called
out separately inside each section.

Legend: **✅** implemented · **🟡** partly implemented (the open half is repeated
in §2) · **⬜** not implemented yet. Last reviewed: 2026-09-23.

---

## 1. ✅ Implemented features

### 1.1 From the original wishlist

**"Personal calendar website"** — ✅ Vite + React 19 + TypeScript SPA. Self-hosted
at `calendar.f1nn.me` (Raspberry Pi + Nginx + Cloudflare Tunnel) and updated
automatically from `main` by a systemd timer (see `DEPLOY.md`).

**"Mix of to-do list and calendar"** — ✅ One page, two panes: calendar
(`CalendarGrid` / `MonthView`, events) and tasks (`TaskPanel`, to-dos with
priority, category, colour, due date, estimate and subtasks). On a phone the
same two panes become Calendar / Tasks tabs with counts.

**"Easy item addition (simple button)"** — ✅ `New` in the task panel, `+` in the
toolbar, a floating quick-add button on mobile, click/tap an empty time slot to
create an event, click a task/event to edit it.

**"Integration with Magister API for school schedule sync"** — ✅ via the Magister
**iCalendar feed** (not the OAuth JSON API): the feed URL is entered in Settings
and fetched through the self-hosted `/ics` proxy (host allowlist, secret never
committed or logged), parsed with `ical.js` (UTC / floating / TZID / all-day /
escaped / folded lines, room + teacher folded into the description) and merged
into events. Sync shows status, last sync and the feed's own coverage range;
one automatic sync on startup; manual `Sync` and `Reload from server`.

**"Weekly and standard views with time slots"** — ✅ Day, week **and** month views
(month added in v0.19.0): a 15-minute slot time axis with drag/resize timed
events, plus a fixed 6-week month grid with event chips.

**"Personalized for daily planning"** — ✅ Personal feed, day view, a live
"Next up" strip (now / next with a countdown), overdue grouping, configurable
buffers, task → calendar scheduling and a per-device layout. No heuristic or
ML-based planner.

**"Smart buffer times between classes and tasks"** — ✅ `src/calendar/buffer.ts`,
configurable in Settings (Off / 5 / 10 / 15 / 20 min); applied to new events,
dragged and resized events, and dropped tasks, with a toast when a placement had
to shift.

**"Side-by-side view with to-do list and calendar on one page for easy
drag-and-drop"** — ✅ Two panes side by side on desktop, and drag-and-drop is
wired: dropping a task card on a time slot creates a linked event (the task gets
`eventId`, the event gets `taskId`, the card shows a `⇥ cal` badge).

**"Quick-add keyboard shortcut (desktop only)"** — ✅ `N` opens the quick-add
dialog from anywhere; ignored while typing in an input/textarea/select and while
a dialog is open.

**"Daily focus view"** — 🟡 A single-day view exists (full-width day column with
the time axis, plus the Next-up strip and the Pomodoro timer beside the task
list). 🟡 A distraction-free "focus mode" that hides the other chrome is still
open — see §2.1.

**"Color-coded tags for subjects and task types"** — 🟡 Six colours
(`blue`, `green`, `amber`, `red`, `purple`, `cyan`) selectable per event and per
task, plus a `category` label shown as a chip / task badge, and priority dots.
🟡 It is not a real tag system: one category string per item, no tag
autocomplete, no tag filter — see §2.1.

**"Assignment countdown badges"** — ✅ `formatCountdown` badges (`45m`, `3h`,
`2d`) on open tasks due within a week, an `OVERDUE` badge plus count in the panel
header, and a separate "Overdue" group that can't be buried in the list.

**"Dark OLED theme (top priority)"** — ✅ Pure-black OLED mode in Settings with an
automatic night window (start/end, all-day mode when end < start), OLED-safe
dimmed event/chip palettes, a pulsing now-indicator (burn-in prevention) and
reduced backdrop blur.

**"Dual storage: local offline storage with online self-hosted sync (e.g.
Raspberry Pi database)"** — ✅ IndexedDB snapshot for offline-first use
(`src/storage/storage.ts`, validated and normalised on load) plus a self-hosted
server snapshot (`GET` / `PUT /api/storage`, atomic tmp + rename write on the
Pi). The server wins on load, "Reload from server" pulls remote changes, and
local writes are debounced before they are pushed. It is a JSON file on the Pi,
not a database engine.

**"Integrated side timer"** — ✅ Pomodoro timer inside the task panel: focus /
short break / long break, configurable phase lengths, completed-session counter,
state persisted in localStorage, phase notifications.

**"Progressive Web App (PWA) for native app installation"** — ✅
`public/manifest.json` + icons, a service worker (precached shell, manifest,
icons), an install banner driven by `beforeinstallprompt`, standalone detection
and iOS meta tags / apple-touch-icon.

**"Push notification system for classes, deadlines, and timers"** — 🟡 Browser
notifications while the app is open: class start 10 min ahead
(`EVENT_LEAD_MINUTES`), task due within the hour (`TASK_LEAD_MINUTES`) and
Pomodoro phase changes, re-scanned every minute and on state changes, with a
Settings toggle and permission handling. 🟡 True push (service worker, app
closed, lock screen) is still open — see §2.1.

**"Webhooks / API endpoint for remote task creation"** — ✅
`POST /api/webhook/task` with `Authorization: Bearer <WEBHOOK_TOKEN>`, validated
body (title, dueDate, priority, category, color, estimatedMinutes), idempotent
when an `id` is supplied, and disabled unless the token env var is set.

**"Full keyboard navigation between views"** — 🟡 Desktop shortcuts: `←` / `→`
previous/next (day, week or month), `T` today, `D` / `W` / `M` day/week/month,
`N` quick add, `Esc` closes dialogs; modifier combinations are left to the
browser and shortcuts are skipped while editing. 🟡 Focusable grid slots/events
(roving tabindex, arrow-key movement, focus trap) are still open — see §2.1.

**"Quick notes & scratchpad side panel"** — ✅ `Scratchpad` in the task panel
(Show / Hide scratchpad): free text, word count, saved-state hint and Clear.
localStorage only, deliberately outside the sync contract.

**"Natural language parsing for quick task creation"** — ✅
`src/quickAdd/parser.ts`: date keywords (`today`, `tomorrow`, `next week`),
24-hour times (`17:00`), durations (`30m`, `1h`, `1h30m`), strict single-token
matching with "the last one wins", and a live preview that creates a task with
the remaining title plus due date and estimate.

**"Subtasks and checklists inside main tasks/events"** — 🟡 Tasks have
`subtasks: [{ id, title, completed }]` with checkbox rows in `TaskDialog`, a
`done/total` counter and a progress bar on the card. 🟡 Events have no checklist
— see §2.1.

**"Recurring event rules and flexible scheduling"** — 🟡 Recurring events coming
from the iCal feed are expanded into individual occurrences inside the synced
range (bounded to 400 iterations; each occurrence is keyed `UID/<start>` so a
series is never collapsed or duplicated by a sync). 🟡 There is no in-app
recurrence editor (`CalendarEvent.recurrence` is reserved but unused) — see §2.1.

### 1.2 Implemented, but never on the original list

- **Month view** (v0.19.0) — fixed 6-week grid, up to 3 chips per day plus
  "+N more", today badge, click a day to open it in day view, paging by swipe /
  arrows / `Today`, and month-range feed sync.
- **Swipe navigation with tap-vs-scroll disambiguation** — a flick pages a day
  (phone week view), a week, or a month; taps resolve on release, so scrolling
  the grid never pops open a stray event dialog.
- **Mobile layout** — Calendar / Tasks tabs with open + overdue counts, floating
  quick-add button, scroll-snap week columns auto-centred on today, compact
  month cells, tightened toolbar.
- **Next-up strip** — live "Now" / "Next" banner with countdown above the grid.
- **Task list tooling** — search/filter over title, category and description,
  overdue group, "show completed" toggle, subtask progress bars, priority dots,
  scheduled-on-calendar badge.
- **Event drag & resize** — 5-minute snapping, long-press-to-drag on touch
  (a flick scrolls instead), cross-day drag, smart buffers applied on release.
- **Self-hosted device feed for the ESP32 wall calendar** (v0.17.0) —
  `GET /api/v1/calendar?days=N` (max 62 days, versioned payload, IANA timezone,
  optional Bearer `DEVICE_TOKEN`); tasks with a due date become deadline markers
  and all-day events are detected heuristically.
- **Schedule-sync robustness** — the synced range only ever grows, 10-year
  forward coverage, external-vs-local provenance on every event, dedup-safe
  re-syncs, last-sync status and a feed-coverage report in the toolbar.
- **Version policy & tooling** — `src/version.ts` as the single source of truth,
  `version:bump` / `version:sync` / `version:check`, enforced by the test suite
  and by `npm run build` (see `VERSION.md`, `AGENTS.md`).
- **Quality gates** — 229 unit/component tests across 16 files (ICS parsing,
  month maths, gestures, buffers, notifications, device feed, proxy, storage,
  webhook, sync), ESLint, TypeScript checks and a production build.
- **Docs** — `README.md`, `VERSION.md`, `AGENTS.md` and `DEPLOY.md` (systemd
  units, Nginx, security notes, auto-update debugging).

---

## 2. ⬜ Not implemented yet — and what gets added later

### 2.1 Still open from the original wishlist

- **"Voice-to-task creation using a free online AI API"** — ⬜ nothing exists:
  no mic button, no speech code, no AI call. *Later:* a mic button in the
  quick-add dialog using the browser `SpeechRecognition` (with `MediaRecorder` +
  a server-side transcription fallback), sending the transcript to a free AI
  endpoint that returns title / date / duration / priority, which then feeds the
  existing `ParsedQuickAdd` shape. The API key must live in the Pi proxy
  (`/api/parse`) rather than in the bundle, and the typed quick-add stays as the
  fallback when speech is unavailable.

- **The "push" half of "Push notification system for classes, deadlines, and
  timers"** — ⬜ today's reminders only fire while a tab is open. *Later:* Web
  Push (VAPID keys on the server + a `push` handler in `public/sw.js`), one
  subscription per device stored next to the snapshot, and a server-side scan
  that reuses the existing `describe*` message builders for the payload. Steps
  in order: `push`/`notificationclick` handlers in the service worker →
  subscribe flow with a Settings toggle → server scheduler for class/deadline
  reminders → optional test push button.

- **The distraction-free half of "Daily focus view"** — ⬜ the day view exists,
  but the panes can't be hidden. *Later:* a `F` shortcut / toolbar button that
  collapses the task panel, Next-up strip and toolbar chrome down to the current
  day plus the Pomodoro timer, remembered per device.

- **In-app recurrence for "Recurring event rules and flexible scheduling"** —
  ⬜ only feed-supplied `RRULE`s are expanded today. *Later:* a rule editor in
  `EventDialog` (weekly, weekdays, every N days/weeks, until-date) that fills the
  reserved `CalendarEvent.recurrence` field and expands occurrences locally. Hard
  constraint: events imported from the feed (`source: 'external'`) stay read-only
  so the editor can never fight the feed's own expansion.

- **In-grid key navigation for "Full keyboard navigation between views"** —
  ⬜ view/date switching works, but slots and event blocks aren't focusable.
  *Later:* roving tabindex over grid slots and event blocks, arrow keys to move
  focus (with `Enter` to open and `Delete` to remove), `Esc` to leave the grid,
  a visible focus ring, and a focus trap while any dialog is open.

- **A real tag system for "Color-coded tags for subjects and task types"** —
  ⬜ each item has one colour plus one free-text `category`. *Later:* multiple
  tags per event/task, autocomplete from already-used tags, tag chips on cards
  and in the dialogs, and clicking a chip to filter the calendar and the task
  list. Needs a storage migration (new `tags: string[]` field, kept additive so
  old snapshots still load).

- **Checklists on events for "Subtasks and checklists inside main tasks/events"** —
  ⬜ only tasks have subtasks. *Later:* reuse the `Subtask` type for
  `CalendarEvent` (e.g. packing list on a school trip), editable in
  `EventDialog` with the progress shown on the event block, plus a matching
  field in the device feed and in `saveSnapshot`.

### 2.2 Planned next, but never on the original list

- **Search / command palette (`Ctrl` / `Cmd` + `K`)** — ⬜ jump to any event,
  task or date from a command-style overlay: fuzzy scoring over title, category
  and description, grouped results (events / tasks / actions), keyboard-only
  navigation, `Enter` to open the item or switch the view. This is the next
  change being built.
- **All-day row above the week grid** — ⬜ all-day items currently render as
  midnight-to-midnight blocks (which is how the feed's `VALUE=DATE` events are
  imported). Adding a dedicated sticky all-day/multi-day banner row keeps them
  visible when the grid is scrolled to daytime hours.
- **Recurring task templates** — ⬜ a task that respawns on a cadence (every
  Tuesday, every 1st of the month) with an optional window, independent of the
  calendar feed.
- **Backup, restore and export** — ⬜ download the snapshot as JSON and export
  the calendar as `.ics`, so the JSON file on the Pi is not the only copy of the
  data.
- **Offline write queue** — ⬜ when the server is unreachable the app currently
  just saves locally; a queued retry (with a "N changes not synced yet" hint)
  would close the gap between the two stores.
- **Per-item `updatedAt` + conflict handling** — ⬜ last-write-wins per snapshot
  today; a per-item timestamp would let two devices merge instead of overwriting.
- **Phone quick capture (Web Share Target + PWA shortcuts)** — ⬜ share a link or
  text to the installed PWA and have it land in quick-add, posted through the
  existing `POST /api/webhook/task`.
- **Overview statistics** — ⬜ hours per subject per week, deadline density and
  buffer-time totals, computed by a small pure module (testable, no chart
  library needed at first).
- **More themes than OLED** — ⬜ light and dim palettes plus an optional accent
  colour; the CSS already centralises colours in custom properties, so this is a
  switch rather than a rewrite.
- **Saved filters** — ⬜ "only School", "hide finished subjects", colour-based
  filters applied to both the grid and the task list, persisted per device.

---

*Statuses here are checked against the code at each release; the version that
introduced a feature is noted where it matters. The original one-line wishlist
this file was rewritten from stays in git history.*
