'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import PriceHistoryChart, { type PriceSeries } from '@/components/charts/PriceHistoryChart';
import { formatKr } from '@/lib/format';

interface Observation {
  storeId: number;
  storeName: string;
  purchaseDate: string;
  unitPriceOre: number;
  qty: number;
  unit: string;
  discountOre: number;
  receiptId: number;
}

interface ProductDetail {
  id: number;
  name: string;
  category: string | null;
  history: Observation[];
  stats: { minOre: number; maxOre: number; avgOre: number } | null;
}

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [storeFilter, setStoreFilter] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/products/${params.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setProduct)
      .catch(() => setError('Could not load the product.'));
  }, [params.id]);

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
      <div>
        <Link href="/products" className="text-sm text-green-600 hover:underline">
          &larr; Products
        </Link>
        <h1 className="text-xl font-bold mt-1">{product.name}</h1>
        {product.category && <p className="text-sm text-gray-400">{product.category}</p>}
      </div>

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
