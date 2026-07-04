'use client';

// Autocomplete for linking a receipt item to a canonical product.
// Searches /api/products (debounced) and offers inline creation.

import { useEffect, useRef, useState } from 'react';

interface ProductOption {
  id: number;
  name: string;
}

interface ProductPickerProps {
  productId: number | null;
  productName: string | null;
  suggestion: string; // item raw text, used as the "create new" default
  onChange: (productId: number | null, productName: string | null) => void;
}

export default function ProductPicker({
  productId,
  productName,
  suggestion,
  onChange,
}: ProductPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [creating, setCreating] = useState(false);
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
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  async function createProduct(name: string) {
    setCreating(true);
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setCreating(false);
    if (res.ok) {
      const product = await res.json();
      onChange(product.id, product.name);
      setOpen(false);
    } else if (res.status === 409) {
      // Already exists — find and link it instead
      const list = await fetch(`/api/products?q=${encodeURIComponent(name)}`).then((r) => r.json());
      const hit = Array.isArray(list) && list.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (hit) {
        onChange(hit.id, hit.name);
        setOpen(false);
      }
    }
  }

  const createName = (query || suggestion).trim();

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
          onClick={() => { setOpen(!open); setQuery(''); }}
          className="text-xs text-gray-400 hover:text-green-600 underline decoration-dotted"
        >
          Link product
        </button>
      )}

      {open && (
        <div className="absolute z-20 mt-1 left-0 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products..."
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-500 mb-1"
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
              onClick={() => createProduct(createName)}
              disabled={creating}
              className="w-full text-left px-2 py-1.5 text-sm text-green-600 rounded hover:bg-green-50 border-t border-gray-100 mt-1 disabled:opacity-50"
            >
              {creating ? 'Creating...' : `+ Create "${createName}"`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
