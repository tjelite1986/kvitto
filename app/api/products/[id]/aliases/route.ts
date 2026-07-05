import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { products, productAliases, stores } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { normalizeAlias } from '@/lib/matching';

export const dynamic = 'force-dynamic';

// Receipt-name aliases for a product: how the item text is printed on
// receipts at different stores (storeId NULL = matches any store).

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const productId = Number(params.id);
  const rows = db
    .select({
      id: productAliases.id,
      aliasText: productAliases.aliasText,
      storeId: productAliases.storeId,
      storeName: stores.name,
      source: productAliases.source,
      confidence: productAliases.confidence,
    })
    .from(productAliases)
    .leftJoin(stores, eq(productAliases.storeId, stores.id))
    .where(eq(productAliases.productId, productId))
    .all();

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const productId = Number(params.id);
  const product = db.select().from(products).where(eq(products.id, productId)).get();
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const aliasText = normalizeAlias(typeof body.aliasText === 'string' ? body.aliasText : '');
  if (!aliasText) {
    return NextResponse.json({ error: 'Alias text is required' }, { status: 400 });
  }
  const storeId = typeof body.storeId === 'number' ? body.storeId : null;

  // NULL store ids bypass the unique index, so match in JS instead of SQL.
  // An existing alias (even for another product) is retargeted to this one.
  const existing = db
    .select()
    .from(productAliases)
    .where(eq(productAliases.aliasText, aliasText))
    .all()
    .find((a) => a.storeId === storeId);

  if (existing) {
    db.update(productAliases)
      .set({ productId, confidence: 1, source: 'manual' })
      .where(eq(productAliases.id, existing.id))
      .run();
    return NextResponse.json({ ...existing, productId, confidence: 1, source: 'manual' });
  }

  const alias = db
    .insert(productAliases)
    .values({ productId, storeId, aliasText, confidence: 1, source: 'manual' })
    .returning()
    .get();
  return NextResponse.json(alias);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const productId = Number(params.id);
  const aliasId = Number(req.nextUrl.searchParams.get('aliasId'));
  if (!Number.isFinite(aliasId)) {
    return NextResponse.json({ error: 'aliasId is required' }, { status: 400 });
  }

  const alias = db.select().from(productAliases).where(eq(productAliases.id, aliasId)).get();
  if (!alias || alias.productId !== productId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  db.delete(productAliases).where(eq(productAliases.id, aliasId)).run();
  return NextResponse.json({ ok: true });
}
