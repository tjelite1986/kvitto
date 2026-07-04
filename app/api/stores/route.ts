import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { sqlite } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!sessionUserId(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = sqlite
    .prepare(
      `SELECT s.id, s.name, s.city,
              (SELECT COUNT(*) FROM store_fingerprints f WHERE f.store_id = s.id) AS fingerprints,
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
    fingerprints: number;
    receipts: number;
    layoutHints: string;
    examples: string;
  }>;

  return NextResponse.json(
    rows.map((r) => ({ ...r, exampleCount: JSON.parse(r.examples).length, examples: undefined }))
  );
}
