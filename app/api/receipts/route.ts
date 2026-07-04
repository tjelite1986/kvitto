import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { receipts, stores } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import { ensureReceiptDir, originalImagePath, displayImagePath, deleteReceiptDir } from '@/lib/storage';
import sharp from 'sharp';

export const dynamic = 'force-dynamic';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 15 * 1024 * 1024;
// Claude vision works best at <= 1568 px on the long edge; this derivative is
// also the canonical coordinate space for OCR words and item bounding boxes.
const DISPLAY_LONG_EDGE = 1568;

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = sessionUserId(session);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = db
    .select({
      id: receipts.id,
      storeId: receipts.storeId,
      storeName: stores.name,
      purchaseDate: receipts.purchaseDate,
      purchaseTime: receipts.purchaseTime,
      totalOre: receipts.totalOre,
      status: receipts.status,
      createdAt: receipts.createdAt,
    })
    .from(receipts)
    .leftJoin(stores, eq(receipts.storeId, stores.id))
    .where(eq(receipts.userId, userId))
    .orderBy(desc(receipts.createdAt))
    .all();

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = sessionUserId(session);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('image');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No image provided' }, { status: 400 });
  }
  if (file.name?.toLowerCase().endsWith('.heic') || file.type === 'image/heic' || file.type === 'image/heif') {
    return NextResponse.json(
      { error: 'HEIC is not supported. Set your camera to JPEG, or upload a JPEG/PNG/WebP image.' },
      { status: 400 }
    );
  }
  if (!ALLOWED_MIME.includes(file.type)) {
    return NextResponse.json({ error: 'Unsupported image type. Use JPEG, PNG or WebP.' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'Image is too large (max 15 MB).' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const receipt = db
    .insert(receipts)
    .values({ userId, imagePath: '', status: 'uploaded' })
    .returning()
    .get();

  try {
    ensureReceiptDir(receipt.id);

    // .rotate() applies EXIF orientation so stored pixels match what the user saw.
    const original = sharp(buffer).rotate();
    await original.jpeg({ quality: 90 }).toFile(originalImagePath(receipt.id));

    const display = await sharp(buffer)
      .rotate()
      .resize(DISPLAY_LONG_EDGE, DISPLAY_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(displayImagePath(receipt.id));

    db.update(receipts)
      .set({
        imagePath: `receipts/${receipt.id}`,
        imageWidth: display.width,
        imageHeight: display.height,
      })
      .where(eq(receipts.id, receipt.id))
      .run();

    return NextResponse.json({ id: receipt.id });
  } catch (e) {
    deleteReceiptDir(receipt.id);
    db.delete(receipts).where(eq(receipts.id, receipt.id)).run();
    console.error('Receipt upload failed:', e);
    return NextResponse.json({ error: 'Could not process the image.' }, { status: 500 });
  }
}
