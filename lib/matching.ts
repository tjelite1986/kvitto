// Small hand-rolled text matching utilities (no dependencies).
// Used for store fingerprint detection and mapping parsed items to OCR lines.

/** Lowercase, collapse whitespace, strip digits and punctuation. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9]/g, ' ')
    .replace(/[^a-zåäöéü\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize an item text for alias lookup: lowercase, collapse whitespace. */
export function normalizeAlias(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function bigrams(text: string): Set<string> {
  const grams = new Set<string>();
  const words = text.split(' ');
  for (const word of words) {
    if (word.length < 2) {
      if (word.length === 1) grams.add(word);
      continue;
    }
    for (let i = 0; i < word.length - 1; i++) {
      grams.add(word.slice(i, i + 2));
    }
  }
  return grams;
}

/** Dice coefficient on character bigrams of normalized text. 0..1. */
export function diceSimilarity(a: string, b: string): number {
  const gramsA = bigrams(a);
  const gramsB = bigrams(b);
  if (gramsA.size === 0 && gramsB.size === 0) return 1;
  if (gramsA.size === 0 || gramsB.size === 0) return 0;
  let overlap = 0;
  gramsA.forEach((g) => {
    if (gramsB.has(g)) overlap++;
  });
  return (2 * overlap) / (gramsA.size + gramsB.size);
}

/** Levenshtein distance with two-row DP. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Normalized Levenshtein similarity. 1 = identical, 0 = nothing in common. */
export function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Find the best matching candidate for a query string.
 * Returns the index and score, or null when nothing reaches the threshold.
 */
export function bestMatch(
  query: string,
  candidates: string[],
  threshold: number
): { index: number; score: number } | null {
  const normQuery = normalizeAlias(query);
  let best: { index: number; score: number } | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const score = levenshteinSimilarity(normQuery, normalizeAlias(candidates[i]));
    if (score >= threshold && (!best || score > best.score)) {
      best = { index: i, score };
    }
  }
  return best;
}
