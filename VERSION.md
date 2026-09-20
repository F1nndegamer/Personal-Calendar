# Version Number

The app version is tracked in three places:

1. `package.json` — `"version"` field (used by npm/publish)
2. `src/components/Settings.tsx` — `APP_VERSION` constant (shown in the Settings dialog)
3. `src/integrations/__tests__/fixtures.ts` — not versioned (test data)

## How to increment the version

Follow **semantic versioning** (semver): `MAJOR.MINOR.PATCH`

- **PATCH** (0.0.X): Bug fixes, minor text changes, internal refactors with no user-facing impact
- **MINOR** (0.X.0): New features, UI improvements, new functions or components added
- **MAJOR** (X.0.0): Breaking changes, significant refactors, data format changes

### Examples

| Change | Increment |
|--------|-----------|
| Fixed a parsing bug | 0.0.1 |
| Added a new utility function (e.g. `addYears`) | 0.1.0 |
| Changed the default date range from 60 days to 10 years | 0.1.0 |
| Changed the version display location | 0.1.0 |
| Changed the data model or API format | 1.0.0 |

After making changes, update all three locations:

```bash
# 1. package.json: change "version" field
# 2. src/components/Settings.tsx: change APP_VERSION constant
# 3. Both should match
```
