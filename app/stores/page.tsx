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
  keywords: number;
}

interface KeywordRow {
  id: number;
  keyword: string;
  createdAt: string;
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
  // Learned keyword rules (expand a store row to see/manage them).
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [kwLoading, setKwLoading] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');

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

  async function toggleExpand(storeId: number) {
    if (expandedId === storeId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(storeId);
    setKeywords([]);
    setNewKeyword('');
    setKwLoading(true);
    const data = await fetch(`/api/stores/${storeId}/keywords`)
      .then((r) => r.json())
      .catch(() => []);
    setKeywords(Array.isArray(data) ? data : []);
    setKwLoading(false);
  }

  async function addKeyword(storeId: number) {
    const kw = newKeyword.trim();
    if (!kw) return;
    const data = await fetch(`/api/stores/${storeId}/keywords`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: kw }),
    })
      .then((r) => r.json())
      .catch(() => null);
    if (Array.isArray(data)) {
      setKeywords(data);
      setNewKeyword('');
      setRefresh((n) => n + 1);
    }
  }

  async function deleteKeyword(storeId: number, keywordId: number) {
    await fetch(`/api/stores/${storeId}/keywords?keywordId=${keywordId}`, { method: 'DELETE' });
    setKeywords((prev) => prev.filter((k) => k.id !== keywordId));
    setRefresh((n) => n + 1);
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
              <li key={store.id}>
                <button
                  onClick={() => toggleExpand(store.id)}
                  className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-gray-50"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <svg
                      className={`w-4 h-4 text-gray-300 shrink-0 transition-transform ${expandedId === store.id ? 'rotate-90' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{store.name}</p>
                      {store.city && <p className="text-xs text-gray-400">{store.city}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400 shrink-0">
                    {store.keywords > 0 && (
                      <span className="text-green-600" title="Learned keyword rules">
                        {store.keywords} rule{store.keywords === 1 ? '' : 's'}
                      </span>
                    )}
                    <span>{store.receipts} receipts</span>
                    <span
                      title="Recognized receipt layouts for automatic store detection"
                      className={store.fingerprints > 0 ? 'text-green-600' : ''}
                    >
                      {store.fingerprints > 0 ? 'auto-detected' : 'not seen yet'}
                    </span>
                  </div>
                </button>

                {expandedId === store.id && (
                  <div className="px-4 pb-4 pt-1 bg-gray-50/50">
                    <p className="text-xs font-medium text-gray-500 mb-2">
                      Learned keyword rules
                      <span className="font-normal text-gray-400">
                        {' '}— a receipt whose text contains one of these is auto-detected as this store.
                      </span>
                    </p>
                    {kwLoading ? (
                      <p className="text-xs text-gray-400">Loading...</p>
                    ) : keywords.length === 0 ? (
                      <p className="text-xs text-gray-400 mb-2">
                        No rules yet. Mark the store text on a receipt in review, or add one below.
                      </p>
                    ) : (
                      <ul className="flex flex-wrap gap-2 mb-2">
                        {keywords.map((k) => (
                          <li
                            key={k.id}
                            className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-full pl-3 pr-1 py-1 text-xs"
                          >
                            <span>{k.keyword}</span>
                            <button
                              onClick={() => deleteKeyword(store.id, k.id)}
                              className="text-gray-300 hover:text-red-500 p-0.5"
                              aria-label={`Delete rule ${k.keyword}`}
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex gap-2">
                      <input
                        value={newKeyword}
                        onChange={(e) => setNewKeyword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addKeyword(store.id)}
                        placeholder="Add a keyword, e.g. foodora"
                        className={`${fieldClass} max-w-xs`}
                      />
                      <button
                        onClick={() => addKeyword(store.id)}
                        disabled={!newKeyword.trim()}
                        className="text-xs bg-green-600 text-white px-3 py-1 rounded-md hover:bg-green-700 disabled:opacity-50 shrink-0"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
