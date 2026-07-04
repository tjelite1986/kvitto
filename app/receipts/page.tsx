'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ScanDialog from '@/components/dialogs/ScanDialog';
import { formatKr, statusBadge } from '@/lib/format';

interface ReceiptRow {
  id: number;
  storeName: string | null;
  purchaseDate: string | null;
  totalOre: number | null;
  status: string;
  createdAt: string;
}

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    fetch('/api/receipts')
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setReceipts(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Receipts</h1>
        <button
          onClick={() => setScanOpen(true)}
          className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 text-sm font-medium"
        >
          Scan receipt
        </button>
      </div>

      <div className="bg-white rounded-lg shadow">
        {loading ? (
          <p className="px-6 py-8 text-sm text-gray-400 text-center">Loading...</p>
        ) : receipts.length === 0 ? (
          <p className="px-6 py-8 text-sm text-gray-400 text-center">
            No receipts yet. Scan your first one!
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {receipts.map((r) => (
              <li key={r.id}>
                <Link
                  href={r.status === 'confirmed' ? `/receipts/${r.id}` : `/receipts/${r.id}/review`}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/receipts/${r.id}/image`}
                    alt=""
                    className="w-12 h-16 object-cover rounded border border-gray-200 bg-gray-50"
                    loading="lazy"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{r.storeName ?? 'Unknown store'}</p>
                    <p className="text-xs text-gray-400">
                      {r.purchaseDate ?? r.createdAt.slice(0, 10)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {r.totalOre != null && (
                      <span className="text-sm font-medium">{formatKr(r.totalOre)}</span>
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
