import { db } from '@/lib/db';
import { storeFingerprints, storeProfiles, productAliases, receiptItems } from '@/lib/db/schema';
import { asc, eq } from 'drizzle-orm';
import { diceSimilarity, levenshteinSimilarity, normalizeAlias } from '@/lib/matching';
import {
  computeHeader,
  FINGERPRINT_NEW_LAYOUT_THRESHOLD,
  MAX_FINGERPRINTS_PER_STORE,
} from '@/lib/store-detection';
import type { OcrResult } from '@/lib/ocr';
import type { ParsedItem } from '@/lib/claude';

// All learning happens at confirm time — the only moment ground truth exists.

const MAX_EXAMPLES = 8;
const EXAMPLE_DUP_THRESHOLD = 0.9;
const ALIAS_DECAY = 0.5;

/**
 * Record the receipt header as a fingerprint for the store, unless a similar
 * layout is already known. Capped, oldest evicted.
 */
export function learnFingerprint(storeId: number, ocr: OcrResult): void {
  const header = computeHeader(ocr.lines);
  if (!header) return;

  const existing = db
    .select()
    .from(storeFingerprints)
    .where(eq(storeFingerprints.storeId, storeId))
    .orderBy(asc(storeFingerprints.createdAt))
    .all();

  for (const fp of existing) {
    if (diceSimilarity(header, fp.normalizedHeader) >= FINGERPRINT_NEW_LAYOUT_THRESHOLD) {
      return; // this layout is already known
    }
  }

  db.insert(storeFingerprints).values({ storeId, normalizedHeader: header }).run();

  const excess = existing.length + 1 - MAX_FINGERPRINTS_PER_STORE;
  for (let i = 0; i < excess; i++) {
    db.delete(storeFingerprints).where(eq(storeFingerprints.id, existing[i].id)).run();
  }
}

export interface ConfirmedItemForLearning {
  rawText: string;
  qty: number;
  unit: string;
  unitPriceOre: number | null;
  lineTotalOre: number;
  offerQty: number | null;
  offerTotalOre: number | null;
  discountOre: number;
  pantOre: number;
}

interface CorrectionExample {
  ocr_excerpt: string;
  model_output: unknown;
  corrected: unknown;
}

function itemSnapshot(item: ConfirmedItemForLearning) {
  return {
    name: item.rawText,
    qty: item.qty,
    unit: item.unit,
    unit_price_ore: item.unitPriceOre,
    line_total_ore: item.lineTotalOre,
    offer_qty: item.offerQty,
    offer_total_ore: item.offerTotalOre,
    discount_ore: item.discountOre,
    pant_ore: item.pantOre,
  };
}

function parsedSnapshot(item: ParsedItem) {
  return {
    name: item.name,
    qty: item.qty,
    unit: item.unit,
    unit_price_ore: item.unit_price_ore,
    line_total_ore: item.line_total_ore,
    offer_qty: item.offer_qty,
    offer_total_ore: item.offer_total_ore,
    discount_ore: item.discount_ore,
    pant_ore: item.pant_ore,
  };
}

function materiallyDifferent(parsed: ParsedItem, confirmed: ConfirmedItemForLearning): boolean {
  return (
    normalizeAlias(parsed.name) !== normalizeAlias(confirmed.rawText) ||
    parsed.qty !== confirmed.qty ||
    parsed.unit !== confirmed.unit ||
    (parsed.unit_price_ore ?? null) !== (confirmed.unitPriceOre ?? null) ||
    parsed.line_total_ore !== confirmed.lineTotalOre ||
    (parsed.offer_qty ?? null) !== (confirmed.offerQty ?? null) ||
    (parsed.offer_total_ore ?? null) !== (confirmed.offerTotalOre ?? null) ||
    parsed.discount_ore !== (confirmed.discountOre ?? 0) ||
    (parsed.pant_ore || 0) !== (confirmed.pantOre ?? 0)
  );
}

/**
 * Diff the confirmed items against what Claude parsed; materially changed
 * items become few-shot correction examples on the store profile.
 */
export function learnCorrections(
  storeId: number,
  parsedItems: ParsedItem[],
  confirmedItems: ConfirmedItemForLearning[]
): void {
  const newExamples: CorrectionExample[] = [];
  const usedParsed = new Set<number>();

  for (const confirmed of confirmedItems) {
    // Match the confirmed row to the most similar parsed item not used yet
    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < parsedItems.length; i++) {
      if (usedParsed.has(i)) continue;
      const score = levenshteinSimilarity(
        normalizeAlias(parsedItems[i].name),
        normalizeAlias(confirmed.rawText)
      );
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex === -1 || bestScore < 0.5) continue;
    usedParsed.add(bestIndex);

    const parsed = parsedItems[bestIndex];
    if (!materiallyDifferent(parsed, confirmed)) continue;

    newExamples.push({
      ocr_excerpt: parsed.source_lines.join('\n') || parsed.name,
      model_output: parsedSnapshot(parsed),
      corrected: itemSnapshot(confirmed),
    });
  }

  if (newExamples.length === 0) return;

  const profile = db
    .select()
    .from(storeProfiles)
    .where(eq(storeProfiles.storeId, storeId))
    .get();

  let examples: CorrectionExample[] = [];
  if (profile) {
    try {
      examples = JSON.parse(profile.examples);
    } catch {
      examples = [];
    }
  }

  for (const example of newExamples) {
    // Near-duplicate excerpts replace the old example instead of appending
    const dupIndex = examples.findIndex(
      (e) =>
        levenshteinSimilarity(
          normalizeAlias(e.ocr_excerpt),
          normalizeAlias(example.ocr_excerpt)
        ) >= EXAMPLE_DUP_THRESHOLD
    );
    if (dupIndex >= 0) {
      examples[dupIndex] = example;
    } else {
      examples.push(example);
    }
  }
  while (examples.length > MAX_EXAMPLES) examples.shift(); // FIFO eviction

  if (profile) {
    db.update(storeProfiles)
      .set({ examples: JSON.stringify(examples), updatedAt: new Date().toISOString() })
      .where(eq(storeProfiles.id, profile.id))
      .run();
  } else {
    db.insert(storeProfiles)
      .values({ storeId, examples: JSON.stringify(examples) })
      .run();
  }
}

/**
 * When the user overrides a pre-linked product, halve the alias confidence so
 * a wrong auto-link stops being applied after repeated corrections.
 */
export function decayOverriddenAliases(
  receiptId: number,
  storeId: number | null,
  confirmedItems: Array<{ rawText: string; productId?: number | null }>
): void {
  const previousItems = db
    .select()
    .from(receiptItems)
    .where(eq(receiptItems.receiptId, receiptId))
    .all();

  for (const prev of previousItems) {
    if (!prev.productId) continue;
    const match = confirmedItems.find(
      (c) => normalizeAlias(c.rawText) === normalizeAlias(prev.rawText)
    );
    if (!match || match.productId === prev.productId) continue;

    // The pre-linked product was changed — decay the alias that caused it
    const aliasText = normalizeAlias(prev.rawText);
    const alias = db
      .select()
      .from(productAliases)
      .where(eq(productAliases.aliasText, aliasText))
      .all()
      .find((a) => a.storeId === storeId && a.productId === prev.productId);
    if (alias) {
      db.update(productAliases)
        .set({ confidence: alias.confidence * ALIAS_DECAY })
        .where(eq(productAliases.id, alias.id))
        .run();
    }
  }
}

/** Extract the parsed items Claude produced, from the stored claude_raw blob. */
export function parsedItemsFromRaw(claudeRaw: string | null): ParsedItem[] {
  if (!claudeRaw) return [];
  try {
    const raw = JSON.parse(claudeRaw);
    return raw?.parsed?.items ?? [];
  } catch {
    return [];
  }
}
