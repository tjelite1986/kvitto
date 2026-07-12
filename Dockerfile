# Multi-stage build. The builder compiles better-sqlite3 (native) and runs the
# Next.js standalone build; the runner is a slim image with tesseract for OCR.
# Next's output tracing bundles better-sqlite3 and sharp (with the correct
# per-platform binaries) into .next/standalone — no manual module copies needed.
FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG CI_LIMIT_WORKERS=""
ENV CI_LIMIT_WORKERS=$CI_LIMIT_WORKERS
# Retry once: QEMU cross-builds can still hit a transient V8 SIGILL
RUN npm run build || npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# OCR: tesseract with Swedish + English language data.
# poppler-utils provides pdftoppm for PDF receipt uploads; fontconfig +
# font-urw-base35 supply substitutes for the PDF base-14 fonts (Helvetica,
# Courier...) — digital receipts rarely embed fonts and render BLANK without them.
# (If these apk packages ever disappear, fall back to node:20-bookworm-slim
# with: apt-get install -y tesseract-ocr tesseract-ocr-swe tesseract-ocr-eng poppler-utils fontconfig fonts-urw-base35)
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-swe tesseract-ocr-data-eng \
    poppler-utils fontconfig font-urw-base35

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/scripts ./scripts
# The whole lib/db dir: migrate.ts imports ./bootstrap, so copying only the
# entrypoint ships a broken manual-migration script
COPY --from=builder /app/lib/db ./lib/db
COPY --from=builder /app/package.json ./package.json

# One volume covers the SQLite db and all receipt images (data/receipts/...)
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
