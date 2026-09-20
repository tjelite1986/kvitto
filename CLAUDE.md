# Kvitto — Claude Code Instructions

## Stack
Next.js 14 (App Router), SQLite via better-sqlite3 + Drizzle, NextAuth JWT,
Tailwind, Tesseract OCR + poppler (pdftoppm) + Claude vision (structured outputs).
Tests: `npm test` (vitest — local-parser, matching, units).
DB: `data/kvitto.db` | Container DB: `/app/data/kvitto.db`

## Conventions
- Money is ALWAYS an integer in the receipt's minor unit — never floats. SEK öre,
  euro/dollar cents; `receipts.currency` says which. Format with
  `formatMoney(minor, currency)` (lib/format.tsx). `formatKr()` is a leftover
  SEK-only helper with no callers — don't reach for it.
- Receipt total is a checksum, and fees are part of it:
  `sum(items) + delivery_fee_ore + service_fee_ore - pant_return_ore === total_ore`.
  The local parser only accepts a parse that balances (lib/local-parser.ts).
- Pant never becomes its own item row: a deposit charge is `receipt_items.pant_ore`
  on the line it belongs to, a PANTRETUR refund is receipt-level
  `receipts.pant_return_ore` (positive, subtracted). `is_pant` is legacy rows only.
- API auth: `getServerSession(authOptions)` + `sessionUserId()` in every route.
  Receipts are per-user (`getOwnedReceipt`); stores/products/prices are shared.
- `display.jpg` (≤1568 px long edge) is the canonical coordinate space for OCR
  words and item bboxes. Never compute boxes against `original.jpg`.
- No separate price table to keep in sync: price history is confirmed
  `receipt_items JOIN receipts` UNIONed with hand-entered `manual_prices`
  (receipt_id NULL), ranked together — see `lib/db/queries/prices.ts`.
  Don't denormalize.
- better-sqlite3 does NOT support `?1` numbered params — build conditional SQL
  in JS instead.
- Learning (store keyword rules, fingerprints, correction examples, alias decay)
  runs inside the confirm transaction in `app/api/receipts/[id]/route.ts` →
  `lib/learning.ts` + `learnStoreKeyword()`.
- Schema changes: update `lib/db/schema.ts` AND `lib/db/bootstrap.ts`
  (CREATE TABLE IF NOT EXISTS + `addColumnIfMissing` guarded ALTERs).
  `bootstrapSchema()` runs at app startup from `lib/db/index.ts`, so a fresh
  container/volume needs no migrate step; `lib/db/migrate.ts` is just a manual
  CLI wrapper around it.

## Parse modes (parse route body {mode})
- `auto` (default): lib/local-parser.ts first — rule-based, free, on-device;
  accepted only when the items balance against the printed total (see the
  checksum above). Falls back to AI otherwise.
- `local`: local only, never calls an API (result kept even on mismatch).
- `ai`: force the AI parser. `manual`: OCR only, zero items (word-tap entry).
- Parser used is stored in claude_raw JSON (`parser`) and shown as a badge
  in review, with a "Re-read with AI" button for local/manual results.

## Parser providers (lib/claude.ts)
- OPENROUTER_API_KEY set → OpenRouter chat/completions (OpenAI format,
  `response_format: json_schema strict`), model `OPENROUTER_MODEL`
  (default `anthropic/claude-haiku-4.5`). This is what production uses —
  the direct Anthropic key has no credits.
- Else ANTHROPIC_API_KEY → Anthropic SDK with `output_config.format`.
- `PARSER_PROVIDER=anthropic` forces the direct API when both keys exist.

## Upload + parse pipeline
Upload (`app/api/receipts/route.ts`): the file type is decided by sniffing the
bytes, not the MIME type or extension. `%PDF-` → `pdftoppm -jpeg -r 200` renders
page 1 and the PDF is kept as `original.pdf`; otherwise sharp (EXIF rotate,
display ≤1568 px). The picker's filename is stored in `original_filename`.
Parse (`app/api/receipts/[id]/parse/route.ts`): tesseract TSV (swe+eng, psm 4)
→ store detection (user-taught `store_keywords` first, then layout fingerprint,
then store name in the header) → local parser and/or Claude (image + OCR text +
store profile, json_schema output) → bbox mapping (Levenshtein vs OCR lines) →
alias pre-link → pending_review. Retry-safe: OCR is cached in `receipts.ocr_data`,
and a receipt stuck in `processing` with no in-flight parse is re-parsed.

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
CI builds amd64 and arm64 on native runners (no QEMU) and merges the digests
into one manifest, so `latest` only moves when both arches are built.
Never `docker compose build` — the image comes from CI. Traefik serves
https://kvitto.mecloud.win. Volume `kvitto_data:/app/data` = db + receipt images.
Verify after deploy: `docker exec kvitto tesseract --list-langs` shows `swe`.
