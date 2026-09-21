import { describe, expect, it } from 'vitest';
import {
  SWIPE_MIN_PX,
  TAP_MAX_MS,
  TAP_SLOP_PX,
  isTap,
  swipeDirection,
} from '../lib';

/**
 * These helpers decide whether a pointer gesture creates an event, navigates, or
 * is ignored. The regression they guard against: creating an event on
 * pointer-*down* meant every attempt to scroll the grid on a phone popped open a
 * blank event dialog.
 */

describe('isTap', () => {
  const at = (x: number, y: number) => ({ x, y });

  it('accepts a press that stays put and is brief', () => {
    expect(isTap(at(100, 200), at(100, 200), 0)).toBe(true);
    expect(isTap(at(100, 200), at(100, 200), TAP_MAX_MS)).toBe(true);
  });

  it('accepts movement inside the slop radius', () => {
    // A real finger always wobbles a pixel or two while tapping.
    expect(isTap(at(100, 200), at(100 + TAP_SLOP_PX, 200), 100)).toBe(true);
    expect(isTap(at(100, 200), at(100, 200 - TAP_SLOP_PX), 100)).toBe(true);
    expect(isTap(at(100, 200), at(100 + TAP_SLOP_PX, 200 + TAP_SLOP_PX), 100)).toBe(true);
  });

  it('rejects a gesture that scrolled', () => {
    // The core bug: a vertical scroll must never count as a tap.
    expect(isTap(at(100, 200), at(100, 260), 120)).toBe(false);
    expect(isTap(at(100, 200), at(100, 200 + TAP_SLOP_PX + 1), 120)).toBe(false);
    expect(isTap(at(100, 200), at(100 - TAP_SLOP_PX - 1, 200), 120)).toBe(false);
  });

  it('rejects a press held past the tap window', () => {
    // A long-press is reserved for dragging an event block.
    expect(isTap(at(100, 200), at(100, 200), TAP_MAX_MS + 1)).toBe(false);
  });

  it('rejects a negative duration (clock skew) rather than treating it as a tap', () => {
    expect(isTap(at(100, 200), at(100, 200), -1)).toBe(false);
  });

  it('honours custom thresholds', () => {
    expect(isTap(at(100, 200), at(140, 200), 100, 50, 200)).toBe(true);
    expect(isTap(at(100, 200), at(160, 200), 100, 50, 200)).toBe(false);
    expect(isTap(at(100, 200), at(100, 200), 300, 10, 200)).toBe(false);
  });

  it('rejects a swipe-sized movement as a tap', () => {
    expect(isTap(at(100, 200), at(100 - SWIPE_MIN_PX, 200), 150)).toBe(false);
  });
});

describe('swipeDirection', () => {
  const at = (x: number, y: number) => ({ x, y });

  it('reports 1 (advance) for a leftward swipe', () => {
    expect(swipeDirection(at(300, 400), at(300 - SWIPE_MIN_PX, 400))).toBe(1);
    expect(swipeDirection(at(300, 400), at(100, 400))).toBe(1);
  });

  it('reports -1 (go back) for a rightward swipe', () => {
    expect(swipeDirection(at(100, 400), at(100 + SWIPE_MIN_PX, 400))).toBe(-1);
    expect(swipeDirection(at(100, 400), at(320, 400))).toBe(-1);
  });

  it('ignores movement below the minimum distance', () => {
    expect(swipeDirection(at(300, 400), at(300 - SWIPE_MIN_PX + 1, 400))).toBe(0);
  });

  it('ignores a mostly-vertical gesture, so scrolling never navigates', () => {
    // 60px across but 200px down: a scroll with a little sideways drift.
    expect(swipeDirection(at(300, 200), at(240, 400))).toBe(0);
    // Just under 1.5x as wide as it is tall is still treated as a scroll.
    expect(swipeDirection(at(300, 200), at(151, 300))).toBe(0);
    // At or past the 1.5x ratio it is clearly horizontal, so it counts.
    expect(swipeDirection(at(300, 200), at(150, 300))).toBe(1);
    expect(swipeDirection(at(300, 200), at(140, 300))).toBe(1);
  });

  it('ignores a pure vertical scroll', () => {
    expect(swipeDirection(at(300, 100), at(300, 600))).toBe(0);
  });

  it('honours a custom minimum distance', () => {
    expect(swipeDirection(at(300, 400), at(260, 400), 30)).toBe(1);
    expect(swipeDirection(at(300, 400), at(280, 400), 30)).toBe(0);
  });
});
