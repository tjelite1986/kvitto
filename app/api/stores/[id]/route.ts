import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { stores, storeProfiles, storeFingerprints } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { coerceChannel, coerceCategory } from '@/lib/store-categories';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storeId = Number(params.id);
  const store = db.select().from(stores).where(eq(stores.id, storeId)).get();
  if (!store) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const profile = db
    .select()
    .from(storeProfiles)
    .where(eq(storeProfiles.storeId, storeId))
    .get();
  const fingerprints = db
    .select()
    .from(storeFingerprints)
    .where(eq(storeFingerprints.storeId, storeId))
    .all();

  let examples: unknown[] = [];
  try {
    examples = profile ? JSON.parse(profile.examples) : [];
  } catch {
    examples = [];
  }

  return NextResponse.json({
    ...store,
    layoutHints: profile?.layoutHints ?? '',
    examples,
    fingerprints: fingerprints.map((f) => ({
      id: f.id,
      normalizedHeader: f.normalizedHeader,
      createdAt: f.createdAt,
    })),
  });
}

// Update store metadata (name, city, channel, category) and/or the manually
// editable layout hints. Metadata is open to any authenticated user (stores are
// shared, like keyword rules); layout hints stay admin-only as they steer the
// parse prompt. Every field is optional — only provided keys are changed.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storeId = Number(params.id);
  const store = db.select().from(stores).where(eq(stores.id, storeId)).get();
  if (!store) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { name, city, channel, category, layoutHints } = body;

  const patch: Partial<{ name: string; city: string | null; channel: 'physical' | 'online' | null; category: string | null }> = {};
  if (typeof name === 'string') {
    if (!name.trim()) {
      return NextResponse.json({ error: 'Store name cannot be empty' }, { status: 400 });
    }
    patch.name = name.trim();
  }
  if ('city' in body) patch.city = typeof city === 'string' && city.trim() ? city.trim() : null;
  if ('channel' in body) patch.channel = coerceChannel(channel);
  if ('category' in body) patch.category = coerceCategory(category);

  if (Object.keys(patch).length > 0) {
    try {
      db.update(stores).set(patch).where(eq(stores.id, storeId)).run();
    } catch (e: any) {
      if (e.message?.includes('UNIQUE')) {
        return NextResponse.json({ error: 'Store already exists' }, { status: 409 });
      }
      throw e;
    }
  }

  if (typeof layoutHints === 'string') {
    if (session?.user?.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can edit layout hints' }, { status: 403 });
    }
    const profile = db
      .select()
      .from(storeProfiles)
      .where(eq(storeProfiles.storeId, storeId))
      .get();
    if (profile) {
      db.update(storeProfiles)
        .set({ layoutHints, updatedAt: new Date().toISOString() })
        .where(eq(storeProfiles.id, profile.id))
        .run();
    } else {
      db.insert(storeProfiles).values({ storeId, layoutHints }).run();
    }
  }

  return NextResponse.json({ ok: true });
}
