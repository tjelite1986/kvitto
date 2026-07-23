import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// All monetary values are stored as INTEGER öre (1 kr = 100 öre) — never floats.

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// Stores and the price database are SHARED across all users.
export const stores = sqliteTable('stores', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  city: text('city'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// Normalized OCR header text used to recognize which store a receipt comes from.
// A store can have several fingerprints (different POS layouts); capped at 5, oldest evicted.
export const storeFingerprints = sqliteTable('store_fingerprints', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  storeId: integer('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  normalizedHeader: text('normalized_header').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => [
  index('store_fingerprints_store_idx').on(t.storeId),
]);

// Per-store learning profile: free-text layout hints plus correction examples
// (JSON array, capped at 8) injected as few-shot context into future parses.
export const storeProfiles = sqliteTable('store_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  storeId: integer('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }).unique(),
  layoutHints: text('layout_hints').notNull().default(''),
  examples: text('examples').notNull().default('[]'),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const receipts = sqliteTable('receipts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  storeId: integer('store_id').references(() => stores.id),
  purchaseDate: text('purchase_date'), // YYYY-MM-DD
  purchaseTime: text('purchase_time'), // HH:MM
  totalOre: integer('total_ore'),
  // Deposit refund (PANTRETUR — returning empties for money back). Stored as a
  // positive öre amount and subtracted from the item sum; never its own item.
  pantReturnOre: integer('pant_return_ore').default(0),
  // Receipt/invoice number as printed. Labelled differently per chain
  // (Kvittonr, Bong, Fakturanr, Invoice/Receipt no) — stored verbatim.
  receiptNumber: text('receipt_number'),
  // Receipt-level charges (home delivery / online grocery): delivery fee
  // (utkörning/leverans/frakt) and service fee (serviceavgift/plockavgift).
  // Positive öre, ADDED to the item sum; never their own item rows.
  deliveryFeeOre: integer('delivery_fee_ore').default(0),
  serviceFeeOre: integer('service_fee_ore').default(0),
  imagePath: text('image_path').notNull(), // directory under data/receipts, relative to data dir
  originalFilename: text('original_filename'), // name of the uploaded file, e.g. "Kvitto-1.pdf"
  imageWidth: integer('image_width'),
  imageHeight: integer('image_height'),
  // JSON: { words: [{ t, x, y, w, h, conf, line }], lines: [{ text, x, y, w, h }], text }
  ocrData: text('ocr_data'),
  claudeRaw: text('claude_raw'),
  status: text('status', {
    enum: ['uploaded', 'processing', 'pending_review', 'confirmed', 'failed'],
  }).notNull().default('uploaded'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  confirmedAt: text('confirmed_at'),
}, (t) => [
  index('receipts_user_idx').on(t.userId, t.createdAt),
  index('receipts_store_date_idx').on(t.storeId, t.purchaseDate),
]);

export const receiptItems = sqliteTable('receipt_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  receiptId: integer('receipt_id').notNull().references(() => receipts.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  rawText: text('raw_text').notNull(), // item text as printed on the receipt
  productId: integer('product_id').references(() => products.id),
  qty: real('qty').notNull().default(1),
  unit: text('unit', { enum: ['pc', 'kg'] }).notNull().default('pc'),
  unitPriceOre: integer('unit_price_ore'),
  lineTotalOre: integer('line_total_ore').notNull(),
  // Multi-buy offer: "2 för 45,00" → offerQty=2, offerTotalOre=4500
  offerQty: integer('offer_qty'),
  offerTotalOre: integer('offer_total_ore'),
  discountOre: integer('discount_ore').notNull().default(0), // positive amount subtracted
  // Deposit surcharge for the whole line (e.g. 4 cans x 100 öre = 400).
  // Pant is an extra per-item charge, never an item of its own.
  pantOre: integer('pant_ore').notNull().default(0),
  isPant: integer('is_pant', { mode: 'boolean' }).notNull().default(false), // legacy rows only
  bbox: text('bbox'), // JSON { x, y, w, h } in display-image pixel space
}, (t) => [
  index('receipt_items_receipt_idx').on(t.receiptId),
  index('receipt_items_product_idx').on(t.productId),
]);

export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(), // canonical name
  brand: text('brand'), // e.g. "Coca-Cola", "Heinz"
  category: text('category'),
  // Package amount, e.g. 1.5 + 'l', 330 + 'ml', 500 + 'g'. Drives the
  // comparison price (jämförpris) per kg/l — see lib/units.ts.
  amountValue: real('amount_value'),
  amountUnit: text('amount_unit', { enum: ['g', 'hg', 'kg', 'ml', 'cl', 'l', 'pc'] }),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

// Maps printed receipt text to a canonical product. storeId NULL = global alias.
// NULL storeIds bypass the unique index in SQLite, so alias upserts must
// select-then-insert instead of relying on ON CONFLICT.
export const productAliases = sqliteTable('product_aliases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  storeId: integer('store_id').references(() => stores.id, { onDelete: 'cascade' }),
  aliasText: text('alias_text').notNull(), // normalized printed text
  confidence: real('confidence').notNull().default(1),
  source: text('source', { enum: ['manual', 'auto'] }).notNull().default('manual'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => [
  uniqueIndex('product_aliases_store_alias_idx').on(t.storeId, t.aliasText),
  index('product_aliases_alias_idx').on(t.aliasText),
]);
