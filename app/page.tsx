'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ScanDialog from '@/components/dialogs/ScanDialog';
import { formatMoney, statusBadge } from '@/lib/format';

interface ReceiptRow {
  id: number;
  storeName: string | null;
  currency: string | null;
  purchaseDate: string | null;
  purchaseTime: string | null;
  totalOre: number | null;
  status: string;
  createdAt: string;
}

interface Stats {
  month: string;
  monthSpend: Array<{ currency: string; totalOre: number }>;
  priceChanges: Array<{
    productId: number;
    productName: string;
    storeName: string;
    fromOre: number;
    toOre: number;
    currency: string;
    changePercent: number;
  }>;
}

export default function HomePage() {
  const [scanOpen, setScanOpen] = useState(false);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch('/api/receipts')
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setReceipts(data))
      .catch(() => {});
    fetch('/api/stats')
      .then((r) => r.json())
      .then((data) => data && !data.error && setStats(data))
      .catch(() => {});
  }, []);

  const recent = receipts.slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6 text-center">
        <h1 className="text-xl font-bold mb-1">Kvitto</h1>
        <p className="text-sm text-gray-500 mb-4">
          Scan a receipt and track prices over time
        </p>
        <button
          onClick={() => setScanOpen(true)}
          className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 font-medium inline-flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Scan receipt
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-lg shadow px-5 py-4">
            <p className="text-xs text-gray-400">Spent in {stats.month}</p>
            {stats.monthSpend.length === 0 ? (
              <p className="text-2xl font-bold">{formatMoney(0, 'SEK')}</p>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                {stats.monthSpend.map((s) => (
                  <p key={s.currency} className="text-2xl font-bold">
                    {formatMoney(s.totalOre, s.currency)}
                  </p>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white rounded-lg shadow px-5 py-4">
            <p className="text-xs text-gray-400 mb-1.5">Biggest price changes</p>
            {stats.priceChanges.length === 0 ? (
              <p className="text-sm text-gray-400">
                Shows up when a product has two prices from the same store.
              </p>
            ) : (
              <ul className="space-y-1">
                {stats.priceChanges.map((change) => (
                  <li key={`${change.productId}-${change.storeName}`} className="flex items-center justify-between text-sm">
                    <Link href={`/products/${change.productId}`} className="truncate hover:underline">
                      {change.productName}
                      <span className="text-gray-400 text-xs ml-1">({change.storeName})</span>
                    </Link>
                    <span className={`font-medium shrink-0 ml-2 ${change.changePercent > 0 ? 'text-red-500' : 'text-green-600'}`}>
                      {change.changePercent > 0 ? '▲' : '▼'} {Math.abs(change.changePercent).toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold">Recent receipts</h2>
          <Link href="/receipts" className="text-sm text-green-600 hover:underline">
            View all
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="px-6 py-8 text-sm text-gray-400 text-center">
            No receipts yet. Scan your first one!
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recent.map((r) => (
              <li key={r.id}>
                <Link
                  href={r.status === 'confirmed' ? `/receipts/${r.id}` : `/receipts/${r.id}/review`}
                  className="flex items-center justify-between px-6 py-3 hover:bg-gray-50"
                >
                  <div>
                    <p className="text-sm font-medium">{r.storeName ?? 'Unknown store'}</p>
                    <p className="text-xs text-gray-400">
                      {r.purchaseDate ?? r.createdAt.slice(0, 10)}
                      {r.purchaseTime && ` kl ${r.purchaseTime}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {r.totalOre != null && (
                      <span className="text-sm font-medium">{formatMoney(r.totalOre, r.currency)}</span>
                    )}
                    {statusBadge(r.status)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ScanDialog open={scanOpen} onClose={() => setScanOpen(false)} />
    </div>
  );
}
