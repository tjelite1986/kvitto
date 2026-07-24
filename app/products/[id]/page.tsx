'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import PriceHistoryChart, { type PriceSeries } from '@/components/charts/PriceHistoryChart';
import { formatKr } from '@/lib/format';
import { AMOUNT_UNITS, comparisonForBasis, formatAmount } from '@/lib/units';
import ProductCategorySelect from '@/components/ProductCategorySelect';

interface Observation {
  storeId: number;
  storeName: string;
  purchaseDate: string;
  unitPriceOre: number;
  qty: number;
  unit: string;
  discountOre: number;
  pantOre: number;
  offerQty: number | null;
  offerTotalOre: number | null;
  receiptId: number;
}

interface ProductAlias {
  id: number;
  aliasText: string;
  storeId: number | null;
  storeName: string | null;
  source: string;
}

interface StoreOption {
  id: number;
  name: string;
}

interface ProductDetail {
  id: number;
  name: string;
  brand: string | null;
  category: string | null;
  amountValue: number | null;
  amountUnit: string | null;
  comparisonBasis: string | null;
  history: Observation[];
  stats: { minOre: number; maxOre: number; avgOre: number } | null;
}

// "39,90 kr/kg" for weight buys, package-amount comparison for piece buys,
// honouring the product's comparison basis (per kg/l vs per piece).
function comparisonLabel(product: ProductDetail, obs: Observation): string | null {
  const cmp = comparisonForBasis(
    obs.unitPriceOre,
    obs.unit,
    product.amountValue,
    product.amountUnit,
    product.comparisonBasis as 'unit' | 'package' | null
  );
  return cmp ? `${formatKr(cmp.ore)}/${cmp.per}` : null;
}

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [storeFilter, setStoreFilter] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [form, setForm] = useState({ name: '', brand: '', category: '', amountValue: '', amountUnit: '', comparisonBasis: '' });
  const [aliases, setAliases] = useState<ProductAlias[]>([]);
  const [storeOptions, setStoreOptions] = useState<StoreOption[]>([]);
  const [aliasText, setAliasText] = useState('');
  const [aliasStoreId, setAliasStoreId] = useState('');
  const [aliasError, setAliasError] = useState('');
  const [addingAlias, setAddingAlias] = useState(false);

  useEffect(() => {
    fetch(`/api/products/${params.id}/aliases`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => Array.isArray(data) && setAliases(data))
      .catch(() => {});
    fetch('/api/stores')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => Array.isArray(data) && setStoreOptions(data.map((s) => ({ id: s.id, name: s.name }))))
      .catch(() => {});
  }, [params.id]);

  async function addAlias() {
    if (!aliasText.trim()) return;
    setAddingAlias(true);
    setAliasError('');
    const res = await fetch(`/api/products/${params.id}/aliases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aliasText: aliasText.trim(),
        storeId: aliasStoreId ? Number(aliasStoreId) : null,
      }),
    });
    setAddingAlias(false);
    if (res.ok) {
      setAliasText('');
      const list = await fetch(`/api/products/${params.id}/aliases`).then((r) => r.json());
      if (Array.isArray(list)) setAliases(list);
    } else {
      const data = await res.json().catch(() => ({}));
      setAliasError(data.error || 'Could not add the alias.');
    }
  }

  async function deleteAlias(aliasId: number) {
    const res = await fetch(`/api/products/${params.id}/aliases?aliasId=${aliasId}`, {
      method: 'DELETE',
    });
    if (res.ok) setAliases((prev) => prev.filter((a) => a.id !== aliasId));
  }

  function startEdit() {
    if (!product) return;
    setForm({
      name: product.name,
      brand: product.brand ?? '',
      category: product.category ?? '',
      amountValue: product.amountValue != null ? String(product.amountValue) : '',
      amountUnit: product.amountUnit ?? '',
      comparisonBasis: product.comparisonBasis ?? '',
    });
    setEditError('');
    setEditing(true);
  }

  async function saveEdit() {
    setSaving(true);
    setEditError('');
    const res = await fetch(`/api/products/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        brand: form.brand.trim() || null,
        category: form.category.trim() || null,
        amountValue: form.amountValue.trim() ? Number(form.amountValue.replace(',', '.')) : null,
        amountUnit: form.amountUnit || null,
        comparisonBasis: form.comparisonBasis || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const updated = await res.json();
      setProduct((prev) => (prev ? { ...prev, ...updated } : prev));
      setEditing(false);
    } else {
      const data = await res.json().catch(() => ({}));
      setEditError(data.error || 'Could not save.');
    }
  }

  useEffect(() => {
    fetch(`/api/products/${params.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setProduct)
      .catch(() => setError('Could not load the product.'));
  }, [params.id]);

  async function deleteProduct() {
    setDeleting(true);
    const res = await fetch(`/api/products/${params.id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/products');
    } else {
      setDeleting(false);
      setConfirmDelete(false);
      setError('Could not delete the product.');
    }
  }

  const storeNames = useMemo(() => {
    if (!product) return [];
    const map = new Map<number, string>();
    product.history.forEach((o) => map.set(o.storeId, o.storeName));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [product]);

  const series: PriceSeries[] = useMemo(() => {
    if (!product) return [];
    const byStore = new Map<number, { label: string; points: { date: string; valueOre: number }[] }>();
    for (const obs of product.history) {
      if (storeFilter != null && obs.storeId !== storeFilter) continue;
      let s = byStore.get(obs.storeId);
      if (!s) {
        s = { label: obs.storeName, points: [] };
        byStore.set(obs.storeId, s);
      }
      s.points.push({ date: obs.purchaseDate, valueOre: obs.unitPriceOre });
    }
    return Array.from(byStore.values());
  }, [product, storeFilter]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!product) return <p className="text-sm text-gray-400">Loading...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/products" className="text-sm text-green-600 hover:underline">
            &larr; Products
          </Link>
          <h1 className="text-xl font-bold mt-1">{product.name}</h1>
          {(product.brand || product.amountValue || product.category) && (
            <p className="text-sm text-gray-400">
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
        {!editing && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={startEdit}
              className="text-sm bg-gray-100 text-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-200"
            >
              Edit
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-sm bg-gray-100 text-red-600 px-3 py-1.5 rounded-md hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {confirmDelete && (
        <div className="bg-white rounded-lg shadow p-4 space-y-3 border border-red-200">
          <p className="text-sm text-gray-700">
            Delete <span className="font-medium">{product.name}</span>? Its receipt-name
            aliases and price history are removed. The receipts themselves stay, but
            their items lose the link to this product. This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={deleteProduct}
              disabled={deleting}
              className="bg-red-600 text-white text-sm px-4 py-1.5 rounded-md hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Delete product'}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-sm text-gray-500 hover:text-gray-700 px-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className="bg-white rounded-lg shadow p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Brand</label>
              <input
                value={form.brand}
                onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                placeholder="e.g. Coca-Cola"
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
              <ProductCategorySelect
                value={form.category}
                onChange={(category) => setForm((f) => ({ ...f, category }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Amount</label>
              <input
                value={form.amountValue}
                onChange={(e) => setForm((f) => ({ ...f, amountValue: e.target.value }))}
                placeholder="e.g. 1.5"
                inputMode="decimal"
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Unit</label>
              <select
                value={form.amountUnit}
                onChange={(e) => setForm((f) => ({ ...f, amountUnit: e.target.value }))}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
              >
                <option value="">—</option>
                {AMOUNT_UNITS.map((u) => (
                  <option key={u} value={u}>{u === 'pc' ? 'st' : u}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Compare by</label>
              <select
                value={form.comparisonBasis}
                onChange={(e) => setForm((f) => ({ ...f, comparisonBasis: e.target.value }))}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
              >
                <option value="">Auto</option>
                <option value="unit">Per kg/l</option>
                <option value="package">Per piece (st)</option>
              </select>
            </div>
          </div>
          {editError && <p className="text-sm text-red-600">{editError}</p>}
          <div className="flex gap-2">
            <button
              onClick={saveEdit}
              disabled={saving || !form.name.trim()}
              className="bg-green-600 text-white text-sm px-4 py-1.5 rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-sm text-gray-500 hover:text-gray-700 px-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {product.stats && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Lowest', value: product.stats.minOre },
            { label: 'Average', value: product.stats.avgOre },
            { label: 'Highest', value: product.stats.maxOre },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-lg shadow px-4 py-3 text-center">
              <p className="text-xs text-gray-400">{stat.label}</p>
              <p className="text-lg font-semibold">{formatKr(stat.value)}</p>
            </div>
          ))}
        </div>
      )}

      {storeNames.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setStoreFilter(null)}
            className={`text-xs px-3 py-1 rounded-full border ${
              storeFilter == null
                ? 'bg-green-600 text-white border-green-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-green-400'
            }`}
          >
            All stores
          </button>
          {storeNames.map((store) => (
            <button
              key={store.id}
              onClick={() => setStoreFilter(storeFilter === store.id ? null : store.id)}
              className={`text-xs px-3 py-1 rounded-full border ${
                storeFilter === store.id
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-green-400'
              }`}
            >
              {store.name}
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="font-semibold text-sm mb-3">Price history</h2>
        <PriceHistoryChart series={series} />
      </div>

      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <div>
          <h2 className="font-semibold text-sm">Receipt names</h2>
          <p className="text-xs text-gray-400">
            How this product is printed on receipts. Different stores print different
            names — add them here so scans link automatically.
          </p>
        </div>
        {aliases.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {aliases.map((alias) => (
              <span
                key={alias.id}
                className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-200 text-xs px-2 py-1 rounded-full"
                title={alias.source === 'auto' ? 'Learned from a confirmed receipt' : 'Added manually'}
              >
                <span className="font-medium uppercase">{alias.aliasText}</span>
                <span className="text-gray-400">{alias.storeName ?? 'all stores'}</span>
                <button
                  onClick={() => deleteAlias(alias.id)}
                  className="text-gray-300 hover:text-red-500"
                  aria-label="Delete alias"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            value={aliasText}
            onChange={(e) => setAliasText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addAlias()}
            placeholder="e.g. ENERGY DRINK 250ML"
            className="flex-1 min-w-40 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
          />
          <select
            value={aliasStoreId}
            onChange={(e) => setAliasStoreId(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
          >
            <option value="">All stores</option>
            {storeOptions.map((store) => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
          <button
            onClick={addAlias}
            disabled={addingAlias || !aliasText.trim()}
            className="bg-green-600 text-white text-sm px-3 py-1 rounded hover:bg-green-700 disabled:opacity-50"
          >
            {addingAlias ? 'Adding...' : 'Add'}
          </button>
        </div>
        {aliasError && <p className="text-xs text-red-600">{aliasError}</p>}
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <h2 className="font-semibold text-sm px-4 py-3 border-b border-gray-100">Purchases</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Store</th>
                <th className="px-4 py-2 font-medium text-right">Qty</th>
                <th className="px-4 py-2 font-medium text-right">Unit price</th>
                <th className="px-4 py-2 font-medium text-right">Comparison</th>
                <th className="px-4 py-2 font-medium text-right">Offer</th>
                <th className="px-4 py-2 font-medium text-right">Pant</th>
                <th className="px-4 py-2 font-medium text-right">Discount</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[...product.history].reverse().map((obs, i) => (
                <tr key={i}>
                  <td className="px-4 py-2">{obs.purchaseDate}</td>
                  <td className="px-4 py-2">{obs.storeName}</td>
                  <td className="px-4 py-2 text-right">
                    {obs.qty} {obs.unit === 'kg' ? 'kg' : 'pc'}
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    {formatKr(obs.unitPriceOre)}
                    {obs.unit === 'kg' ? '/kg' : ''}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-400">
                    {comparisonLabel(product, obs) ?? ''}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-400 whitespace-nowrap">
                    {obs.offerQty && obs.offerTotalOre != null
                      ? `${obs.offerQty} for ${formatKr(obs.offerTotalOre)}`
                      : ''}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-400 whitespace-nowrap">
                    {obs.pantOre > 0 && obs.qty > 0
                      ? `${formatKr(Math.round(obs.pantOre / obs.qty))}/st`
                      : ''}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-400">
                    {obs.discountOre > 0 ? `-${formatKr(obs.discountOre)}` : ''}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/receipts/${obs.receiptId}`}
                      className="text-xs text-green-600 hover:underline"
                    >
                      Receipt
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
