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
import ProductPicker, { type ProductSuggestion } from '@/components/review/ProductPicker';

// 'hg' is an entry convenience for lösgodis lines printed per hectogram —
// converted to kg on save (qty / 10, unit price x 10), never stored.
type EntryUnit = 'pc' | 'kg' | 'hg';

function toStoredItem<T extends { qty: number; unit: EntryUnit; unitPriceOre: number | null }>(
  item: T
): T & { unit: 'pc' | 'kg' } {
  if (item.unit !== 'hg') return item as T & { unit: 'pc' | 'kg' };
  return {
    ...item,
    qty: item.qty / 10,
    unit: 'kg' as const,
    unitPriceOre: item.unitPriceOre != null ? item.unitPriceOre * 10 : null,
  };
}

interface ItemRow {
  rawText: string;
  productId: number | null;
  productName?: string | null;
  qty: number;
  unit: EntryUnit;
  unitPriceOre: number | null;
  lineTotalOre: number;
  offerQty: number | null;
  offerTotalOre: number | null;
  discountOre: number;
  pantOre: number;
  bbox: string | null;
  suggestion?: ProductSuggestion | null; // parser-suggested brand/category/amount
}

// Product metadata suggested by the AI parser, kept in claude_raw and matched
// back to the stored items by line position.
function itemSuggestions(claudeRaw: string | null, items: ItemRow[]): (ProductSuggestion | null)[] {
  try {
    const parsedItems = JSON.parse(claudeRaw ?? '{}').parsed?.items ?? [];
    return items.map((item, i) => {
      const p = parsedItems[i];
      if (!p || p.name !== item.rawText) return null;
      if (p.brand == null && p.category == null && p.amount_value == null) return null;
      return {
        brand: p.brand ?? null,
        category: p.category ?? null,
        amountValue: p.amount_value ?? null,
        amountUnit: p.amount_unit ?? null,
      };
    });
  } catch {
    return items.map(() => null);
  }
}

interface ReceiptDetail {
  id: number;
  status: string;
  storeId: number | null;
  storeName: string | null;
  originalFilename: string | null;
  purchaseDate: string | null;
  purchaseTime: string | null;
  receiptNumber: string | null;
  totalOre: number | null;
  pantReturnOre: number | null;
  errorMessage: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  ocrData: string | null;
  claudeRaw: string | null;
  items: ItemRow[];
}

type ParseMode = 'auto' | 'local' | 'ai' | 'manual';

function parserUsed(claudeRaw: string | null): string | null {
  if (!claudeRaw) return null;
  try {
    return JSON.parse(claudeRaw).parser ?? 'ai';
  } catch {
    return null;
  }
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
  const [purchaseTime, setPurchaseTime] = useState('');
  const [totalKr, setTotalKr] = useState('');
  const [pantReturnKr, setPantReturnKr] = useState('');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [phase, setPhase] = useState<'loading' | 'choice' | 'parsing' | 'review' | 'saving' | 'error'>('loading');
  const [error, setError] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const applyReceipt = useCallback((data: ReceiptDetail) => {
    setReceipt(data);
    const loaded = data.items ?? [];
    const suggestions = itemSuggestions(data.claudeRaw, loaded);
    setItems(loaded.map((item, i) => ({ ...item, suggestion: suggestions[i] })));
    setStoreName(data.storeName ?? '');
    setPurchaseDate(data.purchaseDate ?? '');
    setPurchaseTime(data.purchaseTime ?? '');
    setTotalKr(oreToInput(data.totalOre));
    setPantReturnKr(data.pantReturnOre ? oreToInput(data.pantReturnOre) : '');
    setReceiptNumber(data.receiptNumber ?? '');
  }, []);

  const triggerParse = useCallback(
    async (mode: ParseMode) => {
      setPhase('parsing');
      setError('');
      const res = await fetch(`/api/receipts/${params.id}/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Parsing failed.');
        setPhase('choice');
        return;
      }
      const detail = await fetch(`/api/receipts/${params.id}`).then((r) => r.json());
      applyReceipt(detail);
      setPhase('review');
    },
    [params.id, applyReceipt]
  );

  useEffect(() => {
    fetch(`/api/receipts/${params.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: ReceiptDetail) => {
        applyReceipt(data);
        if (data.status === 'uploaded' || data.status === 'failed') {
          setPhase('choice');
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
  }, [params.id, applyReceipt]);

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
        pantOre: (above.pantOre || 0) + (current.pantOre || 0),
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
        pantOre: 0,
        bbox: null,
      },
    ]);
  }

  async function deleteReceipt() {
    if (deleting) return;
    if (!window.confirm('Delete this receipt? This cannot be undone.')) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/receipts/${params.id}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/receipts');
        return;
      }
    } catch {
      // fall through to the shared error path
    }
    setDeleting(false);
    setError('Could not delete the receipt.');
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
        purchaseTime: purchaseTime || null,
        totalOre: inputToOre(totalKr),
        pantReturnOre: inputToOre(pantReturnKr) ?? 0,
        receiptNumber: receiptNumber.trim() || null,
        items: items.map(toStoredItem),
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
    return sum + effective - (item.discountOre || 0) + (item.pantOre || 0);
  }, 0);
  const enteredTotal = inputToOre(totalKr);
  const pantReturnOre = inputToOre(pantReturnKr) ?? 0;
  const netSum = computedSum - pantReturnOre;
  const sumMatches = enteredTotal == null || Math.abs(netSum - enteredTotal) <= 1;
  const totalSaved = items.reduce(
    (sum, item) =>
      sum +
      (item.discountOre || 0) +
      (item.offerQty && item.offerTotalOre != null
        ? Math.max(0, item.lineTotalOre - item.offerTotalOre)
        : 0),
    0
  );

  const inputClass =
    'w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-500';

  if (phase === 'loading') {
    return <p className="text-sm text-gray-400">Loading...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Review receipt</h1>
          {receipt?.originalFilename && (
            <p className="text-xs text-gray-400 truncate" title={receipt.originalFilename}>
              {receipt.originalFilename}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {phase === 'review' && (() => {
            const parser = parserUsed(receipt?.claudeRaw ?? null);
            if (!parser) return null;
            return (
              <>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    parser === 'ai'
                      ? 'bg-purple-50 text-purple-700'
                      : 'bg-blue-50 text-blue-700'
                  }`}
                  title={
                    parser === 'ai'
                      ? 'Parsed with AI (OpenRouter)'
                      : parser === 'local'
                        ? 'Parsed locally on the server — no AI request'
                        : 'Manual entry'
                  }
                >
                  {parser === 'ai' ? 'AI' : parser === 'local' ? 'Local' : 'Manual'}
                </span>
                {parser !== 'ai' && (
                  <button
                    onClick={() => triggerParse('ai')}
                    className="text-xs text-gray-400 hover:text-purple-600 underline decoration-dotted"
                    title="Replaces the items below with an AI reading"
                  >
                    Re-read with AI
                  </button>
                )}
              </>
            );
          })()}
          {receipt && statusBadge(phase === 'parsing' ? 'processing' : receipt.status)}
          <button
            onClick={deleteReceipt}
            disabled={deleting || phase === 'saving' || phase === 'parsing'}
            className="text-sm text-red-500 hover:text-red-700 px-2 py-1.5 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => triggerParse('auto')} className="underline font-medium ml-4">
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
          {phase === 'choice' ? (
            <div className="bg-white rounded-lg shadow p-6 space-y-3">
              <p className="text-sm text-gray-600">How do you want to enter this receipt?</p>
              <button
                onClick={() => triggerParse('auto')}
                className="w-full bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 font-medium"
              >
                Read automatically
                <span className="block text-xs font-normal text-green-100">
                  Free local reading first — AI only when the numbers don&apos;t add up
                </span>
              </button>
              <button
                onClick={() => triggerParse('manual')}
                className="w-full bg-gray-100 text-gray-700 py-3 rounded-lg hover:bg-gray-200 font-medium"
              >
                Enter manually
                <span className="block text-xs font-normal text-gray-400">
                  No parsing — tap words on the image to build each item
                </span>
              </button>
            </div>
          ) : phase === 'parsing' ? (
            <div className="bg-white rounded-lg shadow p-6 text-center">
              <div className="animate-pulse text-sm text-gray-500">
                Reading the receipt... This takes up to 30 seconds.
              </div>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2 sm:col-span-1">
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
                  <label className="block text-xs font-medium text-gray-500 mb-1">Time</label>
                  <input
                    type="time"
                    value={purchaseTime}
                    onChange={(e) => setPurchaseTime(e.target.value)}
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
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Pant refund (kr)</label>
                  <input
                    value={pantReturnKr}
                    onChange={(e) => setPantReturnKr(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Receipt no.</label>
                  <input
                    value={receiptNumber}
                    onChange={(e) => setReceiptNumber(e.target.value)}
                    placeholder="Kvittonr / Invoice no."
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
                          onChange={(e) => updateItem(index, { unit: e.target.value as EntryUnit })}
                          className={inputClass}
                        >
                          <option value="pc">pc</option>
                          <option value="kg">kg</option>
                          <option value="hg">hg</option>
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
                    {item.unit === 'hg' && (
                      <p className="text-[10px] text-gray-400 pl-4">
                        Saved as {(item.qty / 10).toLocaleString('sv-SE')} kg
                        {item.unitPriceOre != null && ` × ${formatKr(item.unitPriceOre * 10)}/kg`}
                      </p>
                    )}
                    <div className="pl-4 flex items-center justify-between gap-2">
                      <ProductPicker
                        productId={item.productId}
                        productName={item.productName ?? null}
                        suggestion={item.rawText}
                        details={item.suggestion ?? null}
                        onChange={(productId, productName) =>
                          updateItem(index, { productId, productName })
                        }
                      />
                      {(() => {
                        const saved =
                          (item.discountOre || 0) +
                          (item.offerQty && item.offerTotalOre != null
                            ? Math.max(0, item.lineTotalOre - item.offerTotalOre)
                            : 0);
                        return saved > 0 ? (
                          <span className="text-xs font-medium text-green-600 shrink-0">
                            Saved {formatKr(saved)}
                          </span>
                        ) : null;
                      })()}
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
                      <div>
                        <label className="block text-[10px] text-gray-400">Pant</label>
                        <input
                          value={oreToInput(item.pantOre)}
                          onChange={(e) => updateItem(index, { pantOre: inputToOre(e.target.value) ?? 0 })}
                          inputMode="decimal"
                          className={inputClass}
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <div className="p-3 flex items-center justify-between">
                  <button onClick={addItem} className="text-sm text-green-600 hover:underline">
                    + Add item
                  </button>
                  <span className="text-right">
                    {totalSaved > 0 && (
                      <span className="block text-xs text-green-600">
                        Total saved: {formatKr(totalSaved)}
                      </span>
                    )}
                    <span
                      className={`text-sm font-medium ${sumMatches ? 'text-green-600' : 'text-red-600'}`}
                    >
                      Sum: {formatKr(netSum)}
                      {!sumMatches && enteredTotal != null && ` (total says ${formatKr(enteredTotal)})`}
                    </span>
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
