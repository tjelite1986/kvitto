// Default seed for the managed product-category list (product_categories table).
// The list is user-extensible at runtime — these are just the starting values,
// seeded once when the table is empty. Names are Swedish grocery-domain DATA
// (like store names), matching what the AI parser suggests and existing data.
export const DEFAULT_PRODUCT_CATEGORIES = [
  'Mejeri',
  'Ost',
  'Dryck',
  'Bröd',
  'Frukt & grönt',
  'Kött & chark',
  'Fisk & skaldjur',
  'Skafferi',
  'Fryst',
  'Fika',
  'Godis & snacks',
  'Hushåll',
  'Städ',
  'Hygien',
  'Tobak',
  'Övrigt',
] as const;
