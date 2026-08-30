import { addDays, startOfDay } from '../calendar/lib';
import type { ParsedQuickAdd } from './types';

/**
 * Deterministic natural-language quick-add parser.
 *
 * Supports simple, single-token patterns:
 *
 *   Dates:    today | tomorrow | next week   (note: "next week" is two tokens)
 *   Times:    HH:MM   (24-hour, e.g. 17:00, 8:30, 08:30)
 *   Duration: 30m | 1h | 1h30m
 *
 * Token matching is strict — a token must *exactly* match a pattern to be
 * consumed as a date/time/duration. Anything that doesn't match becomes part
 * of the title. E.g. "3pm" stays in the title (no colon, not 24-hour format),
 * and "5" stays in the title (not HH:MM).
 *
 * When the same field appears more than once the **last** occurrence wins.
 */

// ── regex patterns ──────────────────────────────────────────

/** 24-hour time: H:MM or HH:MM (e.g. "8:30", "17:00", "08:30") */
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** Duration: Nm (minutes), e.g. "30m", "45m" */
const DURATION_MIN_RE = /^(\d+)m$/;

/** Duration: Nh (hours), e.g. "1h", "2h" */
const DURATION_HOUR_RE = /^(\d+)h$/;

/** Duration: NhMm (hours + minutes), e.g. "1h30m" */
const DURATION_HM_RE = /^(\d+)h(\d+)m$/;

// ── helper parsers ──────────────────────────────────────────

/** Parse a time token like "17:00" → minutes-from-midnight, or null. */
function parseTimeToken(token: string): number | null {
  const m = token.match(TIME_RE);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  // Validate ranges so "25:00" or "12:60" fall through to the title.
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Parse a duration token like "45m", "1h", "1h30m" → total minutes, or null. */
function parseDurationToken(token: string): number | null {
  let m = token.match(DURATION_HM_RE);
  if (m) return Number(m[1]) * 60 + Number(m[2]);

  m = token.match(DURATION_HOUR_RE);
  if (m) return Number(m[1]) * 60;

  m = token.match(DURATION_MIN_RE);
  if (m) return Number(m[1]);

  return null;
}

// ── date keyword detection ──────────────────────────────────

/**
 * Check if a (lowercased) token starts a date keyword, consuming 1 or 2
 * tokens and advancing the index. Returns the matched date (startOfDay)
 * or null if the token isn't a date keyword.
 *
 * "next week" is two tokens; everything else is one.
 */
function matchDateKeyword(
  tokens: string[],
  index: number,
  now: Date,
): { date: Date; consumed: number } | null {
  const token = tokens[index].toLowerCase();

  if (token === 'next' && index + 1 < tokens.length && tokens[index + 1].toLowerCase() === 'week') {
    return { date: addDays(startOfDay(now), 7), consumed: 2 };
  }

  if (token === 'today') {
    return { date: startOfDay(now), consumed: 1 };
  }

  if (token === 'tomorrow') {
    return { date: addDays(startOfDay(now), 1), consumed: 1 };
  }

  return null;
}

// ── public API ──────────────────────────────────────────────

/**
 * Parse a quick-add string into structured data.
 *
 * @param input  Raw text from the quick-add input field.
 * @param now    Reference "today" (defaults to `new Date()`; inject for tests).
 * @returns ParsedQuickAdd when a non-empty title remains, otherwise null
 *          (e.g. empty string, whitespace-only, or a string with only tokens
 *          and no title text).
 */
export function parseQuickAdd(input: string, now: Date = new Date()): ParsedQuickAdd | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const tokens = trimmed.split(/\s+/);
  const titleParts: string[] = [];

  let dateBase: Date | null = null;
  let timeMins: number | null = null;
  let minutes: number | null = null;

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    // 1) Date keyword (may consume 1 or 2 tokens)
    const dateMatch = matchDateKeyword(tokens, i, now);
    if (dateMatch) {
      dateBase = dateMatch.date;
      i += dateMatch.consumed;
      continue;
    }

    // 2) Time token
    const parsedTime = parseTimeToken(token);
    if (parsedTime !== null) {
      timeMins = parsedTime;
      i += 1;
      continue;
    }

    // 3) Duration token
    const parsedDuration = parseDurationToken(token);
    if (parsedDuration !== null) {
      minutes = parsedDuration;
      i += 1;
      continue;
    }

    // 4) Not a recognized token → part of the title
    titleParts.push(token);
    i += 1;
  }

  const title = titleParts.join(' ').trim();
  if (title.length === 0) return null;

  // Combine date + time into a single ISO due-date string.
  // - If a date token was found, use it as the base day.
  // - If a time token was found, set the time on that day.
  // - If only a time was given (no date), default to today.
  const result: ParsedQuickAdd = { title };

  if (dateBase !== null || timeMins !== null) {
    const day = dateBase ?? startOfDay(now);
    const due = new Date(day);
    if (timeMins !== null) {
      due.setHours(Math.floor(timeMins / 60), timeMins % 60, 0, 0);
    }
    result.dueDate = due.toISOString();
  }

  if (minutes !== null) {
    result.estimatedMinutes = minutes;
  }

  return result;
}
