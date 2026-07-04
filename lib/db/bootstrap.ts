import type Database from 'better-sqlite3';

// Idempotent schema bootstrap. Runs at app startup (lib/db/index.ts) so a
// fresh container/volume works without a separate migration step, and from
// lib/db/migrate.ts for manual runs. Future schema changes: add guarded
// ALTER TABLEs below the CREATE block (check PRAGMA table_info first).

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
    category TEXT,
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
    total_ore INTEGER,
    image_path TEXT NOT NULL,
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
    is_pant INTEGER NOT NULL DEFAULT 0,
    bbox TEXT
  );
  CREATE INDEX IF NOT EXISTS receipt_items_receipt_idx ON receipt_items(receipt_id);
  CREATE INDEX IF NOT EXISTS receipt_items_product_idx ON receipt_items(product_id);
  `);
}
