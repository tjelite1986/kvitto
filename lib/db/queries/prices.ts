import { sqlite } from '@/lib/db';

// Price observations are read straight from confirmed receipt items — there is
// no separate prices table to keep in sync. Effective unit price: multi-buy
// total/qty when an offer applies, per-kg price for weight items, otherwise
// line total divided by quantity. Pant rows are excluded.

const OBSERVATIONS_CTE = `
  WITH obs AS (
    SELECT
      ri.product_id,
      r.store_id,
      s.name AS store_name,
      r.purchase_date,
      r.id AS receipt_id,
      ri.qty,
      ri.unit,
      ri.discount_ore,
      CAST(ROUND(CASE
        WHEN ri.offer_qty IS NOT NULL AND ri.offer_total_ore IS NOT NULL AND ri.offer_qty > 0
          THEN ri.offer_total_ore * 1.0 / ri.offer_qty
        WHEN ri.unit = 'kg' AND ri.unit_price_ore IS NOT NULL
          THEN ri.unit_price_ore
        WHEN ri.qty > 0
          THEN ri.line_total_ore * 1.0 / ri.qty
        ELSE ri.line_total_ore
      END) AS INTEGER) AS unit_price_ore,
      ROW_NUMBER() OVER (
        PARTITION BY ri.product_id, r.store_id
        ORDER BY r.purchase_date DESC, r.id DESC
      ) AS rn
    FROM receipt_items ri
    JOIN receipts r ON r.id = ri.receipt_id
    JOIN stores s ON s.id = r.store_id
    WHERE r.status = 'confirmed'
      AND ri.product_id IS NOT NULL
      AND ri.is_pant = 0
      AND r.store_id IS NOT NULL
      AND r.purchase_date IS NOT NULL
  )
`;

export interface StorePrice {
  storeId: number;
  storeName: string;
  unitPriceOre: number;
  previousPriceOre: number | null;
  purchaseDate: string;
}

export interface ProductListEntry {
  id: number;
  name: string;
  category: string | null;
  prices: StorePrice[];
}

/** Products with their latest (and previous) price per store. */
export function productsWithLatestPrice(search?: string): ProductListEntry[] {
  const term = search?.trim();
  const products = (
    term
      ? sqlite
          .prepare(
            `SELECT id, name, category FROM products
             WHERE name LIKE '%' || ? || '%' COLLATE NOCASE ORDER BY name`
          )
          .all(term)
      : sqlite.prepare(`SELECT id, name, category FROM products ORDER BY name`).all()
  ) as Array<{ id: number; name: string; category: string | null }>;

  const priceRows = sqlite
    .prepare(
      `${OBSERVATIONS_CTE}
       SELECT latest.product_id, latest.store_id, latest.store_name,
              latest.unit_price_ore, latest.purchase_date,
              prev.unit_price_ore AS previous_price_ore
       FROM obs latest
       LEFT JOIN obs prev
         ON prev.product_id = latest.product_id
        AND prev.store_id = latest.store_id
        AND prev.rn = 2
       WHERE latest.rn = 1`
    )
    .all() as Array<{
    product_id: number;
    store_id: number;
    store_name: string;
    unit_price_ore: number;
    purchase_date: string;
    previous_price_ore: number | null;
  }>;

  const byProduct = new Map<number, StorePrice[]>();
  for (const row of priceRows) {
    const list = byProduct.get(row.product_id) ?? [];
    list.push({
      storeId: row.store_id,
      storeName: row.store_name,
      unitPriceOre: row.unit_price_ore,
      previousPriceOre: row.previous_price_ore,
      purchaseDate: row.purchase_date,
    });
    byProduct.set(row.product_id, list);
  }

  return products.map((p) => ({ ...p, prices: byProduct.get(p.id) ?? [] }));
}

export interface PriceObservation {
  storeId: number;
  storeName: string;
  purchaseDate: string;
  unitPriceOre: number;
  qty: number;
  unit: string;
  discountOre: number;
  receiptId: number;
}

/** All price observations for one product, oldest first. */
export function priceHistory(productId: number): PriceObservation[] {
  const rows = sqlite
    .prepare(
      `${OBSERVATIONS_CTE}
       SELECT store_id, store_name, purchase_date, unit_price_ore, qty, unit, discount_ore, receipt_id
       FROM obs
       WHERE product_id = ?
       ORDER BY purchase_date ASC, receipt_id ASC`
    )
    .all(productId) as Array<{
    store_id: number;
    store_name: string;
    purchase_date: string;
    unit_price_ore: number;
    qty: number;
    unit: string;
    discount_ore: number;
    receipt_id: number;
  }>;

  return rows.map((r) => ({
    storeId: r.store_id,
    storeName: r.store_name,
    purchaseDate: r.purchase_date,
    unitPriceOre: r.unit_price_ore,
    qty: r.qty,
    unit: r.unit,
    discountOre: r.discount_ore,
    receiptId: r.receipt_id,
  }));
}

export interface PriceChange {
  productId: number;
  productName: string;
  storeName: string;
  fromOre: number;
  toOre: number;
  changePercent: number;
  purchaseDate: string;
}

/** Largest recent price changes (latest vs previous observation per store). */
export function biggestPriceChanges(limit: number): PriceChange[] {
  const rows = sqlite
    .prepare(
      `${OBSERVATIONS_CTE}
       SELECT p.id AS product_id, p.name AS product_name, latest.store_name,
              prev.unit_price_ore AS from_ore, latest.unit_price_ore AS to_ore,
              latest.purchase_date
       FROM obs latest
       JOIN obs prev
         ON prev.product_id = latest.product_id
        AND prev.store_id = latest.store_id
        AND prev.rn = 2
       JOIN products p ON p.id = latest.product_id
       WHERE latest.rn = 1
         AND prev.unit_price_ore > 0
         AND latest.unit_price_ore != prev.unit_price_ore
       ORDER BY ABS(latest.unit_price_ore * 1.0 / prev.unit_price_ore - 1) DESC
       LIMIT ?`
    )
    .all(limit) as Array<{
    product_id: number;
    product_name: string;
    store_name: string;
    from_ore: number;
    to_ore: number;
    purchase_date: string;
  }>;

  return rows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    storeName: r.store_name,
    fromOre: r.from_ore,
    toOre: r.to_ore,
    changePercent: (r.to_ore / r.from_ore - 1) * 100,
    purchaseDate: r.purchase_date,
  }));
}

/** Total confirmed spend (öre) for receipts in a YYYY-MM month, for one user. */
export function monthSpend(userId: number, month: string): number {
  const row = sqlite
    .prepare(
      `SELECT COALESCE(SUM(total_ore), 0) AS total
       FROM receipts
       WHERE user_id = ? AND status = 'confirmed' AND purchase_date LIKE ? || '%'`
    )
    .get(userId, month) as { total: number };
  return row.total;
}
