'use client';

// Review page: triggers parsing, shows the receipt image with a word-box
// overlay next to an editable items table, and confirms the result.
// Word taps assign OCR words to the selected item (name + bounding box).

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { formatKr, statusBadge } from '@/lib/format';
import ReceiptImageViewer, {
  ITEM_COLORS,
  type OverlayWord,
} from '@/components/review/ReceiptImageViewer';
import ProductPicker from '@/components/review/ProductPicker';

interface ItemRow {
  rawText: string;
  productId: number | null;
  productName?: string | null;
  qty: number;
  unit: 'pc' | 'kg';
  unitPriceOre: number | null;
  lineTotalOre: number;
  offerQty: number | null;
  offerTotalOre: number | null;
  discountOre: number;
  isPant: boolean;
  bbox: string | null;
}

interface ReceiptDetail {
  id: number;
  status: string;
  storeId: number | null;
  storeName: string | null;
  purchaseDate: string | null;
  totalOre: number | null;
  errorMessage: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  ocrData: string | null;
  items: ItemRow[];
}

interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function parseBbox(bbox: string | null): Bbox | null {
  if (!bbox) return null;
  try {
    return JSON.parse(bbox);
  } catch {
    return null;
  }
}

function mergeBbox(a: Bbox | null, b: Bbox): Bbox {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

function oreToInput(ore: number | null): string {
  return ore == null ? '' : (ore / 100).toFixed(2);
}

function inputToOre(value: string): number | null {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export default function ReviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [storeName, setStoreName] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [totalKr, setTotalKr] = useState('');
  const [phase, setPhase] = useState<'loading' | 'parsing' | 'review' | 'saving' | 'error'>('loading');
  const [error, setError] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const applyReceipt = useCallback((data: ReceiptDetail) => {
    setReceipt(data);
    setItems(data.items ?? []);
    setStoreName(data.storeName ?? '');
    setPurchaseDate(data.purchaseDate ?? '');
    setTotalKr(oreToInput(data.totalOre));
  }, []);

  const triggerParse = useCallback(async () => {
    setPhase('parsing');
    setError('');
    const res = await fetch(`/api/receipts/${params.id}/parse`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Parsing failed.');
      setPhase('error');
      return;
    }
    const detail = await fetch(`/api/receipts/${params.id}`).then((r) => r.json());
    applyReceipt(detail);
    setPhase('review');
  }, [params.id, applyReceipt]);

  useEffect(() => {
    fetch(`/api/receipts/${params.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: ReceiptDetail) => {
        applyReceipt(data);
        if (data.status === 'uploaded' || data.status === 'failed') {
          triggerParse();
        } else if (data.status === 'processing') {
          setPhase('parsing');
        } else {
          setPhase('review');
        }
      })
      .catch(() => {
        setError('Could not load the receipt.');
        setPhase('error');
      });
  }, [params.id, applyReceipt, triggerParse]);

  function updateItem(index: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setSelectedIndex(null);
  }

  function mergeWithAbove(index: number) {
    if (index === 0) return;
    setItems((prev) => {
      const above = prev[index - 1];
      const current = prev[index];
      const merged: ItemRow = {
        ...above,
        rawText: `${above.rawText} ${current.rawText}`.trim(),
        lineTotalOre: above.lineTotalOre + current.lineTotalOre,
        discountOre: (above.discountOre || 0) + (current.discountOre || 0),
        bbox: JSON.stringify(
          mergeBbox(parseBbox(above.bbox), parseBbox(current.bbox) ?? { x: 0, y: 0, w: 0, h: 0 })
        ),
      };
      if (!parseBbox(current.bbox)) merged.bbox = above.bbox;
      return prev.map((item, i) => (i === index - 1 ? merged : item)).filter((_, i) => i !== index);
    });
    setSelectedIndex(index - 1);
  }

  function handleWordTap(word: OverlayWord) {
    if (selectedIndex == null) return;
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== selectedIndex) return item;
        const bbox = mergeBbox(parseBbox(item.bbox), {
          x: word.x, y: word.y, w: word.w, h: word.h,
        });
        return {
          ...item,
          rawText: item.rawText ? `${item.rawText} ${word.t}` : word.t,
          bbox: JSON.stringify(bbox),
        };
      })
    );
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        rawText: '',
        productId: null,
        qty: 1,
        unit: 'pc',
        unitPriceOre: null,
        lineTotalOre: 0,
        offerQty: null,
        offerTotalOre: null,
        discountOre: 0,
        isPant: false,
        bbox: null,
      },
    ]);
  }

  async function confirm() {
    setPhase('saving');
    setError('');
    const res = await fetch(`/api/receipts/${params.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeName: storeName.trim() || null,
        purchaseDate: purchaseDate || null,
        totalOre: inputToOre(totalKr),
        items,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Could not save.');
      setPhase('review');
      return;
    }
    router.push('/receipts');
  }

  let ocrWords: OverlayWord[] = [];
  if (receipt?.ocrData) {
    try {
      ocrWords = (JSON.parse(receipt.ocrData).words ?? []) as OverlayWord[];
    } catch {
      ocrWords = [];
    }
  }

  const computedSum = items.reduce((sum, item) => {
    const effective =
      item.offerQty && item.offerTotalOre != null ? item.offerTotalOre : item.lineTotalOre;
    return sum + effective - (item.discountOre || 0);
  }, 0);
  const enteredTotal = inputToOre(totalKr);
  const sumMatches = enteredTotal == null || Math.abs(computedSum - enteredTotal) <= 1;

  const inputClass =
    'w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-500';

  if (phase === 'loading') {
    return <p className="text-sm text-gray-400">Loading...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Review receipt</h1>
        {receipt && statusBadge(phase === 'parsing' ? 'processing' : receipt.status)}
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={triggerParse} className="underline font-medium ml-4">
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="bg-white rounded-lg shadow p-3 lg:sticky lg:top-16">
          {receipt?.imageWidth && receipt?.imageHeight ? (
            <>
              <ReceiptImageViewer
                imageUrl={`/api/receipts/${params.id}/image`}
                imageWidth={receipt.imageWidth}
                imageHeight={receipt.imageHeight}
                words={ocrWords}
                items={items.map((item, index) => ({ index, bbox: parseBbox(item.bbox) }))}
                selectedIndex={selectedIndex}
                onWordTap={handleWordTap}
                onItemTap={setSelectedIndex}
              />
              <p className="text-[11px] text-gray-400 mt-2 text-center">
                {selectedIndex != null
                  ? 'Tap words on the receipt to add them to the selected item.'
                  : 'Select an item row, then tap words on the receipt to correct it.'}
              </p>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/receipts/${params.id}/image`}
              alt="Receipt"
              className="max-w-full mx-auto rounded border border-gray-100"
            />
          )}
        </div>

        <div className="space-y-4">
          {phase === 'parsing' ? (
            <div className="bg-white rounded-lg shadow p-6 text-center">
              <div className="animate-pulse text-sm text-gray-500">
                Reading the receipt... This takes up to 30 seconds.
              </div>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Store</label>
                  <input
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder="Store name"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
                  <input
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Total (kr)</label>
                  <input
                    value={totalKr}
                    onChange={(e) => setTotalKr(e.target.value)}
                    inputMode="decimal"
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
                {items.map((item, index) => (
                  <div
                    key={index}
                    className={`p-3 space-y-2 cursor-pointer transition-colors ${
                      selectedIndex === index ? 'bg-green-50/60 ring-1 ring-inset ring-green-200' : ''
                    }`}
                    onClick={() => setSelectedIndex(selectedIndex === index ? null : index)}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: ITEM_COLORS[index % ITEM_COLORS.length] }}
                      />
                      <input
                        value={item.rawText}
                        onChange={(e) => updateItem(index, { rawText: e.target.value })}
                        onClick={(e) => e.stopPropagation()}
                        onFocus={() => setSelectedIndex(index)}
                        placeholder="Item name"
                        className={`${inputClass} flex-1 font-medium`}
                      />
                      {index > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); mergeWithAbove(index); }}
                          className="text-gray-300 hover:text-blue-500 p-1 shrink-0"
                          title="Merge with row above"
                          aria-label="Merge with row above"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeItem(index); }}
                        className="text-gray-300 hover:text-red-500 p-1 shrink-0"
                        aria-label="Remove item"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-2" onClick={(e) => e.stopPropagation()}>
                      <div>
                        <label className="block text-[10px] text-gray-400">Qty</label>
                        <input
                          value={item.qty}
                          onChange={(e) => updateItem(index, { qty: Number(e.target.value.replace(',', '.')) || 0 })}
                          inputMode="decimal"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-400">Unit</label>
                        <select
                          value={item.unit}
                          onChange={(e) => updateItem(index, { unit: e.target.value as 'pc' | 'kg' })}
                          className={inputClass}
                        >
                          <option value="pc">pc</option>
                          <option value="kg">kg</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-400">Unit price</label>
                        <input
                          value={oreToInput(item.unitPriceOre)}
                          onChange={(e) => updateItem(index, { unitPriceOre: inputToOre(e.target.value) })}
                          inputMode="decimal"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-400">Line total</label>
                        <input
                          value={oreToInput(item.lineTotalOre)}
                          onChange={(e) => updateItem(index, { lineTotalOre: inputToOre(e.target.value) ?? 0 })}
                          inputMode="decimal"
                          className={inputClass}
                        />
                      </div>
                    </div>
                    <div className="pl-4">
                      <ProductPicker
                        productId={item.productId}
                        productName={item.productName ?? null}
                        suggestion={item.rawText}
                        onChange={(productId, productName) =>
                          updateItem(index, { productId, productName })
                        }
                      />
                    </div>
                    <div className="grid grid-cols-4 gap-2 items-end" onClick={(e) => e.stopPropagation()}>
                      <div>
                        <label className="block text-[10px] text-gray-400">Offer qty</label>
                        <input
                          value={item.offerQty ?? ''}
                          onChange={(e) =>
                            updateItem(index, { offerQty: e.target.value ? Number(e.target.value) : null })
                          }
                          inputMode="numeric"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-400">Offer total</label>
                        <input
                          value={oreToInput(item.offerTotalOre)}
                          onChange={(e) => updateItem(index, { offerTotalOre: inputToOre(e.target.value) })}
                          inputMode="decimal"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-400">Discount</label>
                        <input
                          value={oreToInput(item.discountOre)}
                          onChange={(e) => updateItem(index, { discountOre: inputToOre(e.target.value) ?? 0 })}
                          inputMode="decimal"
                          className={inputClass}
                        />
                      </div>
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-1.5">
                        <input
                          type="checkbox"
                          checked={item.isPant}
                          onChange={(e) => updateItem(index, { isPant: e.target.checked })}
                          className="rounded"
                        />
                        Pant
                      </label>
                    </div>
                  </div>
                ))}

                <div className="p-3 flex items-center justify-between">
                  <button onClick={addItem} className="text-sm text-green-600 hover:underline">
                    + Add item
                  </button>
                  <span
                    className={`text-sm font-medium ${sumMatches ? 'text-green-600' : 'text-red-600'}`}
                  >
                    Sum: {formatKr(computedSum)}
                    {!sumMatches && enteredTotal != null && ` (total says ${formatKr(enteredTotal)})`}
                  </span>
                </div>
              </div>

              <button
                onClick={confirm}
                disabled={phase === 'saving' || items.length === 0}
                className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 font-medium disabled:opacity-50"
              >
                {phase === 'saving' ? 'Saving...' : 'Confirm receipt'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
