'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

interface StoreRow {
  id: number;
  name: string;
  city: string | null;
  fingerprints: number;
  receipts: number;
  layoutHints: string;
  exampleCount: number;
}

function StoreProfileEditor({ store, onSaved }: { store: StoreRow; onSaved: () => void }) {
  const [hints, setHints] = useState(store.layoutHints);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/stores/${store.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layoutHints: hints }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    }
  }

  return (
    <div className="px-6 py-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-medium">{store.name}</p>
          <p className="text-xs text-gray-400">
            {store.receipts} receipts · {store.fingerprints} layout fingerprints ·{' '}
            {store.exampleCount} learned corrections
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving || hints === store.layoutHints}
          className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-md hover:bg-green-700 disabled:opacity-40"
        >
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save hints'}
        </button>
      </div>
      <textarea
        value={hints}
        onChange={(e) => setHints(e.target.value)}
        rows={2}
        placeholder="Layout hints for the parser, e.g. 'Discounts print on the line below the item, prefixed with *'"
        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
      />
    </div>
  );
}

export default function AdminPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [storesList, setStoresList] = useState<StoreRow[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const isAdmin = session?.user?.role === 'admin';

  function loadUsers() {
    fetch('/api/users')
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setUsers(data))
      .catch(() => {});
  }

  function loadStores() {
    fetch('/api/stores')
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setStoresList(data))
      .catch(() => {});
  }

  useEffect(() => {
    if (isAdmin) {
      loadUsers();
      loadStores();
    }
  }, [isAdmin]);

  if (session && !isAdmin) {
    return <p className="text-sm text-gray-500">You need admin access for this page.</p>;
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');

    const form = e.currentTarget;
    const formData = new FormData(form);
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formData.get('name'),
        email: formData.get('email'),
        password: formData.get('password'),
        role: formData.get('role'),
      }),
    });
    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(data.error || 'Something went wrong');
      return;
    }
    setMessage(`User ${data.email} created`);
    form.reset();
    loadUsers();
  }

  const inputClass =
    'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 text-sm';

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Admin</h1>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="font-semibold mb-4">Create user</h2>
        {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}
        {message && <div className="bg-green-50 text-green-700 p-3 rounded mb-4 text-sm">{message}</div>}
        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <input name="name" type="text" placeholder="Name" required className={inputClass} />
          <input name="email" type="email" placeholder="Email" required className={inputClass} />
          <input name="password" type="password" placeholder="Password (min 6 chars)" required minLength={6} className={inputClass} />
          <select name="role" className={inputClass} defaultValue="user">
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            disabled={saving}
            className="sm:col-span-2 bg-green-600 text-white py-2 rounded-md hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
          >
            {saving ? 'Creating...' : 'Create user'}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-lg shadow">
        <h2 className="font-semibold px-6 py-4 border-b border-gray-100">Store profiles</h2>
        {storesList.length === 0 ? (
          <p className="px-6 py-6 text-sm text-gray-400">
            Stores appear here after your first confirmed receipt.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {storesList.map((store) => (
              <StoreProfileEditor key={store.id} store={store} onSaved={loadStores} />
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow">
        <h2 className="font-semibold px-6 py-4 border-b border-gray-100">Users</h2>
        <ul className="divide-y divide-gray-100">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between px-6 py-3">
              <div>
                <p className="text-sm font-medium">{u.name}</p>
                <p className="text-xs text-gray-400">{u.email}</p>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                u.role === 'admin' ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {u.role}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
