// Package amounts and comparison prices (jämförpris).
// A product can carry a package amount (1.5 l, 330 ml, 500 g); combined with
// the per-piece price this yields a comparison price per kg or per liter.

export type AmountUnit = 'g' | 'kg' | 'ml' | 'cl' | 'l' | 'pc';

export const AMOUNT_UNITS: AmountUnit[] = ['g', 'kg', 'ml', 'cl', 'l', 'pc'];

const TO_BASE: Record<string, { factor: number; base: 'kg' | 'l' }> = {
  g: { factor: 1 / 1000, base: 'kg' },
  kg: { factor: 1, base: 'kg' },
  ml: { factor: 1 / 1000, base: 'l' },
  cl: { factor: 1 / 100, base: 'l' },
  l: { factor: 1, base: 'l' },
};

export interface ComparisonPrice {
  ore: number; // öre per base unit (kg or l)
  per: 'kg' | 'l';
}

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

// "COCA-COLA ZERO 1,5L", "PRINGLES 200G", "PWK 25 CL" → package amount.
// Piece counts ("4 ST") are purchase quantities, not package sizes: ignored.
// The LAST match wins — sizes usually trail the name.
const AMOUNT_RE = /(\d+(?:[.,]\d+)?)\s*(KG|GR?|ML|CL|L)\b/gi;

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
