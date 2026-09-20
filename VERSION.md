# Version Number

This app uses [semantic versioning](https://semver.org): `MAJOR.MINOR.PATCH`.

## Single source of truth

**`src/version.ts` is the only place a version is defined.**

```ts
export const APP_VERSION = '0.2.0';        // <- the version
export const VERSION_HISTORY = [ … ];      // <- the changelog
```

Everything else is derived:

| Consumer | How it gets the version |
|----------|-------------------------|
| Settings dialog (`src/components/Settings.tsx`) | imports `APP_VERSION` |
| `package.json` → `"version"` | kept in sync by `npm run version:sync` |
| `VERSION.md` changelog (below) | mirrors `VERSION_HISTORY` |

> Never hard-code a version string anywhere else. `src/__tests__/version.test.ts`
fails if `package.json` drifts from `src/version.ts`.

## Bumping

```bash
npm run version:bump -- <patch|minor|major> "Short summary of the change set"
```

One command does everything: updates `APP_VERSION`, prepends a `VERSION_HISTORY`
entry dated today, and syncs `package.json`. Hand-editing is only needed if the
script itself is broken.

| Script | Purpose |
|--------|---------|
| `npm run version:bump -- <level> "<summary>"` | bump + changelog + sync |
| `npm run version:sync` | force `package.json` to match `APP_VERSION` |
| `npm run version:check` | fail if the two disagree (also runs before `build`) |

## Which level? (impact decides, volume breaks ties)

Judge the **entire change set of the task**, not each file, and apply the
*highest* level that matches. Then bump **exactly one step** — never skip a
level, never bump twice in one task.

### 1. MAJOR — anything breaking

Pick this if the change set contains any of:

- a change to persisted data, the storage schema, or the server storage format
  (IndexedDB / `saveToServer` payload / `.env` shape) that invalidates existing data
- a change to an external contract (the `/ics` proxy API, the ICS format we emit)
- removal or rename of a public/exported API
- anything that requires a manual migration or a deploy step

### 2. MINOR — anything new or newly visible

Pick this if nothing above applies, but the change set contains any of:

- a new file, component, hook, module, or exported function
- a user-visible behaviour change: different default date range, different ICS
  parsing rules, changed sync/navigation behaviour, different default view
- a new or removed dependency
- a change to how or where data is displayed

### 3. PATCH — everything else

- bug fixes with no contract or behaviour-default change
- refactors that preserve behaviour
- comments, docs, formatting, typo fixes
- tests only
- dependency upgrades

### Volume as a tie-breaker

Impact is what matters, but when a change set sits right on the borderline, the
amount of work decides:

| Source files touched with a functional change | Tie-break |
|-----------------------------------------------|-----------|
| 0 (docs/comments/tests only) | PATCH |
| 1-2, behaviour unchanged | PATCH |
| 1-2, behaviour changed or new export | MINOR |
| 3 or more | MINOR — unless something is breaking, then MAJOR |

### Worked examples

| Change set | Level |
|------------|-------|
| Fix a typo in the Settings copy | PATCH |
| Fix an off-by-one in the ICS range clamp | PATCH |
| Refactor `parseIcs` internals, same output | PATCH |
| Add a `weekendsOnly` helper to `src/calendar/lib.ts` | MINOR |
| Extend the sync range from 60 days to 10 years | MINOR |
| Add the version display to the Settings dialog | MINOR |
| Move persisted events into a new storage schema | MAJOR |
| Change the `/ics` proxy response format | MAJOR |

## Enforcement

You cannot silently forget the bump:

1. `npm run build` starts with `npm run version:check` and fails on a mismatch.
2. `npm test` includes `src/__tests__/version.test.ts`, which fails when:
   - the `package.json` version differs from `APP_VERSION`
   - the newest `VERSION_HISTORY` entry is not `APP_VERSION`
   - the history is not newest-first, has duplicates, or is malformed
   - a release did not bump exactly one semver field
3. Agent instruction files (`AGENTS.md`, `.clinerules/`, `.cursor/rules/`,
   `.github/copilot-instructions.md`, `CLAUDE.md`) require the bump.

## Changelog

Keep this in sync with `VERSION_HISTORY` in `src/version.ts`. The newest entry
is always the current version.

| Version | Date | Level | Summary |
|---------|------|-------|---------|
| 0.2.0 | 2026-09-20 | minor | Version is now a single source of truth with automated sync/check/bump tooling and agent-enforced versioning rules. |
| 0.1.0 | 2026-09-20 | minor | Extend the schedule sync range to 10 years forward (new `addYears` helper) and show the app version in Settings. |
