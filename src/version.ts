/**
 * SINGLE SOURCE OF TRUTH for the application version.
 *
 * Everything else derives from here:
 *   - `package.json` -> kept in sync by `npm run version:sync`
 *   - the Settings dialog -> imports `APP_VERSION`
 *
 * Do NOT hard-code a version string anywhere else. To bump, run:
 *
 *   npm run version:bump -- minor "Short description of what changed"
 *
 * which updates `APP_VERSION`, prepends a `VERSION_HISTORY` entry, and
 * syncs `package.json`. See VERSION.md for the full policy.
 */

/** The current published version (semver: MAJOR.MINOR.PATCH). */
export const APP_VERSION = '1.0.0';

/** How large a change set was. Drives which semver field is incremented. */
export type BumpLevel = 'major' | 'minor' | 'patch';

/** One released version. Newest first. */
export interface VersionEntry {
  /** Semver string, must equal the entry's position in history. */
  version: string;
  /** ISO date (YYYY-MM-DD) the version was cut. */
  date: string;
  /** Which semver field this release incremented. */
  level: BumpLevel;
  /** One-line, user-facing summary of the change set. */
  summary: string;
}

/**
 * Full release history, newest first. The first entry MUST match
 * `APP_VERSION` — `src/__tests__/version.test.ts` enforces this.
 */
export const VERSION_HISTORY: readonly VersionEntry[] = [
  {
    version: '1.0.0',
    date: '2026-09-26',
    level: 'major',
    summary: 'Password lock: server-verified session gate in front of every browser route',
  },
  {
    version: '0.25.0',
    date: '2026-09-26',
    level: 'minor',
    summary: 'Mirror tasks with a due date into the Google Calendar push payload',
  },
  {
    version: '0.24.0',
    date: '2026-09-25',
    level: 'minor',
    summary: 'Google push: stop duplicate school events (per-batch mapping flush, tagged copies, stray-copy sweep, mirror filter)',
  },
  {
    version: '0.23.0',
    date: '2026-09-25',
    level: 'minor',
    summary: 'Google Calendar push sync: mirror local + Magister events into a chosen calendar',
  },
  {
    version: '0.22.1',
    date: '2026-09-25',
    level: 'patch',
    summary: 'deploy: ship type:module package.json with dist-server entrypoint',
  },
  {
    version: '0.22.0',
    date: '2026-09-25',
    level: 'minor',
    summary: 'Google OAuth setup: dev /api/google proxy, ?google= redirect handling, DEPLOY/env docs',
  },
  {
    version: '0.21.0',
    date: '2026-09-25',
    level: 'minor',
    summary: 'Add Google Calendar as a second sync provider with multi-provider sync, Settings connect/disconnect UI, and tests',
  },
  {
    version: '0.20.4',
    date: '2026-09-25',
    level: 'patch',
    summary: 'Pomodoro/scratchpad section toggles: card styling, icons, chevrons, gutters',
  },
  {
    version: '0.20.3',
    date: '2026-09-25',
    level: 'patch',
    summary: 'Dialog enter animations, backdrop blur, bottom-sheet motion, touch-target polish',
  },
  {
    version: '0.20.2',
    date: '2026-09-25',
    level: 'patch',
    summary: 'Delete-undo toasts for events and tasks with toast stack',
  },
  {
    version: '0.20.1',
    date: '2026-09-25',
    level: 'patch',
    summary: 'Focus rings, dialog a11y (focus trap, ARIA semantics), keyboard-activatable event blocks',
  },
  {
    version: '0.20.0',
    date: '2026-09-24',
    level: 'minor',
    summary: 'Add polishing & UX UI design notes + expand GameIdea with UI/UX polishing section',
  },
  {
    version: '0.19.1',
    date: '2026-09-23',
    level: 'patch',
    summary: 'Rewrite GameIdea.md into implemented vs not-implemented feature status',
  },
  {
    version: '0.19.0',
    date: '2026-09-23',
    level: 'minor',
    summary: 'Month view: 6-week day grid with event chips, month paging (swipe/arrows/Today), and month-range feed sync',
  },
  {
    version: '0.18.0',
    date: '2026-09-23',
    level: 'minor',
    summary: 'Mobile week view: wider ~122px day columns, mandatory day snap, roomier event blocks',
  },
  {
    version: '0.17.2',
    date: '2026-09-23',
    level: 'patch',
    summary: 'Device feed test: date-relative fixtures so the suite passes after midnight',
  },
  {
    version: '0.17.1',
    date: '2026-09-23',
    level: 'patch',
    summary: 'Fix dead touch swipes: gesture now receives pointerdowns starting on event blocks',
  },
  {
    version: '0.17.0',
    date: '2026-09-22',
    level: 'minor',
    summary: 'GET /api/v1/calendar device feed for ESP32 wall calendar',
  },
  {
    version: '0.16.0',
    date: '2026-09-22',
    level: 'minor',
    summary: 'POST /api/webhook/task endpoint for remote task creation (Bearer token, idempotent, disabled by default)',
  },
  {
    version: '0.15.0',
    date: '2026-09-22',
    level: 'minor',
    summary: 'Next-up strip: live now/next banner with countdown above the grid',
  },
  {
    version: '0.14.0',
    date: '2026-09-22',
    level: 'minor',
    summary: 'Notifications: class reminders, task deadline alerts, Pomodoro phase pings; Settings toggle',
  },
  {
    version: '0.13.0',
    date: '2026-09-22',
    level: 'minor',
    summary: 'Mobile week view: gutter-aware snap, today emphasis, clearer day separation',
  },
  {
    version: '0.12.0',
    date: '2026-09-22',
    level: 'minor',
    summary: 'Fix dead mobile swipes (pointer cancel, event-origin gestures) and wire swipe feedback',
  },
  {
    version: '0.11.0',
    date: '2026-09-22',
    level: 'minor',
    summary: 'Quick notes scratchpad in the task panel (localStorage-backed)',
  },
  {
    version: '0.10.0',
    date: '2026-09-22',
    level: 'minor',
    summary: 'Assignment countdown badges on tasks due within a week',
  },
  {
    version: '0.9.0',
    date: '2026-09-22',
    level: 'minor',
    summary: 'Mobile week view: wider scroll-snap columns, auto-center today',
  },
  {
    version: '0.8.0',
    date: '2026-09-22',
    level: 'minor',
    summary: 'Mobile swipe steps one day in week view; mobile week scroll polish',
  },
  {
    version: '0.7.0',
    date: '2026-09-22',
    level: 'minor',
    summary: 'Pomodoro focus timer in the task panel; overdue task grouping and filter',
  },
  {
    version: '0.6.1',
    date: '2026-09-21',
    level: 'patch',
    summary: 'Document Pi auto-update timer and harden deploy script against skipped deploys',
  },
  {
    version: '0.6.0',
    date: '2026-09-21',
    level: 'minor',
    summary: 'Smart buffer times: keep configurable breathing room between events',
  },
  {
    version: '0.5.0',
    date: '2026-09-21',
    level: 'minor',
    summary: 'OLED night mode with auto schedule, PWA install (manifest, service worker, install banner)',
  },
  {
    version: '0.4.0',
    date: '2026-09-21',
    level: 'minor',
    summary: 'Report feed coverage after sync; fix recurring-event dedup',
  },
  {
    version: '0.3.0',
    date: '2026-09-21',
    level: 'minor',
    summary: 'Mobile tap-vs-scroll fix, swipe navigation, keyboard shortcuts, toolbar redesign, task filters',
  },
  {
    version: '0.2.0',
    date: '2026-09-20',
    level: 'minor',
    summary:
      'Version is now a single source of truth with automated sync/check/bump tooling and agent-enforced versioning rules.',
  },
  {
    version: '0.1.0',
    date: '2026-09-20',
    level: 'minor',
    summary:
      'Extend the schedule sync range to 10 years forward (new addYears helper) and show the app version in Settings.',
  },
];
