import type { OcrResult } from './ocr';
import type { ParsedReceipt, ParsedItem } from './claude';

// Rule-based local receipt parser — runs entirely on the Pi, no API call.
// Swedish receipt lines follow a small set of patterns (item+price, qty lines,
// weight lines, PANT, RABATT, N-för-X offers). The receipt's own printed total
// works as a checksum: when the parsed items sum to it öre-exact the result is
// trusted; otherwise the caller falls back to the AI parser.

export interface LocalParseResult {
  parsed: ParsedReceipt;
  checksumOk: boolean;
}

const TOTAL_RE = /\b(TOTALT|ATT\s+BETALA|SUMMA|TOTAL)\b/i;
const SKIP_RE =
  /\b(MOMS|KORT|KONTANT|MASTERCARD|VISA|SWISH|V[ÄA]XEL|KVITTO|ORG\.?\s?NR|TELE?F?O?N?|WWW|TACK|[ÖO]PPET|BRUTTO|NETTO|KASS[AÖO]R?|SJ[ÄA]LVSCAN|MEDLEM|BONUS|SALDO|KUND)\b/i;
const PANT_RE = /\bPANT\b/i;
const DISCOUNT_RE = /\b(RABATT|PRISNEDSATT|PRISNEDS|S[ÄA]NKT|EXTRAPRIS|KAMPANJ)\b/i;
// OCR often reads FÖR as FOR/F0R
const OFFER_RE = /(\d+)\s*(?:F[ÖO0]R|F)\s+(\d{1,5})[,.](\d{2})/i;
const QTY_RE = /(\d+)\s*ST\s*[xX*]\s*(\d{1,5})[,.](\d{2})/i;
const WEIGHT_RE = /(\d+[,.]\d{1,3})\s*KG\s*[xX*]\s*(\d{1,5})[,.](\d{2})/i;
const MONEY_TOKEN_RE = /-?\s?\d{1,5}[,.]\d{2}/g;
const DASHED_RE = /^[-—_=* ]{6,}$/;

function tokenToOre(token: string): { ore: number; negative: boolean } {
  const negative = token.includes('-');
  const m = token.match(/(\d{1,5})[,.](\d{2})/)!;
  return { ore: Number(m[1]) * 100 + Number(m[2]), negative };
}

/** Last money token on the line, or null. */
function lastMoney(text: string): { ore: number; negative: boolean } | null {
  const tokens = text.match(MONEY_TOKEN_RE);
  if (!tokens || tokens.length === 0) return null;
  return tokenToOre(tokens[tokens.length - 1]);
}

function stripMoneyAndNoise(text: string): string {
  return text
    .replace(MONEY_TOKEN_RE, ' ')
    .replace(OFFER_RE, ' ')
    .replace(QTY_RE, ' ')
    .replace(WEIGHT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasLetters(text: string): boolean {
  return (text.match(/[a-zåäö]/gi) ?? []).length >= 3;
}

function newItem(name: string, sourceLine: string): ParsedItem {
  return {
    name,
    qty: 1,
    unit: 'pc',
    unit_price_ore: null,
    line_total_ore: 0,
    offer_qty: null,
    offer_total_ore: null,
    discount_ore: 0,
    pant_ore: 0,
    source_lines: [sourceLine],
  };
}

export function parseLocally(ocr: OcrResult): LocalParseResult {
  const lines = ocr.lines.map((l) => l.text);
  const items: ParsedItem[] = [];
  let totalOre: number | null = null;
  let pendingName: { name: string; line: string } | null = null;
  let itemsEnded = false;

  const prev = () => (items.length > 0 ? items[items.length - 1] : null);

  for (const line of lines) {
    if (itemsEnded) break;
    const text = line.trim();
    if (!text || DASHED_RE.test(text)) {
      continue;
    }

    const money = lastMoney(text);

    // Grand total ends the item section
    if (TOTAL_RE.test(text) && money && !money.negative) {
      totalOre = money.ore;
      itemsEnded = true;
      continue;
    }

    if (SKIP_RE.test(text)) continue;

    // PANT: surcharge on the previous item, never an item of its own
    if (PANT_RE.test(text)) {
      const target = prev();
      if (target && money) {
        target.pant_ore += Math.abs(money.ore);
        target.source_lines.push(text);
      }
      pendingName = null;
      continue;
    }

    // N-för-X: either an adjustment line for the previous item
    // ("4 FÖR 24,00 -13,64") or inline in an item line ("GODIS 2 för 45,00 45,00")
    const offer = text.match(OFFER_RE);
    if (offer && money?.negative) {
      const target = prev();
      if (target) {
        target.offer_qty = Number(offer[1]);
        target.offer_total_ore = Number(offer[2]) * 100 + Number(offer[3]);
        target.qty = Math.max(target.qty, Number(offer[1]));
        target.source_lines.push(text);
      }
      pendingName = null;
      continue;
    }

    // Plain discount line for the previous item
    if (money?.negative || (DISCOUNT_RE.test(text) && money)) {
      const target = prev();
      if (target && money) {
        target.discount_ore += Math.abs(money.ore);
        target.source_lines.push(text);
      }
      pendingName = null;
      continue;
    }

    // "N st x PRICE [TOTAL]" — quantity line for a pending name or new values
    const qty = text.match(QTY_RE);
    if (qty) {
      const unitPrice = Number(qty[2]) * 100 + Number(qty[3]);
      const count = Number(qty[1]);
      const item = pendingName ? newItem(pendingName.name, pendingName.line) : prev();
      if (item) {
        if (pendingName) items.push(item);
        item.qty = count;
        item.unit_price_ore = unitPrice;
        item.line_total_ore = money && !money.negative ? money.ore : unitPrice * count;
        item.source_lines.push(text);
      }
      pendingName = null;
      continue;
    }

    // "0,812 kg x 14,90 kr/kg TOTAL" — weight line
    const weight = text.match(WEIGHT_RE);
    if (weight) {
      const kg = Number(weight[1].replace(',', '.'));
      const perKg = Number(weight[2]) * 100 + Number(weight[3]);
      const item = pendingName ? newItem(pendingName.name, pendingName.line) : prev();
      if (item) {
        if (pendingName) items.push(item);
        item.qty = kg;
        item.unit = 'kg';
        item.unit_price_ore = perKg;
        item.line_total_ore =
          money && !money.negative ? money.ore : Math.round(kg * perKg);
        item.source_lines.push(text);
      }
      pendingName = null;
      continue;
    }

    // Regular item line: name + price at the end
    if (money && !money.negative && hasLetters(text)) {
      const name = stripMoneyAndNoise(text);
      if (!name) continue;
      const item = newItem(name, text);
      item.line_total_ore = money.ore;
      item.unit_price_ore = money.ore;
      if (offer) {
        // Inline offer: "GODIS LÖSVIKT 2 för 45,00  45,00"
        item.offer_qty = Number(offer[1]);
        item.offer_total_ore = Number(offer[2]) * 100 + Number(offer[3]);
        item.qty = Number(offer[1]);
        item.unit_price_ore = null;
      }
      items.push(item);
      pendingName = null;
      continue;
    }

    // Name-only line — the price info usually follows on the next line
    if (hasLetters(text) && !money) {
      pendingName = { name: stripMoneyAndNoise(text), line: text };
      continue;
    }
  }

  const cleaned = items.filter(
    (item) => item.line_total_ore > 0 || item.offer_total_ore != null
  );

  const dateMatch =
    ocr.text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/) ??
    ocr.text.match(/\b(\d{2})-(\d{2})-(\d{2})\b/);
  const purchaseDate = dateMatch
    ? `${dateMatch[1].length === 2 ? '20' + dateMatch[1] : dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
    : null;
  const timeMatch = ocr.text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const purchaseTime = timeMatch
    ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`
    : null;

  const computedSum = cleaned.reduce((sum, item) => {
    const effective =
      item.offer_qty && item.offer_total_ore != null
        ? item.offer_total_ore
        : item.line_total_ore;
    return sum + effective - item.discount_ore + item.pant_ore;
  }, 0);

  const checksumOk =
    totalOre != null && cleaned.length > 0 && Math.abs(computedSum - totalOre) <= 1;

  return {
    parsed: {
      store_name: null,
      purchase_date: purchaseDate,
      purchase_time: purchaseTime,
      total_ore: totalOre,
      items: cleaned,
    },
    checksumOk,
  };
}
