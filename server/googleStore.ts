/**
 * Server-side Google token + selection persistence.
 *
 * Tokens live in a SEPARATE file from the calendar data
 * (`GOOGLE_AUTH_PATH`, default alongside the main storage file as
 * `google-auth.json`) with `0600` permissions — `GET /api/storage`
 * never sees them, so they can never leak to the browser.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { GoogleTokens } from './googleTypes.js';

export interface GoogleAuthData {
  tokens: GoogleTokens | null;
  email?: string;
  /** Selected calendar ids for import (default: primary). */
  selectedCalendarIds?: string[];
  /** Epoch ms of the last successful server-side Google sync, if any. */
  lastSyncAt?: number;
  /** Human-readable detail for the last failed sync, if any. */
  lastError?: string;
}

const DEFAULT_AUTH: GoogleAuthData = { tokens: null };

export function googleAuthPath(): string {
  if (process.env.GOOGLE_AUTH_PATH) return process.env.GOOGLE_AUTH_PATH;
  const storage = process.env.STORAGE_PATH || '/var/lib/personal-calendar/data.json';
  return join(dirname(resolve(storage)), 'google-auth.json');
}

/** File mode 0600 — owner read/write only. */
export function writeGoogleAuth(data: GoogleAuthData): void {
  const path = googleAuthPath();
  const dir = dirname(resolve(path));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), { encoding: 'utf-8', mode: 0o600 });
  try {
    renameSync(tmp, path);
  } catch {
    writeFileSync(path, JSON.stringify(data), { encoding: 'utf-8', mode: 0o600 });
  }
  try {
    const { chmodSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs');
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
}

function isTokens(v: unknown): v is GoogleTokens {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return typeof r.accessToken === 'string' && typeof r.expiresAt === 'number';
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export function readGoogleAuth(): GoogleAuthData {
  try {
    const path = googleAuthPath();
    if (!existsSync(path)) return DEFAULT_AUTH;
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<GoogleAuthData>;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_AUTH;
    return {
      tokens: isTokens(parsed.tokens) ? parsed.tokens : null,
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
      selectedCalendarIds: isStringArray(parsed.selectedCalendarIds)
        ? (parsed.selectedCalendarIds as string[]).slice(0, 50)
        : undefined,
      lastSyncAt: typeof parsed.lastSyncAt === 'number' ? parsed.lastSyncAt : undefined,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : undefined,
    };
  } catch {
    return DEFAULT_AUTH;
  }
}

/** Pending OAuth `state` values (CSRF protection, single-flight). */
const pendingStates = new Map<string, number>();
const STATE_TTL_MS = 10 * 60_000;

export function rememberOAuthState(state: string, now = Date.now()): void {
  pendingStates.set(state, now);
}

export function consumeOAuthState(state: string, now = Date.now()): boolean {
  const issued = pendingStates.get(state);
  pendingStates.delete(state);
  if (issued === undefined) return false;
  // Sweep expired entries opportunistically.
  for (const [k, t] of pendingStates) {
    if (now - t > STATE_TTL_MS) pendingStates.delete(k);
  }
  return now - issued <= STATE_TTL_MS;
}

/** Test hook — clears pending states. */
export function clearOAuthStates(): void {
  pendingStates.clear();
}
