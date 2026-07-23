import { db } from '@/lib/db';
import { stores, storeFingerprints, storeProfiles, storeKeywords } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { normalizeText, diceSimilarity } from '@/lib/matching';
import type { OcrLine } from '@/lib/ocr';
import type { StoreContext } from '@/lib/claude';

const HEADER_LINES = 10;
export const FINGERPRINT_MATCH_THRESHOLD = 0.55;
// A confirmed receipt only adds a new fingerprint when its header differs
// this much from every stored one (i.e. a genuinely new layout).
export const FINGERPRINT_NEW_LAYOUT_THRESHOLD = 0.8;
export const MAX_FINGERPRINTS_PER_STORE = 5;

/** Normalized text of the first receipt lines, used as the store fingerprint. */
export function computeHeader(lines: OcrLine[]): string {
  return normalizeText(
    lines
      .slice(0, HEADER_LINES)
      .map((l) => l.text)
      .join(' ')
  );
}

export interface StoreDetection {
  storeId: number;
  storeName: string;
  confidence: number;
}

// Confidence assigned when a user-taught store keyword matches — the strongest
// signal, since the rule was set explicitly by the user.
export const KEYWORD_MATCH_CONFIDENCE = 0.99;

/**
 * Match the receipt against stored data. `fullText` (whole OCR text) is used for
 * user-taught keyword rules; `header` (first lines) for fingerprint/name match.
 */
export function detectStore(header: string, fullText?: string): StoreDetection | null {
  if (!header) return null;

  // Highest priority: an explicit user-taught keyword present in the receipt.
  const haystack = fullText ? normalizeText(fullText) : header;
  const keywords = db
    .select({
      storeId: storeKeywords.storeId,
      keyword: storeKeywords.keyword,
      storeName: stores.name,
    })
    .from(storeKeywords)
    .innerJoin(stores, eq(storeKeywords.storeId, stores.id))
    .all();
  for (const k of keywords) {
    if (k.keyword && haystack.includes(k.keyword)) {
      return { storeId: k.storeId, storeName: k.storeName, confidence: KEYWORD_MATCH_CONFIDENCE };
    }
  }

  let best: StoreDetection | null = null;

  const fingerprints = db
    .select({
      storeId: storeFingerprints.storeId,
      normalizedHeader: storeFingerprints.normalizedHeader,
      storeName: stores.name,
    })
    .from(storeFingerprints)
    .innerJoin(stores, eq(storeFingerprints.storeId, stores.id))
    .all();

  for (const fp of fingerprints) {
    const score = diceSimilarity(header, fp.normalizedHeader);
    if (score >= FINGERPRINT_MATCH_THRESHOLD && (!best || score > best.confidence)) {
      best = { storeId: fp.storeId, storeName: fp.storeName, confidence: score };
    }
  }

  if (!best) {
    // Fallback: a known store name appearing verbatim in the header.
    const allStores = db.select().from(stores).all();
    for (const store of allStores) {
      const name = normalizeText(store.name);
      if (name && header.includes(name)) {
        best = { storeId: store.id, storeName: store.name, confidence: 0.5 };
        break;
      }
    }
  }

  return best;
}

/**
 * Teach a keyword → store rule (from marking the store text during review).
 * Stored normalized; deduped per store. Ignores too-short keywords.
 */
export function learnStoreKeyword(storeId: number, rawKeyword: string): void {
  const keyword = normalizeText(rawKeyword);
  if (!keyword || keyword.length < 2) return;
  const existing = db
    .select()
    .from(storeKeywords)
    .where(and(eq(storeKeywords.storeId, storeId), eq(storeKeywords.keyword, keyword)))
    .get();
  if (existing) return;
  db.insert(storeKeywords).values({ storeId, keyword }).run();
}

/** Load the learning profile (layout hints + few-shot examples) for a store. */
export function loadStoreContext(storeId: number): StoreContext | null {
  const profile = db
    .select()
    .from(storeProfiles)
    .where(eq(storeProfiles.storeId, storeId))
    .get();
  if (!profile) return null;

  let examples: StoreContext['examples'] = [];
  try {
    examples = JSON.parse(profile.examples);
  } catch {
    examples = [];
  }

  return { layoutHints: profile.layoutHints, examples };
}
