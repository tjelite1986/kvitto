import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { sqlite } from '@/lib/db';
import { normalizeAlias } from '@/lib/matching';

export const dynamic = 'force-dynamic';

// Merge several duplicate products into one canonical product. All receipt
// items and receipt-name aliases from the source products are moved onto the
// target, the source product names are kept as global aliases so future scans
// still auto-link, and the now-empty source products are deleted. One
// transaction — either the whole merge lands or nothing does.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const targetId = Number(body.targetId);
  const sourceIds = Array.isArray(body.sourceIds)
    ? Array.from(new Set(body.sourceIds.map(Number).filter((n: number) => Number.isFinite(n))))
    : [];

  if (!Number.isFinite(targetId)) {
    return NextResponse.json({ error: 'targetId is required' }, { status: 400 });
  }
  const sources = sourceIds.filter((id) => id !== targetId);
  if (sources.length === 0) {
    return NextResponse.json({ error: 'At least one source product is required' }, { status: 400 });
  }

  const getProduct = sqlite.prepare('SELECT id, name FROM products WHERE id = ?');
  const target = getProduct.get(targetId) as { id: number; name: string } | undefined;
  if (!target) {
    return NextResponse.json({ error: 'Target product not found' }, { status: 404 });
  }
  for (const id of sources) {
    if (!getProduct.get(id)) {
      return NextResponse.json({ error: `Source product ${id} not found` }, { status: 404 });
    }
  }

  const merge = sqlite.transaction(() => {
    // Live set of the target's (storeId, aliasText) keys to avoid violating the
    // unique(store_id, alias_text) index while retargeting.
    const key = (storeId: number | null, aliasText: string) => `${storeId ?? ''}::${aliasText}`;
    const existing = sqlite
      .prepare('SELECT store_id AS storeId, alias_text AS aliasText FROM product_aliases WHERE product_id = ?')
      .all(targetId) as Array<{ storeId: number | null; aliasText: string }>;
    const seen = new Set(existing.map((a) => key(a.storeId, a.aliasText)));

    const moveItems = sqlite.prepare('UPDATE receipt_items SET product_id = ? WHERE product_id = ?');
    const retargetAlias = sqlite.prepare('UPDATE product_aliases SET product_id = ? WHERE id = ?');
    const dropAlias = sqlite.prepare('DELETE FROM product_aliases WHERE id = ?');
    const insertAlias = sqlite.prepare(
      `INSERT INTO product_aliases (product_id, store_id, alias_text, confidence, source)
       VALUES (?, NULL, ?, 1, 'manual')`
    );
    const deleteProduct = sqlite.prepare('DELETE FROM products WHERE id = ?');

    let movedItems = 0;
    for (const sourceId of sources) {
      const source = getProduct.get(sourceId) as { id: number; name: string };

      movedItems += moveItems.run(targetId, sourceId).changes;

      const sourceAliases = sqlite
        .prepare('SELECT id, store_id AS storeId, alias_text AS aliasText FROM product_aliases WHERE product_id = ?')
        .all(sourceId) as Array<{ id: number; storeId: number | null; aliasText: string }>;
      for (const alias of sourceAliases) {
        const k = key(alias.storeId, alias.aliasText);
        if (seen.has(k)) {
          dropAlias.run(alias.id); // target already has this alias
        } else {
          retargetAlias.run(targetId, alias.id);
          seen.add(k);
        }
      }

      // Keep the merged product's own name as a global alias so a future
      // receipt printed with that name still links to the target.
      const nameAlias = normalizeAlias(source.name);
      if (nameAlias && !seen.has(key(null, nameAlias))) {
        insertAlias.run(targetId, nameAlias);
        seen.add(key(null, nameAlias));
      }

      deleteProduct.run(sourceId); // cascade removes any leftover aliases
    }
    return movedItems;
  });

  const movedItems = merge();
  return NextResponse.json({ ok: true, targetId, merged: sources.length, movedItems });
}
