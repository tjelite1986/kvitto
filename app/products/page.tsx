'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatKr } from '@/lib/format';

interface StorePrice {
  storeId: number;
  storeName: string;
  unitPriceOre: number;
  previousPriceOre: number | null;
  purchaseDate: string;
}

interface ProductEntry {
  id: number;
  name: string;
  category: string | null;
  prices: StorePrice[];
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

  useEffect(() => {
    const timer = setTimeout(() => {
      fetch(`/api/products?q=${encodeURIComponent(search)}`)
        .then((r) => r.json())
        .then((data) => Array.isArray(data) && setProductsList(data))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold">Products</h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-48"
        />
      </div>

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
                    {product.category && (
                      <p className="text-xs text-gray-400">{product.category}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 justify-end shrink-0">
                    {product.prices.map((price) => (
                      <span
                        key={price.storeId}
                        className="inline-flex items-center gap-1 bg-gray-50 border border-gray-200 text-xs px-2 py-0.5 rounded-full"
                        title={`${price.storeName} (${price.purchaseDate})`}
                      >
                        <span className="text-gray-400">{price.storeName}:</span>
                        <span className="font-medium">{formatKr(price.unitPriceOre)}</span>
                        {trendArrow(price)}
                      </span>
                    ))}
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
