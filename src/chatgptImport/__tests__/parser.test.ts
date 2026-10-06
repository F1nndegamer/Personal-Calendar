import { describe, expect, it } from 'vitest';
import { chatgptExternalId, parseChatgptOutput } from '../parser';

const REF = new Date(2026, 9, 6, 12, 0, 0); // Tue 6 Oct 2026, local noon

describe('parseChatgptOutput', () => {
  it('parses 24h time ranges on the reference day', () => {
    const r = parseChatgptOutput('08:30-09:20 Wiskunde\n09:30-10:20 Engels', { referenceDate: REF });
    expect(r?.events).toHaveLength(2);
    expect(r?.events[0].title).toBe('Wiskunde');
    const start = new Date(r!.events[0].start);
    expect(start.getHours()).toBe(8);
    expect(start.getMinutes()).toBe(30);
    expect(start.getDate()).toBe(6);
    const end = new Date(r!.events[0].end);
    expect(end.getHours()).toBe(9);
    expect(end.getMinutes()).toBe(20);
  });

  it('gives a bare start time a 1h duration', () => {
    const r = parseChatgptOutput('09:00 Math', { referenceDate: REF });
    expect(r?.events).toHaveLength(1);
    const start = new Date(r!.events[0].start).getTime();
    const end = new Date(r!.events[0].end).getTime();
    expect(end - start).toBe(60 * 60_000);
  });

  it('parses 12h times and weekday prefixes same-day aware', () => {
    // REF is a Tuesday: "Tuesday" must mean today, not +7 days.
    const r = parseChatgptOutput('Tuesday 9am-10:30am Math', { referenceDate: REF });
    expect(r?.events).toHaveLength(1);
    expect(new Date(r!.events[0].start).getDate()).toBe(6);
    expect(new Date(r!.events[0].start).getHours()).toBe(9);
    expect(new Date(r!.events[0].end).getHours()).toBe(10);
    expect(new Date(r!.events[0].end).getMinutes()).toBe(30);
  });

  it('maps a future weekday prefix forward within the same week', () => {
    const r = parseChatgptOutput('Friday 08:00-09:00 Bio', { referenceDate: REF });
    expect(r?.events).toHaveLength(1);
    expect(new Date(r!.events[0].start).getDate()).toBe(9);
  });

  it('rolls an overnight range past midnight', () => {
    const r = parseChatgptOutput('23:00-01:00 Night shift', { referenceDate: REF });
    expect(r?.events).toHaveLength(1);
    expect(new Date(r!.events[0].end).getTime()).toBeGreaterThan(
      new Date(r!.events[0].start).getTime(),
    );
    expect(new Date(r!.events[0].end).getDate()).toBe(7);
  });

  it('skips headings and commentary lines', () => {
    const r = parseChatgptOutput("Here is your schedule:\n08:00-09:00 Math\nHave a nice day!", {
      referenceDate: REF,
    });
    expect(r?.events).toHaveLength(1);
    expect(r?.events[0].title).toBe('Math');
  });

  it('rejects invalid times instead of producing garbage', () => {
    expect(parseChatgptOutput('25:00 Math', { referenceDate: REF })).toBeNull();
    expect(parseChatgptOutput('', { referenceDate: REF })).toBeNull();
  });

  it('parses a JSON array, tolerating code fences and surrounding prose', () => {
    const json =
      'Here you go:\n```json\n[{"title": "Wiskunde", "start": "2026-10-06T08:30:00", "end": "2026-10-06T09:20:00"}]\n```';
    const r = parseChatgptOutput(json, { referenceDate: REF });
    expect(r?.events).toHaveLength(1);
    expect(r?.events[0].title).toBe('Wiskunde');
  });

  it('skips malformed JSON entries instead of failing the whole import', () => {
    const json =
      '[{"title": "Good", "start": "2026-10-06T08:30:00", "end": "2026-10-06T09:20:00"},' +
      '{"title": "", "start": "nope", "end": "2026-10-06T09:20:00"}]';
    const r = parseChatgptOutput(json, { referenceDate: REF });
    expect(r?.events).toHaveLength(1);
    expect(r?.events[0].title).toBe('Good');
  });

  it('parses a pasted ICS document', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:abc-123',
      'DTSTART:20261006T083000',
      'DTEND:20261006T092000',
      'SUMMARY:Wiskunde',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const r = parseChatgptOutput(ics, { referenceDate: REF });
    expect(r?.events).toHaveLength(1);
    expect(r?.events[0].title).toBe('Wiskunde');
  });

  it('produces deterministic externalIds so re-imports dedupe', () => {
    const a = parseChatgptOutput('08:00-09:00 Math', { referenceDate: REF });
    const b = parseChatgptOutput('08:00-09:00 Math', { referenceDate: REF });
    expect(a?.events[0].externalId).toBeDefined();
    expect(a?.events[0].externalId).toBe(b?.events[0].externalId);
    expect(chatgptExternalId('Math', '2026-10-06T08:00', '2026-10-06T09:00')).toBe(
      chatgptExternalId('  math ', '2026-10-06T08:00', '2026-10-06T09:00'),
    );
  });
});
