import { describe, expect, it } from 'vitest';
import pkgRaw from '../../package.json?raw';
import { APP_VERSION, VERSION_HISTORY } from '../version';

const SEMVER = /^\d+\.\d+\.\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LEVELS = ['major', 'minor', 'patch'];

/** Parse "1.2.3" into a comparable tuple. */
function parse(version: string): [number, number, number] {
  const [major, minor, patch] = version.split('.').map(Number);
  return [major, minor, patch];
}

describe('APP_VERSION', () => {
  it('is a valid semver string', () => {
    expect(APP_VERSION).toMatch(SEMVER);
  });

  it('matches the "version" field in package.json', () => {
    const pkg = JSON.parse(pkgRaw) as { version: string };
    expect(pkg.version).toBe(APP_VERSION);
  });
});

describe('VERSION_HISTORY', () => {
  it('is not empty and its newest entry is the current version', () => {
    expect(VERSION_HISTORY.length).toBeGreaterThan(0);
    expect(VERSION_HISTORY[0].version).toBe(APP_VERSION);
  });

  it('has well-formed entries', () => {
    for (const entry of VERSION_HISTORY) {
      expect(entry.version).toMatch(SEMVER);
      expect(entry.date).toMatch(ISO_DATE);
      expect(LEVELS).toContain(entry.level);
      expect(entry.summary.trim().length).toBeGreaterThan(0);
    }
  });

  it('lists versions newest-first without duplicates', () => {
    const versions = VERSION_HISTORY.map((entry) => entry.version);
    expect(new Set(versions).size).toBe(versions.length);

    for (let i = 1; i < versions.length; i += 1) {
      const previous = parse(versions[i - 1]);
      const current = parse(versions[i]);
      const isOlder =
        previous[0] > current[0] ||
        (previous[0] === current[0] && previous[1] > current[1]) ||
        (previous[0] === current[0] && previous[1] === current[1] && previous[2] > current[2]);
      expect(isOlder).toBe(true);
    }
  });

  it('bumps exactly one semver field per release', () => {
    for (let i = 1; i < VERSION_HISTORY.length; i += 1) {
      const [nextMajor, nextMinor, nextPatch] = parse(VERSION_HISTORY[i - 1].version);
      const [prevMajor, prevMinor, prevPatch] = parse(VERSION_HISTORY[i].version);
      const level = VERSION_HISTORY[i - 1].level;
      const expected =
        level === 'major'
          ? [prevMajor + 1, 0, 0]
          : level === 'minor'
            ? [prevMajor, prevMinor + 1, 0]
            : [prevMajor, prevMinor, prevPatch + 1];
      expect([nextMajor, nextMinor, nextPatch]).toEqual(expected);
    }
  });
});
