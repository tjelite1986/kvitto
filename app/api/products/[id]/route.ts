import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { products } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { priceHistory } from '@/lib/db/queries/prices';
import { normalizeAmountFields } from '@/lib/units';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const productId = Number(params.id);
  const product = db.select().from(products).where(eq(products.id, productId)).get();
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const history = priceHistory(productId);
  const priceValues = history.map((h) => h.unitPriceOre);
  const stats =
    priceValues.length > 0
      ? {
          minOre: Math.min(...priceValues),
          maxOre: Math.max(...priceValues),
          avgOre: Math.round(priceValues.reduce((a, b) => a + b, 0) / priceValues.length),
        }
      : null;

  return NextResponse.json({ ...product, history, stats });
}

// Edit product metadata: name, brand, category, package amount.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const productId = Number(params.id);
  const existing = db.select().from(products).where(eq(products.id, productId)).get();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const patch: Partial<typeof products.$inferInsert> = {};

  if ('name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
    }
    patch.name = body.name.trim();
  }
  if ('brand' in body) {
    patch.brand = typeof body.brand === 'string' && body.brand.trim() ? body.brand.trim() : null;
  }
  if ('category' in body) {
    patch.category =
      typeof body.category === 'string' && body.category.trim() ? body.category.trim() : null;
  }
  if ('amountValue' in body || 'amountUnit' in body) {
    const amount = normalizeAmountFields(body.amountValue, body.amountUnit);
    if (!amount.ok) return NextResponse.json({ error: amount.error }, { status: 400 });
    patch.amountValue = amount.value;
    patch.amountUnit = amount.unit;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(existing);
  }

  try {
    const updated = db
      .update(products)
      .set(patch)
      .where(eq(products.id, productId))
      .returning()
      .get();
    return NextResponse.json(updated);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'A product with that name already exists' }, { status: 409 });
    }
    throw e;
  }
}
