// Shared formatting helpers. Money is stored as integer minor units (cents).

import { coerceCurrency, currencySymbol } from './currency';

// SEK-only formatter kept for the shared price database (products/stats), which
// is not currency-aware. Receipt-scoped displays use formatMoney instead.
export function formatKr(ore: number): string {
  return (ore / 100).toLocaleString('sv-SE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' kr';
}

// Currency-aware formatter for receipt amounts. Swedish number style for
// kr/€ (symbol after), US style for $ (symbol before).
export function formatMoney(minor: number, currency?: string | null): string {
  const cur = coerceCurrency(currency);
  const sym = currencySymbol(cur);
  const locale = cur === 'USD' ? 'en-US' : 'sv-SE';
  const num = (minor / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return cur === 'USD' ? `${sym}${num}` : `${num} ${sym}`;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  uploaded: { label: 'Uploaded', className: 'bg-gray-100 text-gray-600' },
  processing: { label: 'Processing', className: 'bg-blue-50 text-blue-600' },
  pending_review: { label: 'Needs review', className: 'bg-amber-50 text-amber-700' },
  confirmed: { label: 'Confirmed', className: 'bg-green-50 text-green-700' },
  failed: { label: 'Failed', className: 'bg-red-50 text-red-600' },
};

export function statusBadge(status: string) {
  const s = STATUS_STYLES[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.className}`}>
      {s.label}
    </span>
  );
}
