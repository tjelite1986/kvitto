'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatKr } from '@/lib/format';
import { AMOUNT_UNITS, comparisonPriceOre, formatAmount } from '@/lib/units';

interface StorePrice {
  storeId: number;
  storeName: string;
  unitPriceOre: number;
  unit: string;
  previousPriceOre: number | null;
  purchaseDate: string;
}

interface ProductEntry {
  id: number;
  name: string;
  brand: string | null;
  category: string | null;
  amountValue: number | null;
  amountUnit: string | null;
  prices: StorePrice[];
}

// "19,90 kr/kg" for weight items, "28,52 kr/l" via the package amount, else null
function comparisonLabel(product: ProductEntry, price: StorePrice): string | null {
  if (price.unit === 'kg') return `${formatKr(price.unitPriceOre)}/kg`;
  const cmp = comparisonPriceOre(price.unitPriceOre, product.amountValue, product.amountUnit);
  return cmp ? `${formatKr(cmp.ore)}/${cmp.per}` : null;
}

function trendArrow(price: StorePrice) {
  if (price.previousPriceOre == null || price.previousPriceOre === price.unitPriceOre) {
    return null;
  }
  const up = price.unitPriceOre > price.previousPriceOre;
  return (
    <span className={up ? 'text-red-500' : 'text-green-600'}>{up ? '▲' : '▼'}</span>
  );
}

export default function ProductsPage() {
  const [productsList, setProductsList] = useState<ProductEntry[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [form, setForm] = useState({ name: '', brand: '', category: '', amountValue: '', amountUnit: '' });

  useEffect(() => {
    const timer = setTimeout(() => {
      fetch(`/api/products?q=${encodeURIComponent(search)}`)
        .then((r) => r.json())
        .then((data) => Array.isArray(data) && setProductsList(data))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [search, refresh]);

  async function createProduct() {
    if (!form.name.trim()) return;
    setCreating(true);
    setCreateError('');
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        brand: form.brand.trim() || null,
        category: form.category.trim() || null,
        amountValue: form.amountValue.trim() ? Number(form.amountValue.replace(',', '.')) : null,
        amountUnit: form.amountUnit || null,
      }),
    });
    setCreating(false);
    if (res.ok) {
      setForm({ name: '', brand: '', category: '', amountValue: '', amountUnit: '' });
      setShowCreate(false);
      setRefresh((n) => n + 1);
    } else {
      const data = await res.json().catch(() => ({}));
      setCreateError(data.error || 'Could not create the product.');
    }
  }

  const fieldClass =
    'w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-500';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold">Products</h1>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-40 sm:w-48"
          />
          <button
            onClick={() => { setShowCreate(!showCreate); setCreateError(''); }}
            className="text-sm bg-green-600 text-white px-3 py-1.5 rounded-md hover:bg-green-700 shrink-0"
          >
            + New
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="bg-white rounded-lg shadow p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. PowerKing Energy"
                className={fieldClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Brand</label>
              <input
                value={form.brand}
                onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                placeholder="e.g. PowerKing"
                className={fieldClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
              <input
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="e.g. Dryck"
                className={fieldClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Amount</label>
              <input
                value={form.amountValue}
                onChange={(e) => setForm((f) => ({ ...f, amountValue: e.target.value }))}
                placeholder="e.g. 250"
                inputMode="decimal"
                className={fieldClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Unit</label>
              <select
                value={form.amountUnit}
                onChange={(e) => setForm((f) => ({ ...f, amountUnit: e.target.value }))}
                className={fieldClass}
              >
                <option value="">—</option>
                {AMOUNT_UNITS.map((u) => (
                  <option key={u} value={u}>{u === 'pc' ? 'st' : u}</option>
                ))}
              </select>
            </div>
          </div>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          <div className="flex gap-2">
            <button
              onClick={createProduct}
              disabled={creating || !form.name.trim()}
              className="bg-green-600 text-white text-sm px-4 py-1.5 rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create product'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="text-sm text-gray-500 hover:text-gray-700 px-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow">
        {loading ? (
          <p className="px-6 py-8 text-sm text-gray-400 text-center">Loading...</p>
        ) : productsList.length === 0 ? (
          <p className="px-6 py-8 text-sm text-gray-400 text-center">
            No products yet. Link items to products when reviewing receipts.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {productsList.map((product) => (
              <li key={product.id}>
                <Link
                  href={`/products/${product.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{product.name}</p>
                    {(product.brand || product.amountValue || product.category) && (
                      <p className="text-xs text-gray-400 truncate">
                        {[
                          product.brand,
                          product.amountValue && product.amountUnit
                            ? formatAmount(product.amountValue, product.amountUnit)
                            : null,
                          product.category,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 justify-end shrink-0">
                    {product.prices.map((price) => {
                      const cmp = comparisonLabel(product, price);
                      return (
                        <span
                          key={price.storeId}
                          className="inline-flex items-center gap-1 bg-gray-50 border border-gray-200 text-xs px-2 py-0.5 rounded-full"
                          title={`${price.storeName} (${price.purchaseDate})${cmp ? ` · ${cmp}` : ''}`}
                        >
                          <span className="text-gray-400">{price.storeName}:</span>
                          <span className="font-medium">
                            {formatKr(price.unitPriceOre)}
                            {price.unit === 'kg' ? '/kg' : ''}
                          </span>
                          {cmp && price.unit !== 'kg' && (
                            <span className="text-gray-400">({cmp})</span>
                          )}
                          {trendArrow(price)}
                        </span>
                      );
                    })}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
