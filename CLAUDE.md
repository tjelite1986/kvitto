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
- Synthetic test receipts: sharp can rasterize an SVG receipt; tesseract reads
  it fine (see scratchpad make-receipt.js pattern).

## Deploy
```bash
git push origin master   # CI builds ghcr.io/tjelite1986/kvitto (multi-arch)
cd <compose dir for kvitto on the host> && docker compose pull && docker compose up -d
```
CI builds amd64 and arm64 on native runners (no QEMU) and merges the digests
into one manifest, so `latest` only moves when both arches are built.
Never `docker compose build` — the image comes from CI. Traefik serves
the public hostname. Volume `kvitto_data:/app/data` = db + receipt images.
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

## Lessons learned

### Receipt semantics (decided with the owner, do not undo)
- PANTRETUR/RETURPANT (returning empties) is a receipt-level refund, not a purchase. It is never an item, never linkable to a product and never in price history. `PANTRETUR_RE` must be checked before the PANT and discount rules in `lib/local-parser.ts`. Why: otherwise the negative amount folds into the previous item's discount.
- A multi-buy printed as shelf price plus adjustment ("3 st x 10,00 30,00" / "3 FÖR 25,00 -5,00") is ONE item: qty 3, unit price, line total, offer 3/25,00, discount 0. Never book the same rebate in both `offer_*` and `discount_ore`.
- Per-item savings are computed (`discount_ore + max(0, line_total - offer_total)`), never stored.
- `hg` is an entry unit only: the review page converts it to kg on save (`toStoredItem()`), and the parser and AI prompt convert it too. DB and API stay `pc | kg`.
- Purchase channel is per receipt (`receipts.channel`). `stores.channel` is only a default that seeds a new store and must never be overwritten from a receipt. Why: the same store sells both in-store and online, and overwriting made it flip-flop. Store category stays store-level.
- Amounts in different currencies are never summed or compared. Price trends, latest/previous price and monthly spend are partitioned per currency (and per unit: kg and pc prices never compare).

### Local parser
- Container tesseract sometimes writes prices with inner whitespace ("29, 90"). Every money regex must allow `\s?` around the decimal separator, or the checksum fails and every receipt silently falls back to the paid AI parser.
- Fee regexes (`DELIVERY_FEE_RE`, `SERVICE_FEE_RE`) only consume a line that has a price, so addresses and phone lines that contain the same words fall through. `RECEIPT_NO_RE` requires an explicit number label and a digit-first value, so the bare "Kvitto <date>" header and the org number don't match.
- Prefer ATT BETALA/TOTALT over a SUMMA subtotal, and ignore lines after the totals section.

### AI structured output
- Anthropic's json_schema validator (direct or via OpenRouter) rejects `enum` combined with `type: ['string', 'null']`, and every parse then returns 400. For nullable choice fields, drop `enum` and list the allowed values in `description`; validate server-side. Non-null enums (like item `unit`) are fine.
- Nullable fields let the model decline: prompts say "null if unknown, never guess". Keep that; an invented brand or amount pollutes the shared product DB.
- OpenRouter and the Anthropic SDK differ in more than the base URL: image block shape, structured-output field (`response_format.json_schema` vs `output_config.format`) and how a refusal surfaces. Keep both paths in `lib/claude.ts` working. Verify an OpenRouter model id against its public model list, because a wrong id only fails at runtime.

### Database
- `receipt_items.product_id` has no cascade (FK is RESTRICT). Deleting or merging a product must null or repoint `receipt_items.product_id` first. Aliases do cascade.
- Product merge keeps each source product's name as a global alias so future scans still link, and must dedupe against the unique `(store_id, alias_text)` index.
- Seed tables (`product_categories` from `DEFAULT_PRODUCT_CATEGORIES`) only when empty; never re-seed or overwrite user edits. `products.category` stores the name as free text, so deleting a category never touches products, and `ProductCategorySelect` always injects the current value as an option so legacy or AI values aren't dropped.
- `next build` runs `bootstrapSchema()` in parallel workers against the same file. Keep the `duplicate column name` catch in `addColumnIfMissing()` and `busy_timeout` before the WAL switch; don't go back to bare guarded ALTERs.
- Parse and confirm can race. Confirm rejects while a parse is in flight, and the parse route re-checks status in a transaction before persisting, so the user's confirmed data always wins. Keep both guards when touching either route.

### Upload and rendering
- Digital PDF receipts often don't embed fonts. The runner image needs fontconfig + `font-urw-base35`, or `pdftoppm` renders blank white pages. Don't slim those packages out of the Dockerfile.

### Review UI
- Money and qty inputs keep the exact typed text while focused. Re-formatting on every keystroke swallowed digits. Empty money fields stay `null`, not 0.
- "Retry" after a failed save must not re-parse; that wiped the user's manual corrections.
- `ProductPicker` sizes its overlay from `window.visualViewport` (top/height) and the sheet uses `max-h-full`. Don't go back to `max-h-[85vh]`: the mobile keyboard doesn't shrink the layout viewport, so the sheet ends up behind it. The search input deliberately has no `autoFocus`.

### Auth and PWA
- `middleware.ts` excludes public assets by exact filename. Adding or renaming an icon, the manifest or the SW without updating the matcher puts it behind the login (the manifest was once gated this way). Icon URLs carry `?v=N`; bump it when icons change, or installed PWAs keep the old icon.
