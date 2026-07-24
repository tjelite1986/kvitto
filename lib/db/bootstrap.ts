import type Database from 'better-sqlite3';
import { DEFAULT_PRODUCT_CATEGORIES } from '../product-categories';

// Idempotent schema bootstrap. Runs at app startup (lib/db/index.ts) so a
// fresh container/volume works without a separate migration step, and from
// lib/db/migrate.ts for manual runs. Future schema changes: add guarded
// ALTER TABLEs below the CREATE block (check PRAGMA table_info first).

// Guarded ALTER: parallel processes (e.g. next build page-data workers) can
// both see the column as missing, so "duplicate column name" is ignored.
function addColumnIfMissing(sqlite: Database.Database, table: string, columnDef: string): void {
  const columnName = columnDef.split(' ')[0];
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === columnName)) return;
  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (e) {
    if (!(e instanceof Error && e.message.includes('duplicate column name'))) throw e;
  }
}

export function bootstrapSchema(sqlite: Database.Database): void {
  sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    city TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS store_fingerprints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    normalized_header TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS store_fingerprints_store_idx ON store_fingerprints(store_id);

  CREATE TABLE IF NOT EXISTS store_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
    layout_hints TEXT NOT NULL DEFAULT '',
    examples TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    brand TEXT,
    category TEXT,
    amount_value REAL,
    amount_unit TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS product_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
    alias_text TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS product_aliases_store_alias_idx ON product_aliases(store_id, alias_text);
  CREATE INDEX IF NOT EXISTS product_aliases_alias_idx ON product_aliases(alias_text);

  CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    store_id INTEGER REFERENCES stores(id),
    purchase_date TEXT,
    purchase_time TEXT,
    total_ore INTEGER,
    image_path TEXT NOT NULL,
    original_filename TEXT,
    image_width INTEGER,
    image_height INTEGER,
    ocr_data TEXT,
    claude_raw TEXT,
    status TEXT NOT NULL DEFAULT 'uploaded',
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS receipts_user_idx ON receipts(user_id, created_at);
  CREATE INDEX IF NOT EXISTS receipts_store_date_idx ON receipts(store_id, purchase_date);

  CREATE TABLE IF NOT EXISTS receipt_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL,
    raw_text TEXT NOT NULL,
    product_id INTEGER REFERENCES products(id),
    qty REAL NOT NULL DEFAULT 1,
    unit TEXT NOT NULL DEFAULT 'pc',
    unit_price_ore INTEGER,
    line_total_ore INTEGER NOT NULL,
    offer_qty INTEGER,
    offer_total_ore INTEGER,
    discount_ore INTEGER NOT NULL DEFAULT 0,
    pant_ore INTEGER NOT NULL DEFAULT 0,
    is_pant INTEGER NOT NULL DEFAULT 0,
    bbox TEXT
  );
  CREATE INDEX IF NOT EXISTS receipt_items_receipt_idx ON receipt_items(receipt_id);
  CREATE INDEX IF NOT EXISTS receipt_items_product_idx ON receipt_items(product_id);

  CREATE TABLE IF NOT EXISTS product_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS store_keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS store_keywords_store_keyword_idx ON store_keywords(store_id, keyword);
  CREATE INDEX IF NOT EXISTS store_keywords_keyword_idx ON store_keywords(keyword);

  CREATE TABLE IF NOT EXISTS manual_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    unit TEXT NOT NULL DEFAULT 'pc',
    unit_price_ore INTEGER NOT NULL,
    purchase_date TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS manual_prices_product_idx ON manual_prices(product_id);
  `);

  // v2: pant became a per-line surcharge (pant_ore) instead of separate rows
  addColumnIfMissing(sqlite, 'receipt_items', 'pant_ore INTEGER NOT NULL DEFAULT 0');

  // v3: purchase time of day
  addColumnIfMissing(sqlite, 'receipts', 'purchase_time TEXT');

  // v4: product brand + package amount (comparison price)
  addColumnIfMissing(sqlite, 'products', 'brand TEXT');
  addColumnIfMissing(sqlite, 'products', 'amount_value REAL');
  addColumnIfMissing(sqlite, 'products', 'amount_unit TEXT');

  // v11: comparison-price basis — per unit (kg/l) vs per package (st)
  addColumnIfMissing(sqlite, 'products', 'comparison_basis TEXT');

  // v12: per-receipt purchase channel (physical/online) — a store can be both
  addColumnIfMissing(sqlite, 'receipts', 'channel TEXT');

  // v13: per-receipt currency (SEK/EUR/USD); existing rows default to SEK
  addColumnIfMissing(sqlite, 'receipts', "currency TEXT NOT NULL DEFAULT 'SEK'");

  // v14: manual prices carry a currency too (matches the receipt currency)
  addColumnIfMissing(sqlite, 'manual_prices', "currency TEXT NOT NULL DEFAULT 'SEK'");

  // v5: original name of the uploaded file (e.g. "Kvitto-1.pdf")
  addColumnIfMissing(sqlite, 'receipts', 'original_filename TEXT');

  // v6: deposit refund (PANTRETUR) as a receipt-level credit, öre
  addColumnIfMissing(sqlite, 'receipts', 'pant_return_ore INTEGER DEFAULT 0');

  // v7: receipt/invoice number as printed (Kvittonr, Bong, Fakturanr, ...)
  addColumnIfMissing(sqlite, 'receipts', 'receipt_number TEXT');

  // v8: receipt-level charges — delivery fee + service fee (added to total)
  addColumnIfMissing(sqlite, 'receipts', 'delivery_fee_ore INTEGER DEFAULT 0');
  addColumnIfMissing(sqlite, 'receipts', 'service_fee_ore INTEGER DEFAULT 0');

  // v9: store classification — channel (physical/online) + category slug
  addColumnIfMissing(sqlite, 'stores', 'channel TEXT');
  addColumnIfMissing(sqlite, 'stores', 'category TEXT');

  // v10: seed the managed product-category list once, only when empty (the
  // list is user-extensible afterwards, so never re-seed / overwrite edits).
  const catCount = (
    sqlite.prepare('SELECT COUNT(*) AS n FROM product_categories').get() as { n: number }
  ).n;
  if (catCount === 0) {
    const insert = sqlite.prepare(
      'INSERT OR IGNORE INTO product_categories (name, sort_order) VALUES (?, ?)'
    );
    DEFAULT_PRODUCT_CATEGORIES.forEach((name, i) => insert.run(name, i));
  }
}
