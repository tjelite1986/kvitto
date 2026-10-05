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
CI skips the build when *every* file in a push matches `paths-ignore`
(`CLAUDE.md`, `README.md`); a push that also touches code still builds.

## Working rules (every session, local or cloud)

- **Language:** everything written to a file is English: code comments, UI
  strings, API error messages, log output, README, JSON descriptions, commit
  messages. Chat with the owner in Swedish. No emojis unless asked.
- **`docs/` is local-only.** It is a scratch area between the owner and Claude,
  gitignored on purpose. Never commit it and never `git add -f` it. A cloud
  session will not see it; ask the owner to paste what you need.
- **No secrets in git:** `.env`, `.env.*`, dated backups like `.env.bak-*`,
  keys and tokens. Read `git status` before every commit.
- **Target platform:** the owner self-hosts on a Raspberry Pi (linux/arm64,
  Node 20) and an x86 Linux box, as Docker images behind Traefik. Code must
  build and run on linux/arm64 with Node 20. Check that any new native
  dependency ships arm64 builds.
- **Cloud sessions cannot reach production:** no host, no live database, no
  `.env`, no container logs. Deliver work as a branch and a PR whose
  description says how to verify it live. Deploy and live verification are
  done by the owner on the host. Do not claim something works in production.
- **Data safety:** never blanket-`DELETE` or `rm` a database or data directory
  to clean up after a test; remove only what the test created.
- **Keep diffs about the change:** do not reformat code you are not otherwise
  touching. Run `prettier --check` before `prettier --write` on an older file.
- **Archive, don't delete:** don't delete branches; tag them `archive/<name>`
  first.
