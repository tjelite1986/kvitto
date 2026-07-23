'use client';

// A category picker backed by the managed, user-extensible product-category
// list (/api/product-categories). Renders a <select> of the known categories
// plus a "+ New category…" option that flips to an inline add field. The
// current value is always selectable even if it isn't (yet) in the list — so
// AI-suggested or legacy free-text categories are never silently dropped.

import { useEffect, useState } from 'react';

interface Category {
  id: number;
  name: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const ADD_SENTINEL = '__add__';

export default function ProductCategorySelect({ value, onChange, className }: Props) {
  const [cats, setCats] = useState<Category[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/product-categories')
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setCats(data))
      .catch(() => {});
  }, []);

  async function addCategory() {
    const name = newName.trim();
    if (!name) return;
    setError('');
    const res = await fetch('/api/product-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Could not add the category.');
      return;
    }
    const cat = await res.json();
    setCats((prev) => (prev.some((c) => c.id === cat.id) ? prev : [...prev, cat]));
    onChange(cat.name);
    setAdding(false);
    setNewName('');
  }

  const cls =
    className ??
    'w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-500';

  if (adding) {
    return (
      <div className="space-y-1">
        <div className="flex gap-1">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addCategory();
              if (e.key === 'Escape') { setAdding(false); setNewName(''); setError(''); }
            }}
            placeholder="New category"
            className={cls}
          />
          <button
            type="button"
            onClick={addCategory}
            disabled={!newName.trim()}
            className="text-xs bg-green-600 text-white px-2 rounded hover:bg-green-700 disabled:opacity-50 shrink-0"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setNewName(''); setError(''); }}
            className="text-xs text-gray-400 hover:text-gray-600 px-1 shrink-0"
          >
            ✕
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  const known = cats.some((c) => c.name === value);

  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === ADD_SENTINEL) setAdding(true);
        else onChange(e.target.value);
      }}
      className={cls}
    >
      <option value="">—</option>
      {value && !known && <option value={value}>{value}</option>}
      {cats.map((c) => (
        <option key={c.id} value={c.name}>{c.name}</option>
      ))}
      <option value={ADD_SENTINEL}>+ New category…</option>
    </select>
  );
}
