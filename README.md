# Personal Calendar

A Vite + React 19 + TypeScript calendar app that syncs a private Magister
iCalendar feed through a small Node proxy, and keeps its data locally
(IndexedDB) and on a self-hosted server.

- **Versioning & release policy:** [`VERSION.md`](./VERSION.md)
- **Rules for agents & contributors:** [`AGENTS.md`](./AGENTS.md)
- **Production deployment:** [`DEPLOY.md`](./DEPLOY.md)

## Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Vite dev server |
| `npm test` | Run the suite (includes the version-consistency test) |
| `npm run lint` | ESLint |
| `npm run build` | `version:check` → build server → build frontend |
| `npm run version:bump -- <patch\|minor\|major> "<summary>"` | Bump the app version, add a changelog entry, sync `package.json` |
| `npm run version:check` | Fail if `package.json` and `src/version.ts` disagree |

> **Every meaningful change bumps the version.** `src/version.ts` is the single
> source of truth; `npm run build` and `npm test` both fail if it drifts.
> See [`VERSION.md`](./VERSION.md) for how to pick the level.

---

## React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
