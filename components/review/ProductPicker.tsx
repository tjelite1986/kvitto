'use client';

// Autocomplete for linking a receipt item to a canonical product.
// Searches /api/products (debounced) and offers inline creation with
// brand/category/amount prefilled from parser suggestions.

import { useEffect, useRef, useState } from 'react';
import { AMOUNT_UNITS, parseAmountFromText } from '@/lib/units';

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
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', brand: '', category: '', amountValue: '', amountUnit: '' });
  const [createError, setCreateError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/products?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((data) => Array.isArray(data) && setOptions(data.map((p) => ({ id: p.id, name: p.name }))))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query, open]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreateOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

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
      onChange(product.id, product.name);
      setOpen(false);
      setCreateOpen(false);
    } else if (res.status === 409) {
      // Already exists — find and link it instead
      const list = await fetch(`/api/products?q=${encodeURIComponent(name)}`).then((r) => r.json());
      const hit = Array.isArray(list) && list.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (hit) {
        onChange(hit.id, hit.name);
        setOpen(false);
        setCreateOpen(false);
      } else {
        setCreateError('A product with that name already exists');
      }
    } else {
      const data = await res.json().catch(() => ({}));
      setCreateError(data.error || 'Could not create the product');
    }
  }

  const createName = (query || suggestion).trim();
  const fieldClass =
    'w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-500';

  return (
    <div ref={containerRef} className="relative" onClick={(e) => e.stopPropagation()}>
      {productId ? (
        <div className="flex items-center gap-1">
          <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-medium px-2 py-1 rounded-full">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            {productName ?? `#${productId}`}
          </span>
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
          onClick={() => { setOpen(!open); setQuery(''); setCreateOpen(false); }}
          className="text-xs text-gray-400 hover:text-green-600 underline decoration-dotted"
        >
          Link product
        </button>
      )}

      {open && (
        <div className="absolute z-20 mt-1 left-0 w-72 bg-white border border-gray-200 rounded-lg shadow-lg p-2">
          {createOpen ? (
            <div className="space-y-1.5">
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Product name"
                className={fieldClass}
              />
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  value={form.brand}
                  onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                  placeholder="Brand"
                  className={fieldClass}
                />
                <input
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="Category"
                  className={fieldClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
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
              <div className="flex gap-1.5">
                <button
                  onClick={createProduct}
                  disabled={creating || !form.name.trim()}
                  className="flex-1 bg-green-600 text-white text-sm py-1 rounded hover:bg-green-700 disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
                <button
                  onClick={() => setCreateOpen(false)}
                  className="px-3 text-sm text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products..."
                className={`${fieldClass} mb-1`}
              />
              <ul className="max-h-40 overflow-y-auto">
                {options.map((option) => (
                  <li key={option.id}>
                    <button
                      onClick={() => { onChange(option.id, option.name); setOpen(false); }}
                      className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-green-50"
                    >
                      {option.name}
                    </button>
                  </li>
                ))}
              </ul>
              {createName && !options.some((o) => o.name.toLowerCase() === createName.toLowerCase()) && (
                <button
                  onClick={() => openCreateForm(createName)}
                  className="w-full text-left px-2 py-1.5 text-sm text-green-600 rounded hover:bg-green-50 border-t border-gray-100 mt-1"
                >
                  + Create &quot;{createName}&quot;
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
