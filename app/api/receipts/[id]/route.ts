import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, sessionUserId } from '@/lib/auth';
import { db } from '@/lib/db';
import { receipts, receiptItems, stores, products } from '@/lib/db/schema';
import { asc, eq } from 'drizzle-orm';
import { deleteReceiptDir } from '@/lib/storage';
import { getOwnedReceipt } from '@/lib/receipts';
import { sqlite } from '@/lib/db';
import { productAliases } from '@/lib/db/schema';
import { normalizeAlias } from '@/lib/matching';
import {
  learnFingerprint,
  learnCorrections,
  decayOverriddenAliases,
  parsedItemsFromRaw,
} from '@/lib/learning';
import { learnStoreKeyword } from '@/lib/store-detection';
import { coerceChannel, coerceCategory } from '@/lib/store-categories';

export const dynamic = 'force-dynamic';

interface ConfirmItem {
  rawText: string;
  productId?: number | null;
  qty: number;
  unit: 'pc' | 'kg';
  unitPriceOre?: number | null;
  lineTotalOre: number;
  offerQty?: number | null;
  offerTotalOre?: number | null;
  discountOre?: number;
  pantOre?: number;
  bbox?: string | null;
}

// Confirm a reviewed receipt: replace items, set store/date/total, mark confirmed.
// Learning writes (fingerprints, correction examples, aliases) are added in M5.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = sessionUserId(session);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const receipt = getOwnedReceipt(Number(params.id), userId);
  if (!receipt) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const {
    storeId, storeName, purchaseDate, purchaseTime, totalOre,
    pantReturnOre, receiptNumber, deliveryFeeOre, serviceFeeOre, storeKeyword,
    storeChannel, storeCategory,
  } = body;
  const items: ConfirmItem[] = Array.isArray(body.items) ? body.items : [];

  if (items.length === 0) {
    return NextResponse.json({ error: 'At least one item is required' }, { status: 400 });
  }
  for (const item of items) {
    if (!item.rawText || typeof item.lineTotalOre !== 'number') {
      return NextResponse.json(
        { error: 'Every item needs a name and a line total' },
        { status: 400 }
      );
    }
  }

  const confirm = sqlite.transaction(() => {
    // Classification carried from the review form onto the resolved store.
    // Only applied when the client sent the field (so blank forms never wipe
    // an existing store's channel/category).
    const channel = 'storeChannel' in body ? coerceChannel(storeChannel) : undefined;
    const category = 'storeCategory' in body ? coerceCategory(storeCategory) : undefined;
    const storePatch: { channel?: 'physical' | 'online' | null; category?: string | null } = {};
    if (channel !== undefined) storePatch.channel = channel;
    if (category !== undefined) storePatch.category = category;

    // Resolve store: existing id, or create by name
    let resolvedStoreId: number | null = null;
    if (typeof storeId === 'number') {
      resolvedStoreId = storeId;
    } else if (typeof storeName === 'string' && storeName.trim()) {
      const name = storeName.trim();
      const existing = db.select().from(stores).where(eq(stores.name, name)).get();
      resolvedStoreId = existing
        ? existing.id
        : db.insert(stores).values({ name, ...storePatch }).returning().get().id;
    }

    // Keep the store's channel/category in sync with the review form.
    if (resolvedStoreId != null && Object.keys(storePatch).length > 0) {
      db.update(stores).set(storePatch).where(eq(stores.id, resolvedStoreId)).run();
    }

    // Decay wrong auto-links before the parse-time items are replaced
    decayOverriddenAliases(receipt.id, resolvedStoreId, items);

    db.delete(receiptItems).where(eq(receiptItems.receiptId, receipt.id)).run();
    items.forEach((item, index) => {
      db.insert(receiptItems)
        .values({
          receiptId: receipt.id,
          lineNo: index,
          rawText: item.rawText,
          productId: item.productId ?? null,
          qty: item.qty ?? 1,
          unit: item.unit === 'kg' ? 'kg' : 'pc',
          unitPriceOre: item.unitPriceOre ?? null,
          lineTotalOre: item.lineTotalOre,
          offerQty: item.offerQty ?? null,
          offerTotalOre: item.offerTotalOre ?? null,
          discountOre: item.discountOre ?? 0,
          pantOre: item.pantOre ?? 0,
          bbox: item.bbox ?? null,
        })
        .run();
    });

    // Learn product aliases from manual links: "this printed text means that
    // product at this store". Future parses use them to pre-link items.
    for (const item of items) {
      if (!item.productId) continue;
      const aliasText = normalizeAlias(item.rawText);
      if (!aliasText) continue;

      // NULL store ids bypass the unique index, so match in JS instead of SQL.
      const existing = db
        .select()
        .from(productAliases)
        .where(eq(productAliases.aliasText, aliasText))
        .all()
        .find((a) => a.storeId === resolvedStoreId);

      if (existing) {
        if (existing.productId !== item.productId || existing.confidence < 1) {
          db.update(productAliases)
            .set({ productId: item.productId, confidence: 1, source: 'manual' })
            .where(eq(productAliases.id, existing.id))
            .run();
        }
      } else {
        db.insert(productAliases)
          .values({
            productId: item.productId,
            storeId: resolvedStoreId,
            aliasText,
            confidence: 1,
            source: 'manual',
          })
          .run();
      }
    }

    // Store-level learning: fingerprint the layout and capture corrections
    // as few-shot examples for future parses at this store.
    if (resolvedStoreId != null) {
      // User-taught keyword rule (marking the store text on the receipt).
      if (typeof storeKeyword === 'string' && storeKeyword.trim()) {
        try {
          learnStoreKeyword(resolvedStoreId, storeKeyword.trim());
        } catch (e) {
          console.error('Store keyword learning failed:', e);
        }
      }
      if (receipt.ocrData) {
        try {
          learnFingerprint(resolvedStoreId, JSON.parse(receipt.ocrData));
        } catch (e) {
          console.error('Fingerprint learning failed:', e);
        }
      }
      try {
        learnCorrections(
          resolvedStoreId,
          parsedItemsFromRaw(receipt.claudeRaw),
          items.map((item) => ({
            rawText: item.rawText,
            qty: item.qty ?? 1,
            unit: item.unit === 'kg' ? 'kg' : 'pc',
            unitPriceOre: item.unitPriceOre ?? null,
            lineTotalOre: item.lineTotalOre,
            offerQty: item.offerQty ?? null,
            offerTotalOre: item.offerTotalOre ?? null,
            discountOre: item.discountOre ?? 0,
            pantOre: item.pantOre ?? 0,
          }))
        );
      } catch (e) {
        console.error('Correction learning failed:', e);
      }
    }

    db.update(receipts)
      .set({
        storeId: resolvedStoreId,
        purchaseDate: typeof purchaseDate === 'string' ? purchaseDate : null,
        purchaseTime: typeof purchaseTime === 'string' && purchaseTime ? purchaseTime : null,
        receiptNumber: typeof receiptNumber === 'string' && receiptNumber.trim() ? receiptNumber.trim() : null,
        totalOre: typeof totalOre === 'number' ? totalOre : null,
        pantReturnOre: typeof pantReturnOre === 'number' ? pantReturnOre : 0,
        deliveryFeeOre: typeof deliveryFeeOre === 'number' ? deliveryFeeOre : 0,
        serviceFeeOre: typeof serviceFeeOre === 'number' ? serviceFeeOre : 0,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
      })
      .where(eq(receipts.id, receipt.id))
      .run();

    return resolvedStoreId;
  });

  const resolvedStoreId = confirm();

  return NextResponse.json({ ok: true, storeId: resolvedStoreId });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = sessionUserId(session);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const receipt = getOwnedReceipt(Number(params.id), userId);
  if (!receipt) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const store = receipt.storeId
    ? db.select().from(stores).where(eq(stores.id, receipt.storeId)).get()
    : null;

  const items = db
    .select({
      id: receiptItems.id,
      lineNo: receiptItems.lineNo,
      rawText: receiptItems.rawText,
      productId: receiptItems.productId,
      productName: products.name,
      qty: receiptItems.qty,
      unit: receiptItems.unit,
      unitPriceOre: receiptItems.unitPriceOre,
      lineTotalOre: receiptItems.lineTotalOre,
      offerQty: receiptItems.offerQty,
      offerTotalOre: receiptItems.offerTotalOre,
      discountOre: receiptItems.discountOre,
      pantOre: receiptItems.pantOre,
      isPant: receiptItems.isPant,
      bbox: receiptItems.bbox,
    })
    .from(receiptItems)
    .leftJoin(products, eq(receiptItems.productId, products.id))
    .where(eq(receiptItems.receiptId, receipt.id))
    .orderBy(asc(receiptItems.lineNo))
    .all();

  return NextResponse.json({
    ...receipt,
    storeName: store?.name ?? null,
    storeChannel: store?.channel ?? null,
    storeCategory: store?.category ?? null,
    items,
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = sessionUserId(session);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const receipt = getOwnedReceipt(Number(params.id), userId);
  if (!receipt) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  db.delete(receipts).where(eq(receipts.id, receipt.id)).run();
  deleteReceiptDir(receipt.id);

  return NextResponse.json({ ok: true });
}
