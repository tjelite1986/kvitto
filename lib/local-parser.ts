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
// Deposit refund: returning empties for money back. A receipt-level credit,
// distinct from the PANT surcharge you pay when buying. Matched before PANT so
// "PANTRETUR" never folds into an item's pant_ore.
const PANTRETUR_RE = /PANTRETUR|RETURPANT|PANT[\s.-]*RETUR/i;
// Receipt-level charges on home-delivery / online-grocery receipts. Added to
// the total, never items. Checked before the item logic.
const DELIVERY_FEE_RE = /\b(UTK[ÖO]RNING|LEVERANSAVGIFT|HEMK[ÖO]RNING|HEMLEVERANS|FRAKT)\w*/i;
const SERVICE_FEE_RE = /\b(SERVICEAVGIFT|SERVICEAVG|PLOCKAVGIFT|EXPEDITIONSAVGIFT|SERVICE)\w*/i;
// Receipt/invoice number labels. Value must start with a digit and follow an
// explicit number label — the bare "Kvitto <date>" header must not match.
const RECEIPT_NO_RE =
  /\b(?:kvitto\s*\/?\s*faktura\s*(?:nr|nummer)|kvitto[\s-]*(?:nr|nummer)|kvittonr|bong(?:[\s-]*nr)?|faktura[\s-]*(?:nr|nummer)|invoice\s*(?:no\.?|nr|number|#)?|receipt\s*(?:no\.?|nr|number|#)?)\b[\s:.#-]*([0-9][0-9A-Za-z/-]{1,24})/i;
const DISCOUNT_RE = /\b(RABATT|PRISNEDSATT|PRISNEDS|S[ÄA]NKT|EXTRAPRIS|KAMPANJ)\b/i;
// OCR often reads FÖR as FOR/F0R, and sometimes inserts a space inside the
// price ("29, 90") — all money patterns tolerate \s? around the separator.
// x/* between qty and price is sometimes OCR'd as +
const OFFER_RE = /(\d+)\s*(?:F[ÖO0]R|F)\s+(\d{1,5})\s?[,.]\s?(\d{2})/i;
const QTY_RE = /(\d+)\s*ST\s*[xX*+]\s*(\d{1,5})\s?[,.]\s?(\d{2})/i;
// Weight lines are usually per kg; hectogram lines (lösgodis) are converted
// to kg on parse (qty / 10, unit price x 10) so everything is stored per kg.
const WEIGHT_RE = /(\d+\s?[,.]\s?\d{1,3})\s*(KG|HG)\s*[xX*+]\s*(\d{1,5})\s?[,.]\s?(\d{2})/i;
const MONEY_TOKEN_RE = /-?\s?\d{1,5}\s?[,.]\s?\d{2}(?!\d)/g;
const DASHED_RE = /^[-—_=* ]{6,}$/;

function tokenToOre(token: string): { ore: number; negative: boolean } {
  const negative = token.includes('-');
  const m = token.match(/(\d{1,5})\s?[,.]\s?(\d{2})/)!;
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
    .replace(/^[*+\-\s]+/, '') // bonus/pant markers like "* " or "+"
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
  let pantReturnOre = 0;
  let deliveryFeeOre = 0;
  let serviceFeeOre = 0;
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

    // PANTRETUR: deposit refund (returning empties for money back). A
    // receipt-level credit that lowers the total — never an item, never a
    // per-item surcharge. Must be checked before PANT and the discount rule.
    if (PANTRETUR_RE.test(text)) {
      if (money) pantReturnOre += Math.abs(money.ore);
      pendingName = null;
      continue;
    }

    // Delivery / service fees: receipt-level charges (home delivery / online
    // grocery), added to the total, never items. Only consume the line when it
    // actually carries a price, so addresses/phone lines fall through normally.
    if (money && DELIVERY_FEE_RE.test(text)) {
      deliveryFeeOre += Math.abs(money.ore);
      pendingName = null;
      continue;
    }
    if (money && SERVICE_FEE_RE.test(text)) {
      serviceFeeOre += Math.abs(money.ore);
      pendingName = null;
      continue;
    }

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

    // "N st x PRICE [TOTAL]" — either its own line under a name-only line
    // (Willys) or inline with the name (Hemköp: "ENERGY DRINK 2st*9,41 18,82")
    const qty = text.match(QTY_RE);
    if (qty) {
      const unitPrice = Number(qty[2]) * 100 + Number(qty[3]);
      const count = Number(qty[1]);
      const inlineName = stripMoneyAndNoise(text.slice(0, qty.index ?? 0));
      let item: ParsedItem | null;
      if (hasLetters(inlineName)) {
        item = newItem(inlineName, text);
        items.push(item);
      } else if (pendingName) {
        item = newItem(pendingName.name, pendingName.line);
        items.push(item);
      } else {
        item = prev();
      }
      if (item) {
        item.qty = count;
        item.unit_price_ore = unitPrice;
        item.line_total_ore = money && !money.negative ? money.ore : unitPrice * count;
        item.source_lines.push(text);
      }
      pendingName = null;
      continue;
    }

    // "0,812 kg x 14,90 kr/kg TOTAL" — weight line, own or inline
    const weight = text.match(WEIGHT_RE);
    if (weight) {
      const isHg = weight[2].toUpperCase() === 'HG';
      const amount = Number(weight[1].replace(/\s/g, '').replace(',', '.'));
      const perAmount = Number(weight[3]) * 100 + Number(weight[4]);
      const kg = isHg ? amount / 10 : amount;
      const perKg = isHg ? perAmount * 10 : perAmount;
      const inlineName = stripMoneyAndNoise(text.slice(0, weight.index ?? 0));
      let item: ParsedItem | null;
      if (hasLetters(inlineName)) {
        item = newItem(inlineName, text);
        items.push(item);
      } else if (pendingName) {
        item = newItem(pendingName.name, pendingName.line);
        items.push(item);
      } else {
        item = prev();
      }
      if (item) {
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

  // Receipt/invoice number — labelled differently per chain. Require an explicit
  // number label (so the bare "Kvitto <date>" header isn't grabbed) and a value
  // that starts with a digit. Best-effort: the user can fix it in review.
  let receiptNumber: string | null = null;
  for (const l of lines) {
    const m = l.match(RECEIPT_NO_RE);
    if (m) {
      receiptNumber = m[1].replace(/[-.:]+$/, '');
      break;
    }
  }

  const computedSum = cleaned.reduce((sum, item) => {
    const effective =
      item.offer_qty && item.offer_total_ore != null
        ? item.offer_total_ore
        : item.line_total_ore;
    return sum + effective - item.discount_ore + item.pant_ore;
  }, 0);

  const checksumOk =
    totalOre != null &&
    cleaned.length > 0 &&
    Math.abs(computedSum + deliveryFeeOre + serviceFeeOre - pantReturnOre - totalOre) <= 1;

  return {
    parsed: {
      store_name: null,
      purchase_date: purchaseDate,
      purchase_time: purchaseTime,
      receipt_number: receiptNumber,
      total_ore: totalOre,
      pant_return_ore: pantReturnOre,
      delivery_fee_ore: deliveryFeeOre,
      service_fee_ore: serviceFeeOre,
      items: cleaned,
    },
    checksumOk,
  };
}
