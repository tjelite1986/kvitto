// Package amounts and comparison prices (jämförpris).
// A product can carry a package amount (1.5 l, 330 ml, 500 g); combined with
// the per-piece price this yields a comparison price per kg or per liter.

export type AmountUnit = 'g' | 'hg' | 'kg' | 'ml' | 'cl' | 'l' | 'pc';

export const AMOUNT_UNITS: AmountUnit[] = ['g', 'hg', 'kg', 'ml', 'cl', 'l', 'pc'];

const TO_BASE: Record<string, { factor: number; base: 'kg' | 'l' }> = {
  g: { factor: 1 / 1000, base: 'kg' },
  hg: { factor: 1 / 10, base: 'kg' },
  kg: { factor: 1, base: 'kg' },
  ml: { factor: 1 / 1000, base: 'l' },
  cl: { factor: 1 / 100, base: 'l' },
  l: { factor: 1, base: 'l' },
};

export interface ComparisonPrice {
  ore: number; // öre per base unit (kg, l or st)
  per: 'kg' | 'l' | 'st';
}

export type ComparisonBasis = 'unit' | 'package';

/** Comparison price per kg/l from a per-piece price and the package amount. */
export function comparisonPriceOre(
  unitPriceOre: number,
  amountValue: number | null | undefined,
  amountUnit: string | null | undefined
): ComparisonPrice | null {
  if (!amountValue || amountValue <= 0 || !amountUnit) return null;
  const conv = TO_BASE[amountUnit];
  if (!conv) return null;
  return { ore: Math.round(unitPriceOre / (amountValue * conv.factor)), per: conv.base };
}

/**
 * Comparison price (jämförpris) for one price observation, honouring the
 * product's chosen basis:
 *  - weight/volume buys (receipt unit 'kg') are inherently per-kg;
 *  - basis 'unit'  → per kg/l, normalized from a weight/volume package amount
 *    (so a packaged veg and a loose-weight buy line up at e.g. 34,90/kg);
 *  - basis 'package' → per piece (kr/st), dividing a multipack by its count;
 *  - basis null (auto) → per kg/l when the amount is weight/volume, else per st.
 */
export function comparisonForBasis(
  unitPriceOre: number,
  receiptUnit: string, // 'pc' | 'kg' as recorded on the receipt line
  amountValue: number | null | undefined,
  amountUnit: string | null | undefined,
  basis: ComparisonBasis | null | undefined
): ComparisonPrice | null {
  if (receiptUnit === 'kg') return { ore: unitPriceOre, per: 'kg' };

  const isWeightVolume = !!amountUnit && amountUnit !== 'pc' && amountUnit in TO_BASE;
  const effective: ComparisonBasis = basis ?? (isWeightVolume ? 'unit' : 'package');

  if (effective === 'unit') {
    return comparisonPriceOre(unitPriceOre, amountValue, amountUnit);
  }
  // Per package/piece: divide a multipack (amountUnit 'pc') by its count,
  // otherwise the whole package is one piece.
  const count = amountUnit === 'pc' && amountValue && amountValue > 0 ? amountValue : 1;
  return { ore: Math.round(unitPriceOre / count), per: 'st' };
}

/** "1,5 l", "330 ml", "500 g", "6 st" */
export function formatAmount(value: number, unit: string): string {
  const num = value.toLocaleString('sv-SE', { maximumFractionDigits: 3 });
  return unit === 'pc' ? `${num} st` : `${num} ${unit}`;
}

type AmountFields =
  | { ok: true; value: number | null; unit: AmountUnit | null }
  | { ok: false; error: string };

/** Validate amountValue/amountUnit from an API request body. Both or neither. */
export function normalizeAmountFields(amountValue: unknown, amountUnit: unknown): AmountFields {
  const hasValue = amountValue != null && amountValue !== '';
  const hasUnit = amountUnit != null && amountUnit !== '';
  if (!hasValue && !hasUnit) return { ok: true, value: null, unit: null };
  const value = Number(amountValue);
  if (!hasValue || !Number.isFinite(value) || value <= 0) {
    return { ok: false, error: 'Amount must be a positive number' };
  }
  if (!hasUnit || !AMOUNT_UNITS.includes(amountUnit as AmountUnit)) {
    return { ok: false, error: `Amount unit must be one of: ${AMOUNT_UNITS.join(', ')}` };
  }
  return { ok: true, value, unit: amountUnit as AmountUnit };
}

type BasisField =
  | { ok: true; value: ComparisonBasis | null }
  | { ok: false; error: string };

/** Validate a comparisonBasis from an API request body. '' / null = auto. */
export function normalizeComparisonBasis(value: unknown): BasisField {
  if (value == null || value === '') return { ok: true, value: null };
  if (value === 'unit' || value === 'package') return { ok: true, value };
  return { ok: false, error: "Comparison basis must be 'unit' or 'package'" };
}

// "COCA-COLA ZERO 1,5L", "PRINGLES 200G", "PWK 25 CL" → package amount.
// Piece counts ("4 ST") are purchase quantities, not package sizes: ignored.
// The LAST match wins — sizes usually trail the name.
const AMOUNT_RE = /(\d+(?:[.,]\d+)?)\s*(KG|HG|GR?|ML|CL|L)\b/gi;

export function parseAmountFromText(
  text: string
): { value: number; unit: AmountUnit } | null {
  let match: RegExpExecArray | null;
  let last: { value: number; unit: AmountUnit } | null = null;
  AMOUNT_RE.lastIndex = 0;
  while ((match = AMOUNT_RE.exec(text))) {
    const value = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) continue;
    const raw = match[2].toUpperCase();
    const unit = (raw === 'GR' ? 'g' : raw.toLowerCase()) as AmountUnit;
    last = { value, unit };
  }
  return last;
}
