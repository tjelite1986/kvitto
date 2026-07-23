import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { productCategories } from '@/lib/db/schema';
import { asc, eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

// The managed, user-extensible list of product categories. Shared across users.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rows = db
    .select({ id: productCategories.id, name: productCategories.name })
    .from(productCategories)
    .orderBy(asc(productCategories.sortOrder), asc(productCategories.name))
    .all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { name } = await req.json();
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Category name is required' }, { status: 400 });
  }
  const trimmed = name.trim();

  // Case-insensitive dedup (the UNIQUE index is case-sensitive in SQLite).
  const existing = db
    .select()
    .from(productCategories)
    .where(sql`lower(${productCategories.name}) = lower(${trimmed})`)
    .get();
  if (existing) {
    return NextResponse.json({ id: existing.id, name: existing.name });
  }

  // New user categories sort after the seeded defaults.
  try {
    const row = db
      .insert(productCategories)
      .values({ name: trimmed, sortOrder: 1000 })
      .returning()
      .get();
    return NextResponse.json({ id: row.id, name: row.name });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Category already exists' }, { status: 409 });
    }
    throw e;
  }
}

// Remove a category from the pick list. Products keep their stored text value.
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  db.delete(productCategories).where(eq(productCategories.id, id)).run();
  return NextResponse.json({ ok: true });
}
