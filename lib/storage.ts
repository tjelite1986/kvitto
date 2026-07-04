import path from 'path';
import fs from 'fs';

// Receipt images live under data/receipts/<receiptId>/ so a single volume
// (/app/data in Docker) covers both the SQLite db and all images.

const dataDir = path.join(process.cwd(), 'data');

export function receiptDir(receiptId: number): string {
  return path.join(dataDir, 'receipts', String(receiptId));
}

export function originalImagePath(receiptId: number): string {
  return path.join(receiptDir(receiptId), 'original.jpg');
}

export function displayImagePath(receiptId: number): string {
  return path.join(receiptDir(receiptId), 'display.jpg');
}

export function ensureReceiptDir(receiptId: number): string {
  const dir = receiptDir(receiptId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function deleteReceiptDir(receiptId: number): void {
  fs.rmSync(receiptDir(receiptId), { recursive: true, force: true });
}
