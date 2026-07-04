import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { products } from '@/lib/db/schema';
import { productsWithLatestPrice } from '@/lib/db/queries/prices';

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

  const { name, category } = await req.json();
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Product name is required' }, { status: 400 });
  }

  try {
    const product = db
      .insert(products)
      .values({ name: name.trim(), category: category || null })
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
