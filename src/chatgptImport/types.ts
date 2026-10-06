import type { CalendarEvent } from '../calendar/types';

import type { CalendarEvent } from '../calendar/types';

/** The format of the parsed import data. */
export interface ChatgptImportResult {
  events: CalendarEvent[];
  /** Human-readable description of what was parsed, for the toast. */
  description: string;
}

/** Pre-defined prompts that users can copy into ChatGPT for import-ready output. */
export const CHATGPT_PROMPTS = [
  {
    id: 'day-schedule',
    label: 'Day schedule (plain text)',
    prompt:
      'Give me my schedule for {day} as plain text, one event per line. ' +
      'Format each line exactly as "HH:MM-HH:MM Subject" using 24-hour times ' +
      '(for example "08:30-09:20 Wiskunde"). ' +
      'No headings, no bullet points, no markdown, no extra commentary — just the raw schedule lines.',
  },
  {
    id: 'week-schedule',
    label: 'Week schedule (plain text)',
    prompt:
      'Give me my schedule for the week starting {startDate} as plain text, one event per line. ' +
      'Format each line exactly as "Weekday HH:MM-HH:MM Subject" using 24-hour times ' +
      '(for example "Monday 08:30-09:20 Wiskunde"). ' +
      'No headings, no bullet points, no markdown, no extra commentary — just the raw schedule lines.',
  },
  {
    id: 'json-events',
    label: 'JSON events (most reliable)',
    prompt:
      'Give me my schedule for {day} as a JSON array and nothing else. ' +
      'Each event is an object with exactly these keys: ' +
      '"title" (string), "start" (ISO datetime with timezone offset), "end" (ISO datetime with timezone offset). ' +
      'Example: [{"title": "Wiskunde", "start": "2026-10-06T08:30:00+02:00", "end": "2026-10-06T09:20:00+02:00"}]. ' +
      'No markdown, no code fences, no surrounding text — just the JSON array.',
  },
  {
    id: 'ics-export',
    label: 'iCalendar (ICS) export',
    prompt:
      'Give me my schedule for {day} as an iCalendar (ICS) document and nothing else: ' +
      'a VCALENDAR block containing one VEVENT per event with UID, DTSTART, DTEND and SUMMARY. ' +
      'No markdown, no code fences, no surrounding text — just the ICS content.',
  },
] as const;

/** Result of selecting a prompt. */
export type ChatgptPromptId = (typeof CHATGPT_PROMPTS)[number]['id'];