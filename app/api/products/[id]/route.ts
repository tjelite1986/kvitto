import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { products } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { priceHistory } from '@/lib/db/queries/prices';

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
