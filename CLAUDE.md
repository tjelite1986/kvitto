# Kvitto — Claude Code Instructions

## Stack
Next.js 14 (App Router), SQLite via better-sqlite3 + Drizzle, NextAuth JWT,
Tailwind, Tesseract OCR + Claude vision (structured outputs).
DB: `data/kvitto.db` | Container DB: `/app/data/kvitto.db`

## Conventions
- Money is ALWAYS integer öre — never floats. Format with `formatKr()` (lib/format.tsx).
- API auth: `getServerSession(authOptions)` + `sessionUserId()` in every route.
  Receipts are per-user (`getOwnedReceipt`); stores/products/prices are shared.
- `display.jpg` (≤1568 px long edge) is the canonical coordinate space for OCR
  words and item bboxes. Never compute boxes against `original.jpg`.
- No separate prices table: price history = `receipt_items JOIN receipts`
  (confirmed only), see `lib/db/queries/prices.ts`. Don't denormalize.
- better-sqlite3 does NOT support `?1` numbered params — build conditional SQL
  in JS instead.
- Learning (fingerprints, correction examples, alias decay) runs inside the
  confirm transaction in `app/api/receipts/[id]/route.ts` → `lib/learning.ts`.
- Schema changes: update `lib/db/schema.ts` AND the bootstrap in
  `lib/db/migrate.ts` (CREATE TABLE IF NOT EXISTS + guarded ALTERs).

## Parse pipeline (app/api/receipts/[id]/parse/route.ts)
upload → sharp (EXIF rotate, display ≤1568px) → tesseract TSV (swe+eng, psm 4)
→ store fingerprint detection → Claude (image + OCR text + store profile,
json_schema output) → bbox mapping (Levenshtein vs OCR lines) → alias pre-link
→ pending_review. Retry-safe: OCR is cached in `receipts.ocr_data`.

## Dev gotchas
- Host tesseract lacks Swedish: `.tessdata/` in the project root has
  swe+eng traineddata AND `configs/` (tsv config) — without configs/ the TSV
  output silently becomes empty ("Can't open tsv").
- Dev server: `PORT=3001 npm start` (port 3000 is kundbeställning's).
- Test login: tjelite1986@gmail.com / (same pw as elite-v2 accounts).
- Synthetic test receipts: sharp can rasterize an SVG receipt; tesseract reads
  it fine (see scratchpad make-receipt.js pattern).

## Deploy
```bash
git push origin master   # CI builds ghcr.io/tjelite1986/kvitto (multi-arch)
cd /home/thomas/docker2/compose/kvitto && docker compose pull && docker compose up -d
```
Never `docker compose build` — the image comes from CI. Traefik serves
https://kvitto.mecloud.win. Volume `kvitto_data:/app/data` = db + receipt images.
Verify after deploy: `docker exec kvitto tesseract --list-langs` shows `swe`.
