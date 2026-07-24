'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ScanDialog from '@/components/dialogs/ScanDialog';
import { formatMoney, statusBadge } from '@/lib/format';
import { channelLabel, STORE_CHANNELS } from '@/lib/store-categories';

interface ReceiptRow {
  id: number;
  storeName: string | null;
  channel: string | null;
  currency: string | null;
  originalFilename: string | null;
  purchaseDate: string | null;
  purchaseTime: string | null;
  totalOre: number | null;
  status: string;
  createdAt: string;
}

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // Client-side channel filter. null = all; NONE = receipts without a channel.
  const [channelFilter, setChannelFilter] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/receipts')
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setReceipts(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function deleteReceipt(e: React.MouseEvent, id: number) {
    e.preventDefault();
    e.stopPropagation();
    if (deletingId != null) return;
    if (!window.confirm('Delete this receipt? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/receipts/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setReceipts((prev) => prev.filter((r) => r.id !== id));
      } else {
        window.alert('Could not delete the receipt.');
      }
    } catch {
      window.alert('Could not delete the receipt.');
    } finally {
      setDeletingId(null);
    }
  }

  // Which channels are present, so the filter only appears when it is useful.
  const NONE = ' none'; // sentinel chip for receipts with no channel
  const presentChannels = STORE_CHANNELS.filter((c) =>
    receipts.some((r) => r.channel === c.value)
  );
  const hasUnspecified = receipts.some((r) => !r.channel);
  const showChannelFilter = presentChannels.length > 0 && receipts.length > 1;
  const filteredReceipts =
    channelFilter == null
      ? receipts
      : channelFilter === NONE
        ? receipts.filter((r) => !r.channel)
        : receipts.filter((r) => r.channel === channelFilter);

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

      {showChannelFilter && (
        <div className="flex flex-wrap gap-2">
          {[
            { key: null as string | null, label: 'All' },
            ...presentChannels.map((c) => ({ key: c.value as string, label: c.label })),
            ...(hasUnspecified ? [{ key: NONE, label: 'No channel' }] : []),
          ].map((chip) => (
            <button
              key={chip.key ?? 'all'}
              onClick={() => setChannelFilter(chip.key)}
              className={`text-xs px-3 py-1 rounded-full border ${
                channelFilter === chip.key
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-green-400'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-lg shadow">
        {loading ? (
          <p className="px-6 py-8 text-sm text-gray-400 text-center">Loading...</p>
        ) : receipts.length === 0 ? (
          <p className="px-6 py-8 text-sm text-gray-400 text-center">
            No receipts yet. Scan your first one!
          </p>
        ) : filteredReceipts.length === 0 ? (
          <p className="px-6 py-8 text-sm text-gray-400 text-center">
            No receipts match this filter.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filteredReceipts.map((r) => (
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
                    <p className="text-sm font-medium truncate">
                      {r.storeName ?? r.originalFilename ?? 'Unknown store'}
                    </p>
                    <p className="text-xs text-gray-400">
                      {r.purchaseDate ?? r.createdAt.slice(0, 10)}
                      {r.purchaseTime && ` kl ${r.purchaseTime}`}
                      {channelLabel(r.channel) && (
                        <span className="ml-2 text-gray-400">· {channelLabel(r.channel)}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {r.totalOre != null && (
                      <span className="text-sm font-medium">{formatMoney(r.totalOre, r.currency)}</span>
                    )}
                    {statusBadge(r.status)}
                    <button
                      onClick={(e) => deleteReceipt(e, r.id)}
                      disabled={deletingId != null}
                      className="text-gray-300 hover:text-red-600 p-1.5 -m-1.5 disabled:opacity-50"
                      title="Delete receipt"
                      aria-label="Delete receipt"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="w-4 h-4"
                      >
                        <path
                          fillRule="evenodd"
                          d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482 41.03 41.03 0 0 0-2.365-.298V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
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
