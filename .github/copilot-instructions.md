# GitHub Copilot instructions

Full repository rules live in [`AGENTS.md`](../AGENTS.md). The most important one:

## Version bumping is mandatory

`src/version.ts` → `APP_VERSION` is the **single source of truth** for the app
version. `package.json` and the Settings dialog derive from it — never define a
version string anywhere else.

Every task that changes code, config, or docs must finish with exactly one bump:

```bash
npm run version:bump -- <patch|minor|major> "short summary of the change set"
```

### Picking the level (whole change set, highest wins)

- **MAJOR** — breaks stored data, a storage/API contract, or needs a migration
  (IndexedDB/server storage shape, the `/ics` proxy contract, feature removal).
- **MINOR** — something new or user-visible changed: a new component, hook,
  module or exported function; a new dependency; a changed default date range;
  changed ICS parsing or sync behaviour.
- **PATCH** — fixes and maintenance only: bug fixes without contract changes,
  comments, docs, formatting, tests, behaviour-preserving refactors.

One bump per task, never two steps at once. If anything in the task is breaking,
the task is MAJOR. Prefer the higher level when unsure.

### Verification

- `npm test` — includes `src/__tests__/version.test.ts`, which fails when
  `package.json` drifts from `src/version.ts` or the changelog is inconsistent.
- `npm run version:check` — runs automatically before `npm run build`.

See [`VERSION.md`](../VERSION.md) for the complete policy.
