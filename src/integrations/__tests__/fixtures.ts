/**
 * Synthetic Magister-style ICS fixture. Entirely fictional — contains NO real
 * feed URL and no real personal data.
 *
 * Covers: basic event, multiple events, escaped characters, folded lines,
 * UTC timestamps, a TZID-aware event (Europe/Amsterdam), an all-day event,
 * a recurring event, and events missing required fields.
 */
export const SAMPLE_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Synthetic Test//Magister-like feed//EN',
  'CALSCALE:GREGORIAN',
  'BEGIN:VEVENT',
  'UID:les-1001@magister.test',
  'DTSTAMP:20260830T060000Z',
  'LAST-MODIFIED:20260829T120000Z',
  'DTSTART:20260907T073000Z',
  'DTEND:20260907T081500Z',
  'SUMMARY:Nederlands',
  'LOCATION:B102',
  'DESCRIPTION:Huiswerk: lees hoofdstuk 4',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:les-1002@magister.test',
  'DTSTART:20260907T093000Z',
  'DTEND:20260907T101500Z',
  'SUMMARY:Wiskunde B',
  'LOCATION:A204',
  // escaped comma + semicolon + newline, and a folded line (single leading space)
  'DESCRIPTION:Opgaven 12\\, 13\\; 14\\nEn een tweede regel met een heel l',
  ' ang aanvullend stuk tekst',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:les-1003@magister.test',
  'DTSTART;TZID=Europe/Amsterdam:20260907T130000',
  'DTEND;TZID=Europe/Amsterdam:20260907T134500',
  'SUMMARY:Gym',
  'LOCATION:Sporthal',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:studiedag-1@magister.test',
  'DTSTART;VALUE=DATE:20260911',
  'DTEND;VALUE=DATE:20260912',
  'SUMMARY:Studiedag',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:roosterwijziging@magister.test',
  'DTSTART:20260908T120000Z',
  'DTEND:20260908T124500Z',
  'SUMMARY:Praktijkdag',
  'RRULE:FREQ=DAILY;COUNT=3',
  'END:VEVENT',
  // missing UID -> skipped
  'BEGIN:VEVENT',
  'DTSTART:20260909T100000Z',
  'DTEND:20260909T104500Z',
  'SUMMARY:Geen UID',
  'END:VEVENT',
  // missing DTSTART -> skipped
  'BEGIN:VEVENT',
  'UID:orphan@magister.test',
  'SUMMARY:Geen DTSTART',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

export const MALFORMED_ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nbroken';

export const RANGE = {
  from: new Date(Date.UTC(2026, 8, 7, 0, 0, 0)), // 2026-09-07
  to: new Date(Date.UTC(2026, 8, 12, 0, 0, 0)), // 2026-09-12
};
