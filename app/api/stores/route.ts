import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { db, sqlite } from '@/lib/db';
import { stores } from '@/lib/db/schema';
import { coerceChannel, coerceCategory } from '@/lib/store-categories';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = sqlite
    .prepare(
      `SELECT s.id, s.name, s.city, s.channel, s.category,
              (SELECT COUNT(*) FROM store_fingerprints f WHERE f.store_id = s.id) AS fingerprints,
              (SELECT COUNT(*) FROM store_keywords k WHERE k.store_id = s.id) AS keywords,
              (SELECT COUNT(*) FROM receipts r WHERE r.store_id = s.id AND r.status = 'confirmed') AS receipts,
              COALESCE(p.layout_hints, '') AS layoutHints,
              COALESCE(p.examples, '[]') AS examples
       FROM stores s
       LEFT JOIN store_profiles p ON p.store_id = s.id
       ORDER BY s.name`
    )
    .all() as Array<{
    id: number;
    name: string;
    city: string | null;
    channel: string | null;
    category: string | null;
    fingerprints: number;
    keywords: number;
    receipts: number;
    layoutHints: string;
    examples: string;
  }>;

  return NextResponse.json(
    rows.map((r) => ({ ...r, exampleCount: JSON.parse(r.examples).length, examples: undefined }))
  );
}

// Create a store ahead of time, before any receipt from it is scanned.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { name, city, channel, category } = await req.json();
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Store name is required' }, { status: 400 });
  }

  try {
    const store = db
      .insert(stores)
      .values({
        name: name.trim(),
        city: typeof city === 'string' && city.trim() ? city.trim() : null,
        channel: coerceChannel(channel),
        category: coerceCategory(category),
      })
      .returning()
      .get();
    return NextResponse.json(store);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Store already exists' }, { status: 409 });
    }
    throw e;
  }
}
