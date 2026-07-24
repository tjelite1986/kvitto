import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { receipts, stores } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import { ensureReceiptDir, originalImagePath, displayImagePath, deleteReceiptDir, receiptDir } from '@/lib/storage';
import sharp from 'sharp';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execFileAsync = promisify(execFile);

export const dynamic = 'force-dynamic';

const MAX_SIZE = 15 * 1024 * 1024;

/**
 * Rasterize the first page of a PDF receipt (e.g. a Kivra e-receipt) to a
 * JPEG buffer via poppler's pdftoppm. The original PDF is kept in the
 * receipt directory for reference.
 */
async function pdfToImageBuffer(pdfBuffer: Buffer, dir: string): Promise<Buffer> {
  const pdfPath = path.join(dir, 'original.pdf');
  fs.writeFileSync(pdfPath, pdfBuffer);
  const outPrefix = path.join(dir, 'pdf-page');
  await execFileAsync(
    'pdftoppm',
    ['-jpeg', '-r', '200', '-f', '1', '-l', '1', '-singlefile', pdfPath, outPrefix],
    { timeout: 30_000 }
  );
  const jpegPath = `${outPrefix}.jpg`;
  const buffer = fs.readFileSync(jpegPath);
  fs.unlinkSync(jpegPath);
  return buffer;
}
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
      channel: receipts.channel,
      originalFilename: receipts.originalFilename,
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
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File is too large (max 15 MB).' }, { status: 400 });
  }

  let buffer: Buffer = Buffer.from(await file.arrayBuffer());

  // Detect the actual content instead of trusting MIME type or filename —
  // Android pickers often deliver files with a generic type and no extension.
  const isPdf = buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  if (!isPdf) {
    try {
      const meta = await sharp(buffer).metadata();
      if (meta.format === 'heif') {
        return NextResponse.json(
          { error: 'HEIC is not supported. Set your camera to JPEG, or upload a JPEG/PNG/WebP image.' },
          { status: 400 }
        );
      }
      if (!['jpeg', 'png', 'webp', 'gif', 'tiff', 'avif'].includes(meta.format ?? '')) {
        return NextResponse.json(
          { error: 'Unsupported file type. Use JPEG, PNG, WebP or PDF.' },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'Could not read the file as an image or PDF.' },
        { status: 400 }
      );
    }
  }

  // Keep the picker's file name (e.g. "Kvitto-1.pdf") for display. Some
  // Android pickers report an empty or generic name — store what we get.
  const originalFilename = typeof file.name === 'string' && file.name.trim()
    ? file.name.trim().slice(0, 255)
    : null;

  const receipt = db
    .insert(receipts)
    .values({ userId, imagePath: '', originalFilename, status: 'uploaded' })
    .returning()
    .get();

  try {
    ensureReceiptDir(receipt.id);

    if (isPdf) {
      buffer = await pdfToImageBuffer(buffer, receiptDir(receipt.id));
    }

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
