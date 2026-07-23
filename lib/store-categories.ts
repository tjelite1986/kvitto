// Store classification shared by the stores page, receipt review, and the API.
// `value`s are stable slugs stored in the DB; `label`s are shown in the UI.

export const STORE_CHANNELS = [
  { value: 'physical', label: 'In store' },
  { value: 'online', label: 'Online' },
] as const;

export type StoreChannel = (typeof STORE_CHANNELS)[number]['value'];

export const STORE_CATEGORIES = [
  { value: 'groceries', label: 'Groceries' },
  { value: 'restaurant', label: 'Restaurant & takeaway' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'clothing', label: 'Clothing' },
  { value: 'home', label: 'Home & hardware' },
  { value: 'health', label: 'Health & pharmacy' },
  { value: 'transport', label: 'Transport & fuel' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'online-services', label: 'Online services' },
  { value: 'gambling', label: 'Gambling' },
  { value: 'online-games', label: 'Online games' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'other', label: 'Other' },
] as const;

export type StoreCategory = (typeof STORE_CATEGORIES)[number]['value'];

const CHANNEL_LABELS = new Map<string, string>(STORE_CHANNELS.map((c) => [c.value, c.label]));
const CATEGORY_LABELS = new Map<string, string>(STORE_CATEGORIES.map((c) => [c.value, c.label]));

export function channelLabel(value: string | null | undefined): string | null {
  return value ? CHANNEL_LABELS.get(value) ?? null : null;
}

export function categoryLabel(value: string | null | undefined): string | null {
  // Unknown slugs fall back to the raw value so nothing silently disappears.
  return value ? CATEGORY_LABELS.get(value) ?? value : null;
}

export function isStoreChannel(v: unknown): v is StoreChannel {
  return typeof v === 'string' && CHANNEL_LABELS.has(v);
}

export function isStoreCategory(v: unknown): v is StoreCategory {
  return typeof v === 'string' && CATEGORY_LABELS.has(v);
}

/**
 * Coerce an incoming request value to a stored channel: a valid slug, or null
 * to clear it. Undefined means "leave unchanged" — callers must check that
 * before calling this.
 */
export function coerceChannel(v: unknown): StoreChannel | null {
  return isStoreChannel(v) ? v : null;
}

export function coerceCategory(v: unknown): StoreCategory | null {
  return isStoreCategory(v) ? v : null;
}
