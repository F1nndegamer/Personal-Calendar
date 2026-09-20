#!/usr/bin/env node
/**
 * Version tooling for personal-calendar.
 *
 * `src/version.ts` is the single source of truth for the app version.
 * This script keeps `package.json` in sync with it and provides the
 * `bump` helper that implements the policy in VERSION.md.
 *
 * Usage:
 *   node scripts/version.mjs check
 *       Fail (exit 1) if package.json and src/version.ts disagree.
 *   node scripts/version.mjs sync
 *       Copy APP_VERSION from src/version.ts into package.json.
 *   node scripts/version.mjs bump <patch|minor|major> "<summary>"
 *       Increment APP_VERSION, prepend a VERSION_HISTORY entry using
 *       today's date, then sync package.json.
 *
 * npm aliases: version:check, version:sync, version:bump
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_FILE = join(ROOT, 'src', 'version.ts');
const PACKAGE_FILE = join(ROOT, 'package.json');

/** Must match the declaration in src/version.ts. */
const APP_VERSION_RE = /export const APP_VERSION = '([^']+)';/;
/** Must match the VERSION_HISTORY declaration in src/version.ts. */
const HISTORY_HEADER = 'export const VERSION_HISTORY: readonly VersionEntry[] = [';
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const LEVELS = ['patch', 'minor', 'major'];

function fail(message) {
  console.error(`\n✖ version: ${message}\n`);
  process.exit(1);
}

function readSource() {
  const source = readFileSync(VERSION_FILE, 'utf8');
  const match = APP_VERSION_RE.exec(source);
  if (!match) {
    fail(`could not find "export const APP_VERSION = '...';" in src/version.ts`);
  }
  if (!source.includes(HISTORY_HEADER)) {
    fail(`could not find the VERSION_HISTORY declaration in src/version.ts`);
  }
  return { source, version: match[1] };
}

function readPackage() {
  const raw = readFileSync(PACKAGE_FILE, 'utf8');
  return { raw, pkg: JSON.parse(raw) };
}

function writePackageVersion(version) {
  const { raw } = readPackage();
  const pattern = /("version"\s*:\s*")[^"]*(")/;
  if (!pattern.test(raw)) fail('could not locate the "version" field in package.json');
  const nextRaw = raw.replace(pattern, (_m, prefix, suffix) => `${prefix}${version}${suffix}`);
  if (nextRaw !== raw) writeFileSync(PACKAGE_FILE, nextRaw);
  return nextRaw !== raw;
}

function nextVersion(current, level) {
  const match = SEMVER_RE.exec(current);
  if (!match) fail(`"${current}" in src/version.ts is not a valid MAJOR.MINOR.PATCH version`);
  let [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (level === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (level === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Escape a summary so it is safe inside a single-quoted TS string. */
function escapeSummary(summary) {
  return summary.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\s+/g, ' ').trim();
}

function check() {
  const { version } = readSource();
  const { pkg } = readPackage();
  if (pkg.version === version) {
    console.log(`✓ version: package.json and src/version.ts agree on ${version}`);
    return;
  }
  fail(
    `version mismatch — src/version.ts says "${version}" but package.json says "${pkg.version}".\n` +
      `  Fix it with:  npm run version:sync\n` +
      `  Bump it with: npm run version:bump -- <patch|minor|major> "<summary>"`
  );
}

function sync() {
  const { version } = readSource();
  const changed = writePackageVersion(version);
  console.log(
    changed
      ? `✓ version: package.json updated to ${version}`
      : `✓ version: package.json already at ${version}`
  );
}

function bump(level, summary) {
  if (!LEVELS.includes(level)) {
    fail(`"${level ?? ''}" is not a valid level. Use one of: ${LEVELS.join(', ')}`);
  }
  if (!summary || summary.trim().length < 8) {
    fail('a short summary is required, e.g. npm run version:bump -- patch "Fix ICS range clamp"');
  }
  const { source, version } = readSource();
  const next = nextVersion(version, level);
  const entry =
    `${HISTORY_HEADER}\n` +
    `  {\n` +
    `    version: '${next}',\n` +
    `    date: '${today()}',\n` +
    `    level: '${level}',\n` +
    `    summary: '${escapeSummary(summary)}',\n` +
    `  },`;

  const nextSource = source
    .replace(APP_VERSION_RE, `export const APP_VERSION = '${next}';`)
    .replace(HISTORY_HEADER, () => entry);

  writeFileSync(VERSION_FILE, nextSource);
  writePackageVersion(next);
  console.log(`✓ version: ${version} -> ${next} (${level})`);
  console.log(`  src/version.ts    APP_VERSION + VERSION_HISTORY updated`);
  console.log(`  package.json      synced to ${next}`);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'check':
    check();
    break;
  case 'sync':
    sync();
    break;
  case 'bump':
    bump(args[0], args[1] ?? '');
    break;
  default:
    fail(
      `unknown command "${command ?? ''}".\n` +
        `  Usage: node scripts/version.mjs <check|sync|bump> [level] [summary]`
    );
}
