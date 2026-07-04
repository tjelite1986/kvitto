import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { receipts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { displayImagePath, originalImagePath } from '@/lib/storage';
import fs from 'fs';

export const dynamic = 'force-dynamic';

// Receipt images live outside public/, so they are streamed through this
// session-checked route.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = sessionUserId(session);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const receiptId = Number(params.id);
  const receipt = db
    .select({ id: receipts.id })
    .from(receipts)
    .where(and(eq(receipts.id, receiptId), eq(receipts.userId, userId)))
    .get();
  if (!receipt) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const variant = req.nextUrl.searchParams.get('v') === 'original' ? 'original' : 'display';
  const filePath = variant === 'original' ? originalImagePath(receiptId) : displayImagePath(receiptId);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  }

  const data = fs.readFileSync(filePath);
  return new NextResponse(data, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
