'use client';

// Read-only receipt detail with item highlights on the image.

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatKr, statusBadge } from '@/lib/format';
import { channelLabel } from '@/lib/store-categories';
import ReceiptImageViewer from '@/components/review/ReceiptImageViewer';
import { ITEM_COLORS } from '@/components/review/ReceiptImageViewer';

interface ItemRow {
  rawText: string;
  productId: number | null;
  productName: string | null;
  qty: number;
  unit: string;
  unitPriceOre: number | null;
  lineTotalOre: number;
  offerQty: number | null;
  offerTotalOre: number | null;
  discountOre: number;
  pantOre: number;
  isPant: boolean; // legacy rows from before pant became a per-line surcharge
  bbox: string | null;
}

interface ReceiptDetail {
  id: number;
  status: string;
  storeName: string | null;
  channel: string | null;
  originalFilename: string | null;
  purchaseDate: string | null;
  purchaseTime: string | null;
  receiptNumber: string | null;
  totalOre: number | null;
  pantReturnOre: number | null;
  deliveryFeeOre: number | null;
  serviceFeeOre: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  items: ItemRow[];
}

export default function ReceiptDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/receipts/${params.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setReceipt)
      .catch(() => setError('Could not load the receipt.'));
  }, [params.id]);

  async function deleteReceipt() {
    if (!confirm('Delete this receipt? This cannot be undone.')) return;
    const res = await fetch(`/api/receipts/${params.id}`, { method: 'DELETE' });
    if (res.ok) router.push('/receipts');
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!receipt) return <p className="text-sm text-gray-400">Loading...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/receipts" className="text-sm text-green-600 hover:underline">
            &larr; Receipts
          </Link>
          <h1 className="text-xl font-bold mt-1 flex items-center gap-2">
            {receipt.storeName ?? 'Unknown store'}
            {channelLabel(receipt.channel) && (
              <span className="text-xs font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {channelLabel(receipt.channel)}
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-400">
            {receipt.purchaseDate}
            {receipt.purchaseTime && ` kl ${receipt.purchaseTime}`}
            {receipt.originalFilename && (
              <span className="ml-2 text-xs text-gray-300">{receipt.originalFilename}</span>
            )}
          </p>
          {receipt.receiptNumber && (
            <p className="text-xs text-gray-400 mt-0.5">Receipt no. {receipt.receiptNumber}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {statusBadge(receipt.status)}
          <Link
            href={`/receipts/${receipt.id}/review`}
            className="text-sm bg-gray-100 text-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-200"
          >
            Edit
          </Link>
          <button
            onClick={deleteReceipt}
            className="text-sm text-red-500 hover:text-red-700 px-2 py-1.5"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="bg-white rounded-lg shadow p-3">
          {receipt.imageWidth && receipt.imageHeight ? (
            <ReceiptImageViewer
              imageUrl={`/api/receipts/${receipt.id}/image`}
              imageWidth={receipt.imageWidth}
              imageHeight={receipt.imageHeight}
              words={[]}
              items={receipt.items.map((item, index) => ({
                index,
                bbox: item.bbox ? JSON.parse(item.bbox) : null,
              }))}
              selectedIndex={selectedIndex}
              onWordTap={() => {}}
              onItemTap={setSelectedIndex}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/receipts/${receipt.id}/image`}
              alt="Receipt"
              className="max-w-full mx-auto rounded"
            />
          )}
        </div>

        <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
          {receipt.items.map((item, index) => (
            <div
              key={index}
              className={`px-4 py-2.5 flex items-center justify-between gap-3 cursor-pointer ${
                selectedIndex === index ? 'bg-green-50/60' : ''
              }`}
              onClick={() => setSelectedIndex(selectedIndex === index ? null : index)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: ITEM_COLORS[index % ITEM_COLORS.length] }}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {item.rawText}
                    {item.isPant && (
                      <span className="ml-2 text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">
                        pant
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400">
                    {item.qty} {item.unit === 'kg' ? 'kg' : 'pc'}
                    {item.unitPriceOre != null && ` × ${formatKr(item.unitPriceOre)}`}
                    {item.offerQty && item.offerTotalOre != null &&
                      ` · ${item.offerQty} for ${formatKr(item.offerTotalOre)}`}
                    {item.pantOre > 0 && ` · pant +${formatKr(item.pantOre)}`}
                    {item.productName && (
                      <Link
                        href={`/products/${item.productId}`}
                        className="ml-1 text-green-600 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {item.productName}
                      </Link>
                    )}
                  </p>
                </div>
              </div>
              <span className="text-right shrink-0">
                <span className="text-sm font-medium block">
                  {formatKr(
                    (item.offerQty && item.offerTotalOre != null
                      ? item.offerTotalOre
                      : item.lineTotalOre) -
                      (item.discountOre || 0) +
                      (item.pantOre || 0)
                  )}
                </span>
                {(() => {
                  const saved =
                    (item.discountOre || 0) +
                    (item.offerQty && item.offerTotalOre != null
                      ? Math.max(0, item.lineTotalOre - item.offerTotalOre)
                      : 0);
                  return saved > 0 ? (
                    <span className="text-[11px] text-green-600 block">
                      saved {formatKr(saved)}
                    </span>
                  ) : null;
                })()}
              </span>
            </div>
          ))}
          {receipt.deliveryFeeOre != null && receipt.deliveryFeeOre > 0 && (
            <div className="px-4 py-2 flex items-center justify-between text-sm text-gray-500">
              <span>Delivery fee</span>
              <span>{formatKr(receipt.deliveryFeeOre)}</span>
            </div>
          )}
          {receipt.serviceFeeOre != null && receipt.serviceFeeOre > 0 && (
            <div className="px-4 py-2 flex items-center justify-between text-sm text-gray-500">
              <span>Service fee</span>
              <span>{formatKr(receipt.serviceFeeOre)}</span>
            </div>
          )}
          {receipt.pantReturnOre != null && receipt.pantReturnOre > 0 && (
            <div className="px-4 py-2 flex items-center justify-between text-sm text-gray-500">
              <span>Pant refund</span>
              <span>−{formatKr(receipt.pantReturnOre)}</span>
            </div>
          )}
          {receipt.totalOre != null && (
            <div className="px-4 py-3 flex items-center justify-between font-semibold">
              <span>Total</span>
              <span className="text-right">
                {(() => {
                  const saved = receipt.items.reduce(
                    (sum, item) =>
                      sum +
                      (item.discountOre || 0) +
                      (item.offerQty && item.offerTotalOre != null
                        ? Math.max(0, item.lineTotalOre - item.offerTotalOre)
                        : 0),
                    0
                  );
                  return saved > 0 ? (
                    <span className="block text-xs font-normal text-green-600">
                      saved {formatKr(saved)}
                    </span>
                  ) : null;
                })()}
                {formatKr(receipt.totalOre)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
