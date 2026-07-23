'use client';

// Links a receipt item to a canonical product. Tapping the trigger opens a
// full modal (bottom sheet on mobile, centered card on wider screens) with a
// large search field and comfortable, tappable rows — much easier to use on a
// phone than the old inline dropdown. Searches /api/products (debounced) and
// offers inline creation with brand/category/amount prefilled from parser
// suggestions.

import { useEffect, useRef, useState } from 'react';
import { AMOUNT_UNITS, parseAmountFromText } from '@/lib/units';
import ProductCategorySelect from '@/components/ProductCategorySelect';

interface ProductOption {
  id: number;
  name: string;
}

export interface ProductSuggestion {
  brand?: string | null;
  category?: string | null;
  amountValue?: number | null;
  amountUnit?: string | null;
}

interface ProductPickerProps {
  productId: number | null;
  productName: string | null;
  suggestion: string; // item raw text, used as the "create new" default
  details?: ProductSuggestion | null; // parser-suggested product metadata
  onChange: (productId: number | null, productName: string | null) => void;
}

export default function ProductPicker({
  productId,
  productName,
  suggestion,
  details,
  onChange,
}: ProductPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', brand: '', category: '', amountValue: '', amountUnit: '' });
  const [createError, setCreateError] = useState('');
  // Visible viewport (shrinks when the mobile keyboard opens) so the sheet can
  // sit directly above the keyboard instead of being hidden behind it.
  const [viewport, setViewport] = useState<{ top: number; height: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/products?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((data) => Array.isArray(data) && setOptions(data.map((p) => ({ id: p.id, name: p.name }))))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query, open]);

  // Lock body scroll and close on Escape while the modal is open.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Track the visual viewport so the bottom sheet stays above the on-screen
  // keyboard (the layout viewport doesn't shrink when the keyboard opens).
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setViewport({ top: vv.offsetTop, height: vv.height });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      setViewport(null);
    };
  }, [open]);

  function openModal() {
    setQuery('');
    setOptions([]);
    setCreateOpen(false);
    setCreateError('');
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setCreateOpen(false);
  }

  function openCreateForm(name: string) {
    // Prefill from parser suggestions, falling back to a size found in the text
    const parsedAmount = parseAmountFromText(name);
    setForm({
      name,
      brand: details?.brand ?? '',
      category: details?.category ?? '',
      amountValue: String(details?.amountValue ?? parsedAmount?.value ?? ''),
      amountUnit: details?.amountUnit ?? parsedAmount?.unit ?? '',
    });
    setCreateError('');
    setCreateOpen(true);
  }

  function pick(id: number, name: string) {
    onChange(id, name);
    close();
  }

  async function createProduct() {
    const name = form.name.trim();
    if (!name) return;
    setCreating(true);
    setCreateError('');
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        brand: form.brand.trim() || null,
        category: form.category.trim() || null,
        amountValue: form.amountValue.trim() ? Number(form.amountValue.replace(',', '.')) : null,
        amountUnit: form.amountUnit || null,
      }),
    });
    setCreating(false);
    if (res.ok) {
      const product = await res.json();
      pick(product.id, product.name);
    } else if (res.status === 409) {
      // Already exists — find and link it instead
      const list = await fetch(`/api/products?q=${encodeURIComponent(name)}`).then((r) => r.json());
      const hit = Array.isArray(list) && list.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (hit) {
        pick(hit.id, hit.name);
      } else {
        setCreateError('A product with that name already exists');
      }
    } else {
      const data = await res.json().catch(() => ({}));
      setCreateError(data.error || 'Could not create the product');
    }
  }

  const createName = (query || suggestion).trim();
  const showCreate =
    createName && !options.some((o) => o.name.toLowerCase() === createName.toLowerCase());
  const fieldClass =
    'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-green-500';

  return (
    <div className="inline-flex" onClick={(e) => e.stopPropagation()}>
      {productId ? (
        <div className="flex items-center gap-1">
          <button
            onClick={openModal}
            className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-medium px-2 py-1 rounded-full hover:bg-green-100"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            {productName ?? `#${productId}`}
          </button>
          <button
            onClick={() => onChange(null, null)}
            className="text-gray-300 hover:text-red-500 text-xs p-0.5"
            aria-label="Unlink product"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <button
          onClick={openModal}
          className="text-xs text-gray-400 hover:text-green-600 underline decoration-dotted"
        >
          Link product
        </button>
      )}

      {open && (
        <div
          className="fixed left-0 right-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
          style={viewport ? { top: viewport.top, height: viewport.height } : { top: 0, bottom: 0 }}
          onClick={close}
        >
          <div
            className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-full sm:max-h-[75vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">
                {createOpen ? 'New product' : 'Link product'}
              </h3>
              <button
                onClick={close}
                className="text-gray-400 hover:text-gray-600 p-1"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {createOpen ? (
              <div className="p-4 space-y-2 overflow-y-auto">
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Product name"
                  className={fieldClass}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={form.brand}
                    onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                    placeholder="Brand"
                    className={fieldClass}
                  />
                  <ProductCategorySelect
                    value={form.category}
                    onChange={(category) => setForm((f) => ({ ...f, category }))}
                    className={fieldClass}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={form.amountValue}
                    onChange={(e) => setForm((f) => ({ ...f, amountValue: e.target.value }))}
                    placeholder="Amount"
                    inputMode="decimal"
                    className={fieldClass}
                  />
                  <select
                    value={form.amountUnit}
                    onChange={(e) => setForm((f) => ({ ...f, amountUnit: e.target.value }))}
                    className={fieldClass}
                  >
                    <option value="">unit</option>
                    {AMOUNT_UNITS.map((u) => (
                      <option key={u} value={u}>{u === 'pc' ? 'st' : u}</option>
                    ))}
                  </select>
                </div>
                {createError && <p className="text-xs text-red-600">{createError}</p>}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setCreateOpen(false)}
                    className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
                  >
                    Back
                  </button>
                  <button
                    onClick={createProduct}
                    disabled={creating || !form.name.trim()}
                    className="flex-1 bg-green-600 text-white text-sm py-2 rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    {creating ? 'Creating...' : 'Create & link'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="p-3 border-b border-gray-100">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search products..."
                    className={fieldClass}
                  />
                </div>
                <ul className="flex-1 min-h-0 overflow-y-auto p-2">
                  {options.map((option) => (
                    <li key={option.id}>
                      <button
                        onClick={() => pick(option.id, option.name)}
                        className="w-full text-left px-3 py-3 text-sm rounded-lg hover:bg-green-50 active:bg-green-100"
                      >
                        {option.name}
                      </button>
                    </li>
                  ))}
                  {!loading && options.length === 0 && !showCreate && (
                    <li className="px-3 py-6 text-center text-sm text-gray-400">No products found</li>
                  )}
                </ul>
                {showCreate && (
                  <div className="p-2 border-t border-gray-100">
                    <button
                      onClick={() => openCreateForm(createName)}
                      className="w-full text-left px-3 py-3 text-sm text-green-600 rounded-lg hover:bg-green-50 active:bg-green-100"
                    >
                      + Create &quot;{createName}&quot;
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
