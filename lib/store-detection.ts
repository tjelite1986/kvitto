import { db } from '@/lib/db';
import { stores, storeFingerprints, storeProfiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
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

/** Match the receipt header against stored fingerprints and store names. */
export function detectStore(header: string): StoreDetection | null {
  if (!header) return null;

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
