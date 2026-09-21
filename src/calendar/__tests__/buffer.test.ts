import { describe, expect, it } from 'vitest';
import { applyBuffer, timesChanged, DEFAULT_BUFFER_MIN, MIN_EVENT_MIN } from '../buffer';
import type { CalendarEvent } from '../types';

let n = 0;
/** Local-time helper: makeEvent(2026, 8, 21, 9, 0, 60) → 21 Sep 2026 09:00–10:00 */
function makeEvent(
  y: number, m: number, d: number, h: number, min: number, durMin: number,
): CalendarEvent {
  const start = new Date(y, m, d, h, min, 0, 0);
  const end = new Date(start.getTime() + durMin * 60_000);
  const iso = (dt: Date) => {
    const pad = (v: number) => String(v).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:00`;
  };
  return { id: `e${++n}`, title: `t${n}`, start: iso(start), end: iso(end), color: 'blue' };
}

describe('applyBuffer', () => {
  const DAY = { y: 2026, m: 8, d: 21 }; // Mon 21 Sep 2026

  it('leaves a placement alone when bufferMin is 0 or negative', () => {
    const prev = makeEvent(DAY.y, DAY.m, DAY.d, 9, 0, 60);
    const proposed = { start: new Date(DAY.y, DAY.m, DAY.d, 10, 0), end: new Date(DAY.y, DAY.m, DAY.d, 11, 0) };
    expect(applyBuffer(proposed, [prev], 0)).toEqual(proposed);
    expect(applyBuffer(proposed, [prev], -5)).toEqual(proposed);
  });

  it('leaves a placement alone when there are no neighbours', () => {
    const proposed = { start: new Date(DAY.y, DAY.m, DAY.d, 10, 0), end: new Date(DAY.y, DAY.m, DAY.d, 11, 0) };
    expect(applyBuffer(proposed, [], DEFAULT_BUFFER_MIN)).toEqual(proposed);
  });

  it('pushes the start back when it sits inside the previous buffer', () => {
    // prev 09:00–10:00, proposed 10:05 (only 5 min gap) → pushed to 10:10
    const prev = makeEvent(DAY.y, DAY.m, DAY.d, 9, 0, 60);
    const proposed = { start: new Date(DAY.y, DAY.m, DAY.d, 10, 5), end: new Date(DAY.y, DAY.m, DAY.d, 11, 5) };
    const out = applyBuffer(proposed, [prev], 10);
    expect(out.start.getHours()).toBe(10);
    expect(out.start.getMinutes()).toBe(10);
    // duration preserved: end moves with the start
    expect(out.end.getTime() - out.start.getTime()).toBe(60 * 60_000);
  });

  it('pulls the end in when it runs into the next buffer', () => {
    // next starts 12:00, proposed ends 11:55 → end pulled to 11:50
    const next = makeEvent(DAY.y, DAY.m, DAY.d, 12, 0, 60);
    const proposed = { start: new Date(DAY.y, DAY.m, DAY.d, 10, 55), end: new Date(DAY.y, DAY.m, DAY.d, 11, 55) };
    const out = applyBuffer(proposed, [next], 10);
    expect(out.end.getMinutes()).toBe(50);
    expect(out.start.getMinutes()).toBe(55);
  });

  it('does not squeeze an event below MIN_EVENT_MIN — returns the proposal instead', () => {
    // next starts 10:20; proposed 09:00–10:15 with 10 min buffer would need
    // to end by 10:10 → duration 70 min ≥ MIN_EVENT_MIN, so it may pull in.
    // Make the gap tiny: next starts 09:20, proposed 09:00–10:00 → latestEnd
    // 09:10, duration only 10 min < MIN_EVENT_MIN → unchanged.
    const next = makeEvent(DAY.y, DAY.m, DAY.d, 9, 20, 60);
    const proposed = { start: new Date(DAY.y, DAY.m, DAY.d, 9, 0), end: new Date(DAY.y, DAY.m, DAY.d, 10, 0) };
    const out = applyBuffer(proposed, [next], 10);
    expect(out).toEqual(proposed);
    // Sanity: MIN_EVENT_MIN is 15 by contract.
    expect(MIN_EVENT_MIN).toBe(15);
  });

  it('ignores neighbours on a different day', () => {
    const otherDay = makeEvent(DAY.y, DAY.m, DAY.d + 1, 10, 0, 60);
    const proposed = { start: new Date(DAY.y, DAY.m, DAY.d, 10, 0), end: new Date(DAY.y, DAY.m, DAY.d, 11, 0) };
    expect(applyBuffer(proposed, [otherDay], 30)).toEqual(proposed);
  });

  it('skips the event being moved (skipId) so a drag is not blocked by itself', () => {
    const self = makeEvent(DAY.y, DAY.m, DAY.d, 10, 0, 60);
    const proposed = { start: new Date(DAY.y, DAY.m, DAY.d, 10, 0), end: new Date(DAY.y, DAY.m, DAY.d, 11, 0) };
    expect(applyBuffer(proposed, [self], 10, self.id)).toEqual(proposed);
  });

  it('treats overlapping neighbours as no buffer (explicit parallel events)', () => {
    // neighbour overlaps the proposal entirely → untouched
    const overlapping = makeEvent(DAY.y, DAY.m, DAY.d, 9, 0, 180); // 09:00–12:00
    const proposed = { start: new Date(DAY.y, DAY.m, DAY.d, 10, 0), end: new Date(DAY.y, DAY.m, DAY.d, 11, 0) };
    expect(applyBuffer(proposed, [overlapping], 10)).toEqual(proposed);
  });

  it('applies both rules together (between two events)', () => {
    const prev = makeEvent(DAY.y, DAY.m, DAY.d, 9, 0, 60);   // ends 10:00
    const next = makeEvent(DAY.y, DAY.m, DAY.d, 12, 0, 60);  // starts 12:00
    const proposed = { start: new Date(DAY.y, DAY.m, DAY.d, 10, 5), end: new Date(DAY.y, DAY.m, DAY.d, 11, 55) };
    const out = applyBuffer(proposed, [prev, next], 10);
    // start pushed to 10:10, duration kept → raw end 12:00, which collides
    // with next's 12:00 start → end pulled in to 11:50
    expect(out.start.getMinutes()).toBe(10);
    expect(out.end.getHours()).toBe(11);
    expect(out.end.getMinutes()).toBe(50);
  });

  it('does not modify the proposed Date objects in place', () => {
    const prev = makeEvent(DAY.y, DAY.m, DAY.d, 9, 0, 60);
    const proposed = { start: new Date(DAY.y, DAY.m, DAY.d, 10, 5), end: new Date(DAY.y, DAY.m, DAY.d, 11, 5) };
    const before = proposed.start.getTime();
    applyBuffer(proposed, [prev], 10);
    expect(proposed.start.getTime()).toBe(before);
  });
});

describe('timesChanged', () => {
  it('detects any difference in start or end', () => {
    const a = { start: new Date(2026, 8, 21, 9), end: new Date(2026, 8, 21, 10) };
    expect(timesChanged(a, a)).toBe(false);
    expect(timesChanged(a, { ...a, start: new Date(2026, 8, 21, 9, 1) })).toBe(true);
    expect(timesChanged(a, { ...a, end: new Date(2026, 8, 21, 10, 1) })).toBe(true);
  });
});
