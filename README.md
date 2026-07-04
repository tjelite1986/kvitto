# Kvitto

Receipt scanner with a shared price database. Photograph a grocery receipt,
let OCR + Claude parse it into line items (unit prices, multi-buy offers,
discounts, pant), correct mistakes by tapping words directly on the receipt
image, and track how prices develop per product and store over time.

## Stack

- Next.js 14 (App Router), Tailwind CSS, PWA
- SQLite via better-sqlite3 + Drizzle ORM
- NextAuth (credentials, JWT) — receipts are per-user, the price database is shared
- Tesseract (swe+eng, TSV word boxes) + Claude vision (`claude-haiku-4-5`, structured outputs)

## How parsing works

1. Upload stores `original.jpg` and a `display.jpg` (≤1568 px long edge) —
   the display image is the canonical coordinate space for all bounding boxes.
2. Tesseract produces word boxes; the header is fingerprint-matched against
   known stores.
3. Claude receives the image + OCR text (+ the store's learned profile) and
   returns structured JSON (schema-enforced).
4. Items are mapped back to OCR lines for on-image highlighting, and known
   product aliases pre-link items to products.
5. The user reviews, corrects (word-tap on the image), links products and confirms.

Learning happens at confirm time: store layout fingerprints, correction
examples (few-shot for future parses at that store, max 8) and product aliases.

## Development

```bash
npm install
npm run db:migrate         # creates data/kvitto.db
npm run dev
```

`.env.local` needs `NEXTAUTH_SECRET` and one parser key: `OPENROUTER_API_KEY`
(preferred; model via `OPENROUTER_MODEL`, default `anthropic/claude-haiku-4.5`)
or `ANTHROPIC_API_KEY` (direct API; model via `CLAUDE_MODEL`). When both are
set OpenRouter wins unless `PARSER_PROVIDER=anthropic`.
The first registered account becomes admin; registration closes after that
(admins create further accounts under /admin).

Dev OCR needs Swedish traineddata: put `swe.traineddata` + `eng.traineddata`
(tessdata_fast) plus the `configs/` directory in `.tessdata/` at the project
root. In Docker the alpine packages provide them.

```bash
npm test                   # vitest (matching utilities)
npx tsc --noEmit
```

## Deployment

CI builds a multi-arch image to `ghcr.io/tjelite1986/kvitto` on push to main.
Deployed with docker compose behind Traefik at https://kvitto.mecloud.win;
a single named volume (`/app/data`) holds the SQLite db and receipt images.
