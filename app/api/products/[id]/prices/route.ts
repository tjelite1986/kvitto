import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { products, stores, manualPrices } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

// Hand-entered price observations for a product (no scanned receipt). They are
// unioned into the shared price history — see lib/db/queries/prices.ts.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const productId = Number(params.id);
  const product = db.select().from(products).where(eq(products.id, productId)).get();
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  const storeId = Number(body.storeId);
  if (!Number.isFinite(storeId) || !db.select().from(stores).where(eq(stores.id, storeId)).get()) {
    return NextResponse.json({ error: 'A valid store is required' }, { status: 400 });
  }

  const unitPriceOre = Math.round(Number(body.unitPriceOre));
  if (!Number.isFinite(unitPriceOre) || unitPriceOre <= 0) {
    return NextResponse.json({ error: 'Price must be a positive amount' }, { status: 400 });
  }

  const unit = body.unit === 'kg' ? 'kg' : 'pc';

  const purchaseDate = typeof body.purchaseDate === 'string' ? body.purchaseDate.trim() : '';
  if (!DATE_RE.test(purchaseDate)) {
    return NextResponse.json({ error: 'Date must be YYYY-MM-DD' }, { status: 400 });
  }

  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

  const row = db
    .insert(manualPrices)
    .values({ productId, storeId, unit, unitPriceOre, purchaseDate, note })
    .returning()
    .get();
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const productId = Number(params.id);
  const priceId = Number(req.nextUrl.searchParams.get('priceId'));
  if (!Number.isFinite(priceId)) {
    return NextResponse.json({ error: 'priceId is required' }, { status: 400 });
  }

  const row = db.select().from(manualPrices).where(eq(manualPrices.id, priceId)).get();
  if (!row || row.productId !== productId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  db.delete(manualPrices).where(eq(manualPrices.id, priceId)).run();
  return NextResponse.json({ ok: true });
}
