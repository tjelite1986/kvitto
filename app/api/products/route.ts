import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { products } from '@/lib/db/schema';
import { productsWithLatestPrice } from '@/lib/db/queries/prices';
import { normalizeAmountFields, normalizeComparisonBasis } from '@/lib/units';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const search = req.nextUrl.searchParams.get('q') ?? undefined;
  return NextResponse.json(productsWithLatestPrice(search));
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { name, brand, category, amountValue, amountUnit, comparisonBasis } = await req.json();
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
  }
  const amount = normalizeAmountFields(amountValue, amountUnit);
  if (!amount.ok) {
    return NextResponse.json({ error: amount.error }, { status: 400 });
  }
  const basis = normalizeComparisonBasis(comparisonBasis);
  if (!basis.ok) {
    return NextResponse.json({ error: basis.error }, { status: 400 });
  }

  try {
    const product = db
      .insert(products)
      .values({
        name: name.trim(),
        brand: typeof brand === 'string' && brand.trim() ? brand.trim() : null,
        category: typeof category === 'string' && category.trim() ? category.trim() : null,
        amountValue: amount.value,
        amountUnit: amount.unit,
        comparisonBasis: basis.value,
      })
      .returning()
      .get();
    return NextResponse.json(product);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Product already exists' }, { status: 409 });
    }
    throw e;
  }
}
