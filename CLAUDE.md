# CLAUDE.md

See [`AGENTS.md`](./AGENTS.md) for the full repository rules.

**The one rule you must not forget:** every meaningful change bumps the app
version, exactly once, at the end of the task.

```bash
npm run version:bump -- <patch|minor|major> "short summary of the change set"
```

`src/version.ts` → `APP_VERSION` is the single source of truth; `package.json`
and the Settings dialog derive from it. Choose the level by judging the whole
change set: **MAJOR** for breaking data/API/migration changes, **MINOR** for new
features or user-visible behaviour changes, **PATCH** for fixes, docs, tests, and
behaviour-preserving refactors. Never skip a level, never bump twice in one task.

Verify with `npm test` (which includes `src/__tests__/version.test.ts`) and
`npm run build` (which runs `npm run version:check` first).

Full policy: [`VERSION.md`](./VERSION.md).
