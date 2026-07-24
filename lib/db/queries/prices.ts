import { sqlite } from '@/lib/db';

// Price observations are read straight from confirmed receipt items — there is
// no separate prices table to keep in sync. Effective unit price: multi-buy
// total/qty when an offer applies, per-kg price for weight items, otherwise
// line total divided by quantity. Pant rows are excluded.

// Price observations come from two sources, unioned before the ROW_NUMBER so
// "latest per store" ranks across both: confirmed receipt items and
// hand-entered manual_prices. Manual rows have receipt_id NULL and carry their
// own manual_price_id so the UI can offer to delete them.
const OBSERVATIONS_CTE = `
  WITH raw AS (
    SELECT
      ri.product_id,
      r.store_id,
      s.name AS store_name,
      r.purchase_date,
      r.currency,
      r.id AS receipt_id,
      NULL AS manual_price_id,
      ri.qty,
      ri.unit,
      ri.discount_ore,
      ri.pant_ore,
      ri.offer_qty,
      ri.offer_total_ore,
      CAST(ROUND(CASE
        WHEN ri.offer_qty IS NOT NULL AND ri.offer_total_ore IS NOT NULL AND ri.offer_qty > 0
          THEN ri.offer_total_ore * 1.0 / ri.offer_qty
        WHEN ri.unit = 'kg' AND ri.unit_price_ore IS NOT NULL
          THEN ri.unit_price_ore
        WHEN ri.qty > 0
          THEN ri.line_total_ore * 1.0 / ri.qty
        ELSE ri.line_total_ore
      END) AS INTEGER) AS unit_price_ore
    FROM receipt_items ri
    JOIN receipts r ON r.id = ri.receipt_id
    JOIN stores s ON s.id = r.store_id
    WHERE r.status = 'confirmed'
      AND ri.product_id IS NOT NULL
      AND ri.is_pant = 0
      AND r.store_id IS NOT NULL
      AND r.purchase_date IS NOT NULL
    UNION ALL
    SELECT
      mp.product_id,
      mp.store_id,
      s.name AS store_name,
      mp.purchase_date,
      mp.currency,
      NULL AS receipt_id,
      mp.id AS manual_price_id,
      1 AS qty,
      mp.unit,
      0 AS discount_ore,
      0 AS pant_ore,
      NULL AS offer_qty,
      NULL AS offer_total_ore,
      mp.unit_price_ore
    FROM manual_prices mp
    JOIN stores s ON s.id = mp.store_id
  ),
  obs AS (
    SELECT raw.*,
      ROW_NUMBER() OVER (
        PARTITION BY product_id, store_id, currency
        ORDER BY purchase_date DESC, receipt_id DESC, manual_price_id DESC
      ) AS rn
    FROM raw
  )
`;

export interface StorePrice {
  storeId: number;
  storeName: string;
  unitPriceOre: number;
  unit: string; // 'kg' observations are already a per-kg price
  currency: string; // currency of this observation (SEK/EUR/USD)
  previousPriceOre: number | null;
  purchaseDate: string;
}

export interface ProductListEntry {
  id: number;
  name: string;
  brand: string | null;
  category: string | null;
  amountValue: number | null;
  amountUnit: string | null;
  comparisonBasis: string | null;
  prices: StorePrice[];
}

/** Products with their latest (and previous) price per store. */
export function productsWithLatestPrice(search?: string): ProductListEntry[] {
  const term = search?.trim();
  const productSelect = `SELECT id, name, brand, category,
      amount_value AS amountValue, amount_unit AS amountUnit,
      comparison_basis AS comparisonBasis FROM products`;
  const products = (
    term
      ? sqlite
          .prepare(
            `${productSelect}
             WHERE (name LIKE '%' || ? || '%' COLLATE NOCASE
                OR brand LIKE '%' || ? || '%' COLLATE NOCASE
                OR category LIKE '%' || ? || '%' COLLATE NOCASE)
             ORDER BY name`
          )
          .all(term, term, term)
      : sqlite.prepare(`${productSelect} ORDER BY name`).all()
  ) as Array<{
    id: number;
    name: string;
    brand: string | null;
    category: string | null;
    amountValue: number | null;
    amountUnit: string | null;
    comparisonBasis: string | null;
  }>;

  const priceRows = sqlite
    .prepare(
      `${OBSERVATIONS_CTE}
       SELECT latest.product_id, latest.store_id, latest.store_name,
              latest.unit_price_ore, latest.unit, latest.currency, latest.purchase_date,
              prev.unit_price_ore AS previous_price_ore
       FROM obs latest
       LEFT JOIN obs prev
         ON prev.product_id = latest.product_id
        AND prev.store_id = latest.store_id
        AND prev.currency = latest.currency
        AND prev.rn = 2
       WHERE latest.rn = 1`
    )
    .all() as Array<{
    product_id: number;
    store_id: number;
    store_name: string;
    unit_price_ore: number;
    unit: string;
    currency: string;
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
      unit: row.unit,
      currency: row.currency,
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
  currency: string; // currency of this observation (SEK/EUR/USD)
  discountOre: number;
  pantOre: number; // deposit for the whole line — divide by qty for per-can pant
  offerQty: number | null; // multi-buy applied, e.g. 4 for 24.00
  offerTotalOre: number | null;
  receiptId: number | null; // null for a hand-entered manual price
  manualPriceId: number | null; // set only for manual prices (so they can be deleted)
}

/** All price observations for one product, oldest first. */
export function priceHistory(productId: number): PriceObservation[] {
  const rows = sqlite
    .prepare(
      `${OBSERVATIONS_CTE}
       SELECT store_id, store_name, purchase_date, unit_price_ore, qty, unit,
              currency, discount_ore, pant_ore, offer_qty, offer_total_ore,
              receipt_id, manual_price_id
       FROM obs
       WHERE product_id = ?
       ORDER BY purchase_date ASC, receipt_id ASC, manual_price_id ASC`
    )
    .all(productId) as Array<{
    store_id: number;
    store_name: string;
    purchase_date: string;
    unit_price_ore: number;
    qty: number;
    unit: string;
    currency: string;
    discount_ore: number;
    pant_ore: number;
    offer_qty: number | null;
    offer_total_ore: number | null;
    receipt_id: number | null;
    manual_price_id: number | null;
  }>;

  return rows.map((r) => ({
    storeId: r.store_id,
    storeName: r.store_name,
    purchaseDate: r.purchase_date,
    unitPriceOre: r.unit_price_ore,
    qty: r.qty,
    unit: r.unit,
    currency: r.currency,
    discountOre: r.discount_ore,
    pantOre: r.pant_ore,
    offerQty: r.offer_qty,
    offerTotalOre: r.offer_total_ore,
    receiptId: r.receipt_id,
    manualPriceId: r.manual_price_id,
  }));
}

export interface PriceChange {
  productId: number;
  productName: string;
  storeName: string;
  fromOre: number;
  toOre: number;
  currency: string;
  changePercent: number;
  purchaseDate: string;
}

/** Largest recent price changes (latest vs previous observation per store &
 * currency — prices in different currencies are never compared). */
export function biggestPriceChanges(limit: number): PriceChange[] {
  const rows = sqlite
    .prepare(
      `${OBSERVATIONS_CTE}
       SELECT p.id AS product_id, p.name AS product_name, latest.store_name,
              prev.unit_price_ore AS from_ore, latest.unit_price_ore AS to_ore,
              latest.currency, latest.purchase_date
       FROM obs latest
       JOIN obs prev
         ON prev.product_id = latest.product_id
        AND prev.store_id = latest.store_id
        AND prev.currency = latest.currency
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
    currency: string;
    purchase_date: string;
  }>;

  return rows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    storeName: r.store_name,
    fromOre: r.from_ore,
    toOre: r.to_ore,
    currency: r.currency,
    changePercent: (r.to_ore / r.from_ore - 1) * 100,
    purchaseDate: r.purchase_date,
  }));
}

export interface CurrencySpend {
  currency: string;
  totalOre: number;
}

/** Confirmed spend for a YYYY-MM month, split per currency (never summed
 * across currencies). Ordered by amount, largest first. */
export function monthSpend(userId: number, month: string): CurrencySpend[] {
  const rows = sqlite
    .prepare(
      `SELECT currency, COALESCE(SUM(total_ore), 0) AS total
       FROM receipts
       WHERE user_id = ? AND status = 'confirmed'
         AND purchase_date LIKE ? || '%' AND total_ore IS NOT NULL
       GROUP BY currency
       ORDER BY total DESC`
    )
    .all(userId, month) as Array<{ currency: string; total: number }>;
  return rows.map((r) => ({ currency: r.currency ?? 'SEK', totalOre: r.total }));
}
