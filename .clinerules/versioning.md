# Cline rules — version bumping (REQUIRED)

This repository versions every meaningful change. **Before you finish a task,
you must bump the version.**

## Single source of truth

`src/version.ts` → `APP_VERSION`. Nothing else may define a version string.
`package.json` and the Settings dialog both derive from it.

## Required action

At the end of any task that changes code, config, or docs, run exactly one bump:

```bash
npm run version:bump -- <patch|minor|major> "short summary of the change set"
```

This updates `APP_VERSION`, prepends a `VERSION_HISTORY` entry, and syncs
`package.json`. Never edit the version numbers by hand.

## Choosing the level (judge the whole change set, take the highest)

- **MAJOR** — stored data, storage shape, API contract, or something requiring a
  migration/deploy step breaks. Example: changing the IndexedDB or server
  storage format, changing the `/ics` proxy contract.
- **MINOR** — something new or user-visible changed. Example: a new component,
  hook, module or exported function; a new dependency; a different default date
  range; changed ICS parsing or sync behaviour.
- **PATCH** — fixes and maintenance only. Example: a bug fix with no contract
  change, comments, docs, formatting, tests, a behaviour-preserving refactor.

Bump exactly **one** step per task. Many changes in one task are still a single
bump; if any of them is breaking, the whole task is MAJOR. When in doubt between
two levels, prefer the higher one.

## Verification (part of "done")

```bash
npm run version:check   # must pass
npm test                # includes src/__tests__/version.test.ts
npm run build           # runs version:check first
```

If `npm test` or `npm run version:check` reports a version mismatch, fix it with
`npm run version:sync` only if the source of truth is already correct; otherwise
bump properly as above.

## Don't

- Don't skip the bump because "the change is small" — small changes are PATCH,
  not zero.
- Don't bump more than once per task, and don't jump two levels.
- Don't invent a second version constant, changelog file, or `VERSION` string.
- Don't edit `src/version.ts` by hand when `version:bump` can do it.

See `VERSION.md` for the full policy and `AGENTS.md` for general repo rules.
