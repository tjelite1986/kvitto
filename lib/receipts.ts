import { db } from '@/lib/db';
import { receipts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

/** Fetch a receipt only if it belongs to the given user. */
export function getOwnedReceipt(receiptId: number, userId: number) {
  if (!Number.isInteger(receiptId)) return undefined;
  return db
    .select()
    .from(receipts)
    .where(and(eq(receipts.id, receiptId), eq(receipts.userId, userId)))
    .get();
}
