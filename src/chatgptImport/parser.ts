import { addDays, startOfDay } from '../calendar/lib';
import type { CalendarEvent, EventColor } from '../calendar/types';
import { parseIcs } from '../integrations/icsParser';
import type { ChatgptImportResult } from './types';
import { uid } from '../utils';

/** Event color rotation - simple cycle through available colors */
const EVENT_COLORS: EventColor[] = ['blue', 'green', 'amber', 'red', 'purple', 'cyan'];
let colorIndex = 0;
function getNextColor(): EventColor {
  const color = EVENT_COLORS[colorIndex];
  colorIndex = (colorIndex + 1) % EVENT_COLORS.length;
  return color;
}

/**
 * Deterministic identity for an imported event so re-importing the same
 * ChatGPT output never duplicates: same day + same times + same normalized
 * title → same externalId, and the App layer skips ids it already owns.
 */
export function chatgptExternalId(title: string, startIso: string, endIso: string): string {
  const norm = title.trim().toLowerCase().replace(/\s+/g, ' ');
  let hash = 0;
  const SEP = String.fromCharCode(0);
  const key = norm + SEP + startIso + SEP + endIso;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i) + i) | 0;
  }
  return `chatgpt:${(hash >>> 0).toString(36)}`;
}

/** Helper to create a CalendarEvent */
function createEvent(title: string, start: string, end: string): CalendarEvent {
  return {
    id: uid('cal'),
    title,
    start,
    end,
    color: getNextColor(),
    source: 'local',
    externalId: chatgptExternalId(title, start, end),
  };
}

/** Strip markdown code fences ChatGPT loves to wrap JSON/ICS in. */
function stripCodeFences(input: string): string {
  const trimmed = input.trim();
  const fence = /^```(?:json|ics|ical|text|plaintext)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(trimmed);
  return fence ? fence[1].trim() : trimmed;
}

/** Parse a "HH:MM" (24h) or "h:MMam/pm" (12h) token → minutes from midnight, or null. */
function parseTimeToken(token: string): number | null {
  const m24 = /^(\d{1,2}):(\d{2})$/.exec(token);
  if (m24) {
    const h = Number(m24[1]);
    const m = Number(m24[2]);
    if (h > 23 || m > 59) return null;
    return h * 60 + m;
  }
  const m12 = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i.exec(token);
  if (m12) {
    let h = Number(m12[1]);
    const m = Number(m12[2] ?? '0');
    if (h < 1 || h > 12 || m > 59) return null;
    const pm = m12[3].toLowerCase() === 'p';
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
    return h * 60 + m;
  }
  return null;
}

/** A time token possibly followed by a separate am/pm word. */
const TIME_AT_START_RE = /^(\d{1,2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?)\b\s*/i;

/** Consume one time token from the start of `s`; null when none present. */
function consumeTime(s: string): { mins: number; rest: string } | null {
  const m = TIME_AT_START_RE.exec(s);
  if (!m) return null;
  const mins = parseTimeToken(m[1].replace(/\s+/g, ''));
  if (mins === null) return null;
  return { mins, rest: s.slice(m[0].length) };
}

/** Separator between a start and end time: "-", "to", "until", "till", "tot". */
const RANGE_SEP_RE = /^(?:\s*(?:-|–|—|to|until|till|t\/m|t\/e|tm|tot)\s*)/i;

/** Build a Date on `day` at `mins` minutes from midnight. */
function atTime(day: Date, mins: number): Date {
  const d = new Date(day);
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return d;
}

/**
 * Parse plain-text schedule lines.
 *
 * Accepted per line (day prefix optional):
 *   "08:00-09:00 Math", "09:00 Math" (1h), "9am-10:30am Math",
 *   "Monday 08:00-09:00 Math", "Mon: 8:00 - 9:00 Math"
 *
 * Lines without a recognizable leading time are skipped (usually headings
 * or commentary ChatGPT adds around the schedule).
    // Strip list markers ("- ", "1. ") but never time digits.
    .map((l) => l.trim().replace(/^(?:[-*]\s+|\d{1,2}[.)]\s+)/, ''))
 */
function parsePlainText(input: string, reference: Date): ChatgptImportResult | null {
  const lines = input
    .split(/[\r\n]+/)
    .map((l) => l.trim()) // (old strip removed; per-line guard below handles markers)
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;

  const baseDate = startOfDay(reference);
  const events: CalendarEvent[] = [];

  for (const rawLine of lines) {
    // Strip a list marker ("- item", "1. item") only when the line does NOT
    // start with a digit — so "08:00 Math" is never mangled into "8:00 Math".
    const line = /^\d/.test(rawLine) ? rawLine : rawLine.replace(/^(?:[-*]\s+|\d{1,2}[.)]\s+)/, '');
    let dateOffset = 0;
    let remaining = line;

    // Day prefix like "Monday:", "Mon 08:00" (same-day aware).
    const dayMatch = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*[:,–—-]?\s+/i.exec(line);
    if (dayMatch) {
      const dayMap: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
      const currentDOW = baseDate.getDay() === 0 ? 6 : baseDate.getDay() - 1;
      const targetDOW = dayMap[dayMatch[1].toLowerCase()];
      dateOffset = (targetDOW - currentDOW + 7) % 7;
      remaining = line.slice(dayMatch[0].length).trim();
    }

    const targetDate = addDays(baseDate, dateOffset);
    const startTok = consumeTime(remaining);
    if (!startTok) continue;

    // Optional end time after a separator ("08:00-09:00", "9am to 10am").
    // The separator check runs BEFORE stray-punctuation cleanup: "-" is the
    // range separator, so stripping it first would hide the end time.
    let endMins: number | null = null;
    let title = startTok.rest;
    const sep = RANGE_SEP_RE.exec(title);
    if (sep) {
      const endTok = consumeTime(title.slice(sep[0].length));
      if (endTok) {
        endMins = endTok.mins;
        title = endTok.rest;
      }
    }
    // Clean stray leading punctuation (":" after a time, bullet remnants).
    title = title.replace(/^[\s:–—-]+/, '').trim();
    if (!title) continue;

    const start = atTime(targetDate, startTok.mins);
    let end: Date;
    if (endMins !== null) {
      end = atTime(targetDate, endMins);
      if (end.getTime() <= start.getTime()) end = addDays(end, 1);
    } else {
      end = new Date(start.getTime() + 60 * 60_000);
    }
    events.push(createEvent(title, start.toISOString(), end.toISOString()));
  }

  if (events.length === 0) return null;
  return { events, description: `Parsed ${events.length} events from plain text` };
}

/** Shape of one JSON event object from the prompt template. */
interface JsonEventInput {
  title?: unknown;
  start?: unknown;
  end?: unknown;
}

/** Parse a JSON events array [{ title, start, end }, …]. */
function parseJsonEvents(events: JsonEventInput[]): ChatgptImportResult {
  const result: CalendarEvent[] = [];
  for (const e of events) {
    if (typeof e !== 'object' || e === null) continue;
    if (typeof e.title !== 'string' || typeof e.start !== 'string' || typeof e.end !== 'string') {
      continue;
    }
    const s = new Date(e.start);
    const t = new Date(e.end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(t.getTime())) continue;
    if (t.getTime() <= s.getTime()) continue;
    const title = e.title.trim();
    if (!title) continue;
    result.push(createEvent(title, s.toISOString(), t.toISOString()));
  }
  if (result.length === 0) return { events: [], description: '' };
  return { events: result, description: `Parsed ${result.length} events from JSON` };
}

/** Parse pasted ICS (VEVENT blocks) via the shared ical.js parser. */
function parseIcsInput(text: string): ChatgptImportResult | null {
  let parsed: ReturnType<typeof parseIcs>;
  try {
    parsed = parseIcs(text);
  } catch {
    return null;
  }
  if (parsed.length === 0) return null;
  const events = parsed.map((ext) =>
    createEvent(ext.subject, new Date(ext.start).toISOString(), new Date(ext.end).toISOString()),
  );
  return { events, description: `Parsed ${events.length} events from ICS` };
}

/** Parse ChatGPT output (JSON array, ICS, or plain-text lines) into events. */
export function parseChatgptOutput(
  input: string,
  options: { referenceDate?: Date } = {},
): ChatgptImportResult | null {
  const reference = options.referenceDate ?? new Date();
  const trimmed = stripCodeFences(input);
  if (trimmed.length === 0) return null;

  if (/BEGIN:VCALENDAR/i.test(trimmed)) {
    const r = parseIcsInput(trimmed);
    if (r?.events.length) return r;
    return null;
  }

  const jsonStart = trimmed.indexOf('[');
  const jsonEnd = trimmed.lastIndexOf(']');
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      const parsed: unknown = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
      if (Array.isArray(parsed)) {
        const r = parseJsonEvents(parsed as JsonEventInput[]);
        if (r?.events.length) return r;
      }
    } catch {
      // fall through to plain text
    }
  }

  const textResult = parsePlainText(trimmed, reference);
  if (textResult?.events.length) return textResult;
  return null;
}