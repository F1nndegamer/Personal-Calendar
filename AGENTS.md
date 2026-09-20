# AGENTS.md — working rules for this repository

Instructions for **any** AI coding agent (Cline, Cursor, Copilot, Claude Code,
Codex, Windsurf, …) and for humans. Read this before making changes.

## 1. ALWAYS bump the version (non-negotiable)

`personal-calendar` is versioned with semver. **Every task or PR that changes
anything meaningful must increment the version, exactly once.**

- **Single source of truth:** `src/version.ts` → `APP_VERSION`
- **Full policy + decision table:** `VERSION.md`
- **Never** hard-code a version string anywhere else. `package.json` and the
  Settings dialog both derive from `src/version.ts`.

### How to pick the level

Judge the **whole change set of the task**, not individual files, and take the
*highest* level that applies. Then bump exactly one step — never skip a level.

| Level | Increment when the change set… | Examples |
|-------|-------------------------------|----------|
| **MAJOR** | breaks stored data, an API contract, or requires a migration | changing the IndexedDB/server storage shape, changing the `/ics` proxy contract, deleting a feature |
| **MINOR** | adds something new or changes user-visible behaviour | new component/hook/module/exported function, new dependency, different default date range, changed parsing rules, sync behaviour change |
| **PATCH** | only fixes or maintains | bug fix with no contract change, comments, docs, formatting, test-only changes, behaviour-preserving refactor, dependency upgrade |

One bump per task even if you shipped ten features. If a task contains both a
fix and a feature, it is **MINOR**. If it contains anything breaking, it is
**MAJOR**.

### The command

```bash
npm run version:bump -- <patch|minor|major> "One-line summary of the change set"
```

That single command updates `APP_VERSION`, prepends a `VERSION_HISTORY` entry
dated today, and syncs `package.json`. Do not hand-edit the versions.

### Keep it honest

- `npm run version:check` must pass (it runs automatically at the start of
  `npm run build`).
- `npm test` includes `src/__tests__/version.test.ts`, which fails if
  `package.json` drifts from `src/version.ts`, if the newest history entry is
  not the current version, or if a release did not bump exactly one semver field.

## 2. Project commands

```bash
npm run dev            # Vite dev server
npm test               # vitest run (includes the version test)
npm run lint           # eslint .
npm run build          # version:check -> build:server -> vite build
npm run version:check  # verify package.json == src/version.ts
npm run version:bump   # bump + changelog + sync
```

## 3. Code conventions

- React 19 function components, TypeScript strict-ish config
  (`verbatimModuleSyntax`, `noUnusedLocals`, `noUnusedParameters`).
- Use `import type { … }` for type-only imports — the build enforces
  `verbatimModuleSyntax`.
- Tests live in `__tests__/` folders next to the code they cover and are named
  `*.test.ts` (`src/**/__tests__/`, `server/**/__tests__/`).
- Do not import `node:*` builtins into `src/` — `tsconfig.app.json` restricts
  types to `vite/client` (use Vite's `?raw` imports if you need file contents).
- Prefer the existing helpers in `src/calendar/lib.ts` over ad-hoc date maths.
- Never commit the Magister feed URL; it is a secret. See `DEPLOY.md`.

## 4. Definition of done

1. Version bumped with `npm run version:bump -- …` (unless the task truly
   changes nothing, e.g. answering a question).
2. `npm test` passes.
3. `npm run build` passes.
4. No new lint errors beyond the known pre-existing ones in `src/App.tsx`.
