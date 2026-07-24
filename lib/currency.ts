// Receipt currency. Amounts are stored as integer minor units (cents) of the
// receipt's currency — "öre" for SEK, euro/dollar cents for EUR/USD.

export const CURRENCIES = [
  { value: 'SEK', label: 'kr (SEK)', symbol: 'kr' },
  { value: 'EUR', label: '€ (EUR)', symbol: '€' },
  { value: 'USD', label: '$ (USD)', symbol: '$' },
] as const;

export type Currency = (typeof CURRENCIES)[number]['value'];

const SYMBOLS: Record<Currency, string> = { SEK: 'kr', EUR: '€', USD: '$' };

export function isCurrency(v: unknown): v is Currency {
  return v === 'SEK' || v === 'EUR' || v === 'USD';
}

/** Coerce an incoming value to a known currency, defaulting to SEK. */
export function coerceCurrency(v: unknown, fallback: Currency = 'SEK'): Currency {
  return isCurrency(v) ? v : fallback;
}

export function currencySymbol(v: unknown): string {
  return SYMBOLS[coerceCurrency(v)];
}
