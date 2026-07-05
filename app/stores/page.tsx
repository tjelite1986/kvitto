'use client';

// Store list with ahead-of-time creation. Stores are otherwise created
// automatically when a receipt from a new store is confirmed.

import { useEffect, useState } from 'react';

interface StoreEntry {
  id: number;
  name: string;
  city: string | null;
  receipts: number;
  fingerprints: number;
}

export default function StoresPage() {
  const [storesList, setStoresList] = useState<StoreEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [name, setName] = useState('');
  const [city, setCity] = useState('');

  useEffect(() => {
    fetch('/api/stores')
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setStoresList(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refresh]);

  async function createStore() {
    if (!name.trim()) return;
    setCreating(true);
    setCreateError('');
    const res = await fetch('/api/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), city: city.trim() || null }),
    });
    setCreating(false);
    if (res.ok) {
      setName('');
      setCity('');
      setShowCreate(false);
      setRefresh((n) => n + 1);
    } else {
      const data = await res.json().catch(() => ({}));
      setCreateError(data.error || 'Could not create the store.');
    }
  }

  const fieldClass =
    'w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-500';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold">Stores</h1>
        <button
          onClick={() => { setShowCreate(!showCreate); setCreateError(''); }}
          className="text-sm bg-green-600 text-white px-3 py-1.5 rounded-md hover:bg-green-700"
        >
          + New
        </button>
      </div>

      {showCreate && (
        <div className="bg-white rounded-lg shadow p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createStore()}
                placeholder="e.g. Hemköp Torpa"
                className={fieldClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">City</label>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createStore()}
                placeholder="e.g. Vänersborg"
                className={fieldClass}
              />
            </div>
          </div>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          <div className="flex gap-2">
            <button
              onClick={createStore}
              disabled={creating || !name.trim()}
              className="bg-green-600 text-white text-sm px-4 py-1.5 rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create store'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="text-sm text-gray-500 hover:text-gray-700 px-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow">
        {loading ? (
          <p className="px-6 py-8 text-sm text-gray-400 text-center">Loading...</p>
        ) : storesList.length === 0 ? (
          <p className="px-6 py-8 text-sm text-gray-400 text-center">
            No stores yet. They are created automatically when receipts are
            confirmed, or add one ahead of time with + New.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {storesList.map((store) => (
              <li key={store.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{store.name}</p>
                  {store.city && <p className="text-xs text-gray-400">{store.city}</p>}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400 shrink-0">
                  <span>{store.receipts} receipts</span>
                  <span
                    title="Recognized receipt layouts for automatic store detection"
                    className={store.fingerprints > 0 ? 'text-green-600' : ''}
                  >
                    {store.fingerprints > 0 ? 'auto-detected' : 'not seen yet'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
