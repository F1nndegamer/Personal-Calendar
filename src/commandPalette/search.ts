/** Which section of the palette an item belongs to — also the render order. */
export type CommandGroup = 'action' | 'event' | 'task';

/** Display labels, keyed by {@link CommandGroup}. */
export const GROUP_LABELS: Record<CommandGroup, string> = {
  action: 'Actions',
  event: 'Events',
  task: 'Tasks',
};

/** The order groups are rendered in (and therefore the order Tab walks them). */
export const COMMAND_GROUP_ORDER: readonly CommandGroup[] = ['action', 'event', 'task'];

export interface CommandItem {
  /** Unique across a palette run; also the React `key`. */
  id: string;
  group: CommandGroup;
  /** Primary line. */
  title: string;
  /** Optional second line: category / status / description. */
  detail?: string;
  /** Optional right-aligned hint: a date, a due label, or a shortcut key. */
  hint?: string;
  /** Actions only — what happens when this item is chosen. */
  run?: () => void;
}

export interface CommandSection {
  group: CommandGroup;
  items: CommandItem[];
}

/** Characters that begin a new word — matching just after one scores higher. */
const WORD_BOUNDARY = /[\s\-_/\\.,:;()[\]{}|+&@#]/;

/**
 * Score one whitespace-separated token against one piece of text.
 *
 * Greedy subsequence match with bonuses for a consecutive run, a match at the
 * start of the string, and a match at the start of a word. A contiguous hit on
 * the whole token is worth substantially more than a scattered one, and shorter
 * candidates win ties so short titles float above long descriptions.
 *
 * @returns the score, or `null` when the token is not a subsequence of `text`.
 */
function scoreToken(text: string, token: string): number | null {
  if (token.length === 0) return 1;
  const haystack = text.toLowerCase();
  if (haystack.length === 0) return null;

  let qi = 0;
  let lastMatch = -2;
  let firstMatch = -1;
  let score = 0;

  for (let i = 0; i < haystack.length && qi < token.length; i++) {
    if (haystack[i] !== token[qi]) continue;
    let bonus = 1;
    if (i === lastMatch + 1) bonus += 4; // consecutive with the previous hit
    if (i === 0) bonus += 8; // start of the whole string
    else if (WORD_BOUNDARY.test(haystack[i - 1])) bonus += 5; // start of a word
    score += bonus;
    if (firstMatch < 0) firstMatch = i;
    lastMatch = i;
    qi++;
  }
  if (qi < token.length) return null;

  const at = haystack.indexOf(token);
  if (at >= 0) {
    score += 15;
    if (at === 0) score += 10;
    else if (WORD_BOUNDARY.test(haystack[at - 1])) score += 6;
  } else {
    // Spread-out match: the more the scan had to skip, the worse it reads.
    score -= (lastMatch - firstMatch + 1 - token.length) * 0.5;
  }
  // Shorter candidates win when everything else is equal.
  return score - haystack.length * 0.02;
}

/**
 * Score one query (split on whitespace) against an item.
 *
 * Every token must land somewhere — an item matching only part of the query is
 * noise — and the tokens' scores are summed. A hit on the title outweighs a hit
 * on the detail line, so `category`/`description` matches never outrank a title.
 *
 * @returns `0` for an empty query (everything matches equally), or `null` when
 *   the query does not fully match.
 */
export function scoreCommand(item: CommandItem, query: string): number | null {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;

  let total = 0;
  for (const token of tokens) {
    let best: number | null = null;
    const title = scoreToken(item.title, token);
    if (title !== null) best = title;
    if (item.detail) {
      const detail = scoreToken(item.detail, token);
      if (detail !== null) {
        const weighted = detail * 0.7;
        if (best === null || weighted > best) best = weighted;
      }
    }
    if (best === null) return null;
    total += best;
  }
  return total;
}

/**
 * Filter `items` down to the ones matching `query`, grouped and ranked.
 *
 * Within a group results are sorted by descending score, ties broken by the
 * item's original position so the caller's ordering is preserved when nothing
 * is being searched. Groups with no matches are omitted entirely.
 *
 * @param perGroup cap per group, so one noisy group cannot push every other
 *   one out of the list.
 */
export function searchCommands(
  items: readonly CommandItem[],
  query: string,
  perGroup = 12,
): CommandSection[] {
  const scored: { item: CommandItem; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const score = scoreCommand(item, query);
    if (score !== null) scored.push({ item, score, index });
  });

  const sections: CommandSection[] = [];
  for (const group of COMMAND_GROUP_ORDER) {
    const inGroup = scored
      .filter((entry) => entry.item.group === group)
      // Scores are all 0 for an empty query, so the index tiebreak wins and
      // the caller's original order survives untouched.
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, perGroup)
      .map((entry) => entry.item);
    if (inGroup.length > 0) sections.push({ group, items: inGroup });
  }
  return sections;
}
