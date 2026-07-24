import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { biggestPriceChanges, monthSpend } from '@/lib/db/queries/prices';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = sessionUserId(session);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return NextResponse.json({
    month,
    monthSpend: monthSpend(userId, month),
    priceChanges: biggestPriceChanges(5),
  });
}
