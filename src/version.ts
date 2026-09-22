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
export const APP_VERSION = '0.10.0';

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
