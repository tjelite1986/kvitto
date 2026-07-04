import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { stores, storeProfiles, storeFingerprints } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

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

// Update the manually editable layout hints (used in the parse prompt).
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session) || session?.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storeId = Number(params.id);
  const store = db.select().from(stores).where(eq(stores.id, storeId)).get();
  if (!store) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { layoutHints } = await req.json();
  if (typeof layoutHints !== 'string') {
    return NextResponse.json({ error: 'layoutHints must be a string' }, { status: 400 });
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

  return NextResponse.json({ ok: true });
}
