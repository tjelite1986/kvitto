import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { receipts, receiptItems, productAliases } from '@/lib/db/schema';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getOwnedReceipt } from '@/lib/receipts';
import { displayImagePath } from '@/lib/storage';
import { runOcr, type OcrResult } from '@/lib/ocr';
import { parseReceiptWithClaude } from '@/lib/claude';
import { computeHeader, detectStore, loadStoreContext } from '@/lib/store-detection';
import { bestMatch, normalizeAlias } from '@/lib/matching';
import fs from 'fs';

export const dynamic = 'force-dynamic';
// Parse takes 10-30s on the Pi (tesseract + Claude API); this stays a plain
// awaited route on purpose. Retry-safe: a failed/stuck receipt is re-POSTed.
// If timeouts ever bite, the upgrade path is status polling on 'processing'.
export const maxDuration = 120;

const BBOX_MATCH_THRESHOLD = 0.6;
const ALIAS_MIN_CONFIDENCE = 0.9;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = sessionUserId(session);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const receipt = getOwnedReceipt(Number(params.id), userId);
  if (!receipt) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (receipt.status === 'confirmed') {
    return NextResponse.json({ error: 'Receipt is already confirmed' }, { status: 400 });
  }
  if (receipt.status === 'processing') {
    return NextResponse.json({ error: 'Parse already in progress' }, { status: 409 });
  }

  db.update(receipts)
    .set({ status: 'processing', errorMessage: null })
    .where(eq(receipts.id, receipt.id))
    .run();

  try {
    // Step 1: OCR (skipped on retry when ocr_data already exists)
    let ocr: OcrResult;
    if (receipt.ocrData) {
      ocr = JSON.parse(receipt.ocrData);
    } else {
      ocr = await runOcr(displayImagePath(receipt.id));
      db.update(receipts)
        .set({ ocrData: JSON.stringify(ocr) })
        .where(eq(receipts.id, receipt.id))
        .run();
    }

    // Step 2: store detection via header fingerprint
    const header = computeHeader(ocr.lines);
    const detection = detectStore(header);
    const storeContext = detection ? loadStoreContext(detection.storeId) : null;

    // Step 3: Claude vision + OCR text -> structured receipt
    const imageBase64 = fs.readFileSync(displayImagePath(receipt.id)).toString('base64');
    const { parsed } = await parseReceiptWithClaude(imageBase64, ocr.text, storeContext);

    // Step 4: sanity check items vs total
    const computedSum = parsed.items.reduce((sum, item) => {
      const effective =
        item.offer_qty && item.offer_total_ore != null
          ? item.offer_total_ore
          : item.line_total_ore;
      return sum + effective - item.discount_ore + (item.pant_ore || 0);
    }, 0);
    const totalMismatch =
      parsed.total_ore != null && Math.abs(computedSum - parsed.total_ore) > 1;

    // Step 5: map items to OCR line bounding boxes
    const lineTexts = ocr.lines.map((l) => l.text);
    const itemsToInsert = parsed.items.map((item, index) => {
      let bbox: string | null = null;
      const query = item.source_lines[0] ?? item.name;
      const match = bestMatch(query, lineTexts, BBOX_MATCH_THRESHOLD);
      if (match) {
        const line = ocr.lines[match.index];
        bbox = JSON.stringify({ x: line.x, y: line.y, w: line.w, h: line.h });
      }

      // Pre-link product via alias (store-specific first, then global)
      let productId: number | null = null;
      const alias = normalizeAlias(item.name);
      if (alias) {
        const storeAlias = detection
          ? db
              .select()
              .from(productAliases)
              .where(
                and(
                  eq(productAliases.storeId, detection.storeId),
                  eq(productAliases.aliasText, alias)
                )
              )
              .get()
          : undefined;
        const globalAlias =
          storeAlias ??
          db
            .select()
            .from(productAliases)
            .where(and(isNull(productAliases.storeId), eq(productAliases.aliasText, alias)))
            .get();
        if (globalAlias && globalAlias.confidence >= ALIAS_MIN_CONFIDENCE) {
          productId = globalAlias.productId;
        }
      }

      return {
        receiptId: receipt.id,
        lineNo: index,
        rawText: item.name,
        productId,
        qty: item.qty,
        unit: item.unit,
        unitPriceOre: item.unit_price_ore,
        lineTotalOre: item.line_total_ore,
        offerQty: item.offer_qty,
        offerTotalOre: item.offer_total_ore,
        discountOre: item.discount_ore,
        pantOre: item.pant_ore || 0,
        bbox,
      };
    });

    // Step 6: persist result
    db.delete(receiptItems).where(eq(receiptItems.receiptId, receipt.id)).run();
    for (const item of itemsToInsert) {
      db.insert(receiptItems).values(item).run();
    }
    db.update(receipts)
      .set({
        storeId: detection?.storeId ?? null,
        purchaseDate: parsed.purchase_date,
        purchaseTime: parsed.purchase_time,
        totalOre: parsed.total_ore,
        claudeRaw: JSON.stringify({ parsed, totalMismatch, detection }),
        status: 'pending_review',
      })
      .where(eq(receipts.id, receipt.id))
      .run();

    const items = db
      .select()
      .from(receiptItems)
      .where(eq(receiptItems.receiptId, receipt.id))
      .orderBy(asc(receiptItems.lineNo))
      .all();

    return NextResponse.json({
      status: 'pending_review',
      storeName: detection?.storeName ?? parsed.store_name,
      storeId: detection?.storeId ?? null,
      storeConfidence: detection?.confidence ?? null,
      purchaseDate: parsed.purchase_date,
      purchaseTime: parsed.purchase_time,
      totalOre: parsed.total_ore,
      totalMismatch,
      items,
    });
  } catch (e) {
    console.error('Receipt parse failed:', e);
    db.update(receipts)
      .set({
        status: 'failed',
        errorMessage: e instanceof Error ? e.message : 'Unknown parse error',
      })
      .where(eq(receipts.id, receipt.id))
      .run();
    return NextResponse.json({ error: 'Parse failed. You can retry.' }, { status: 500 });
  }
}
