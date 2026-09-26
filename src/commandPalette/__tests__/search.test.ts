import { describe, expect, it } from 'vitest';
import { scoreCommand, searchCommands } from '../search';
import type { CommandItem } from '../search';

const action = (id: string, title: string, extra: Partial<CommandItem> = {}): CommandItem => ({
  id,
  group: 'action',
  title,
  ...extra,
});

const task = (id: string, title: string, extra: Partial<CommandItem> = {}): CommandItem => ({
  id,
  group: 'task',
  title,
  ...extra,
});

describe('scoreCommand', () => {
  it('gives every item the same score for an empty query', () => {
    expect(scoreCommand(action('a', 'Anything'), '')).toBe(0);
    expect(scoreCommand(action('a', 'Anything'), '   ')).toBe(0);
  });

  it('rejects a query whose characters are not all present', () => {
    expect(scoreCommand(action('a', 'Anything'), 'zzz')).toBeNull();
  });

  it('requires every token of a multi-word query to match', () => {
    const item = action('a', 'Math homework');
    expect(scoreCommand(item, 'math homework')).not.toBeNull();
    expect(scoreCommand(item, 'homework math')).not.toBeNull();
    expect(scoreCommand(item, 'math chemistry')).toBeNull();
  });

  it('matches case-insensitively', () => {
    expect(scoreCommand(action('a', 'Math homework'), 'MATH')).not.toBeNull();
    expect(scoreCommand(action('a', 'MATH HOMEWORK'), 'math')).not.toBeNull();
  });

  it('ranks a title match above a detail-only match', () => {
    const inTitle = action('a', 'Math homework');
    const inDetail = action('b', 'Chemistry', { detail: 'Math homework' });
    const titleScore = scoreCommand(inTitle, 'math');
    const detailScore = scoreCommand(inDetail, 'math');
    expect(titleScore).not.toBeNull();
    expect(detailScore).not.toBeNull();
    expect(titleScore!).toBeGreaterThan(detailScore!);
  });

  it('ranks a contiguous match above a scattered one', () => {
    const contiguous = action('a', 'Math');
    const scattered = action('b', 'My Awful Terrible Head');
    const tight = scoreCommand(contiguous, 'math');
    const loose = scoreCommand(scattered, 'math');
    expect(tight).not.toBeNull();
    expect(loose).not.toBeNull();
    expect(tight!).toBeGreaterThan(loose!);
  });
});

describe('searchCommands', () => {
  const items: CommandItem[] = [
    action('a1', 'Go to today'),
    { id: 'e1', group: 'event', title: 'Maths lesson' },
    task('t1', 'Maths homework'),
    action('a2', 'Open settings'),
  ];

  it('groups matches in action / event / task order', () => {
    const sections = searchCommands(items, '');
    expect(sections.map((s) => s.group)).toEqual(['action', 'event', 'task']);
    expect(sections[0].items.map((i) => i.id)).toEqual(['a1', 'a2']);
  });

  it('keeps the caller order when nothing is being searched', () => {
    const unsorted = [action('z', 'Zebra'), action('a', 'Aardvark')];
    expect(searchCommands(unsorted, '')[0].items.map((i) => i.id)).toEqual(['z', 'a']);
  });

  it('drops groups with no matches', () => {
    expect(searchCommands(items, 'maths').map((s) => s.group)).toEqual(['event', 'task']);
  });

  it('finds an item by its detail line', () => {
    const byDetail = [task('t1', 'Chemistry', { detail: 'Math homework' })];
    const sections = searchCommands(byDetail, 'math');
    expect(sections.flatMap((s) => s.items).map((i) => i.id)).toEqual(['t1']);
  });

  it('ranks the better match first within its group', () => {
    const ranked = [
      task('late', 'Science homework, maths due'),
      task('early', 'Mathematics'),
    ];
    expect(searchCommands(ranked, 'math')[0].items.map((i) => i.id)).toEqual([
      'early',
      'late',
    ]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(searchCommands(items, 'qqqq')).toEqual([]);
  });

  it('caps each group so one noisy group cannot crowd out the rest', () => {
    const many: CommandItem[] = Array.from({ length: 20 }, (_, i) => ({
      id: `e${i}`,
      group: 'event',
      title: `Event ${i}`,
    }));
    expect(searchCommands(many, '', 3)[0].items).toHaveLength(3);
  });
});
