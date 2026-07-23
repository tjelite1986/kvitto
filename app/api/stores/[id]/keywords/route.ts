import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { stores, storeKeywords } from '@/lib/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { learnStoreKeyword } from '@/lib/store-detection';

export const dynamic = 'force-dynamic';

// List the user-taught keyword rules for a store.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storeId = Number(params.id);
  const keywords = db
    .select({ id: storeKeywords.id, keyword: storeKeywords.keyword, createdAt: storeKeywords.createdAt })
    .from(storeKeywords)
    .where(eq(storeKeywords.storeId, storeId))
    .orderBy(asc(storeKeywords.keyword))
    .all();

  return NextResponse.json(keywords);
}

// Add a keyword rule to a store.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storeId = Number(params.id);
  const store = db.select().from(stores).where(eq(stores.id, storeId)).get();
  if (!store) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { keyword } = await req.json();
  if (!keyword || typeof keyword !== 'string' || !keyword.trim()) {
    return NextResponse.json({ error: 'A keyword is required' }, { status: 400 });
  }

  learnStoreKeyword(storeId, keyword.trim());
  const keywords = db
    .select({ id: storeKeywords.id, keyword: storeKeywords.keyword, createdAt: storeKeywords.createdAt })
    .from(storeKeywords)
    .where(eq(storeKeywords.storeId, storeId))
    .orderBy(asc(storeKeywords.keyword))
    .all();
  return NextResponse.json(keywords);
}

// Delete a keyword rule (by ?keywordId=).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storeId = Number(params.id);
  const keywordId = Number(new URL(req.url).searchParams.get('keywordId'));
  if (!keywordId) {
    return NextResponse.json({ error: 'keywordId is required' }, { status: 400 });
  }

  db.delete(storeKeywords)
    .where(and(eq(storeKeywords.id, keywordId), eq(storeKeywords.storeId, storeId)))
    .run();

  return NextResponse.json({ ok: true });
}
