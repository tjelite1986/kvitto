import { describe, it, expect } from 'vitest';
import { parseLocally } from './local-parser';
import type { OcrResult } from './ocr';

function ocrFromLines(lines: string[]): OcrResult {
  return {
    words: [],
    lines: lines.map((text, i) => ({ text, x: 0, y: i * 20, w: 100, h: 18, words: [] })),
    text: lines.join('\n'),
  };
}

// OCR-realistic text (diacritics often lost, FÖR sometimes read as FOR)
const ICA_LINES = [
  'ICA Kvantum Vänersborg',
  'Edsgatan 12, 462 33 Vänersborg',
  'Tel: 0521-123 45',
  'Org.nr: 556000-1234',
  'Kvitto 2026-07-01 17:42',
  'MELLANMJOLK 1,5L 22,50',
  'PANT 2,00',
  'COCA-COLA ZERO 1,5L 24,90',
  'PANT 4,00',
  'APPLE ROYAL GALA',
  '0,456 kg x 39,90 kr/kg 18,20',
  'POLARBROD RAG 32,90',
  'KAFFE GEVALIA MELLAN 64,90',
  'RABATT GEVALIA -15,00',
  'GODIS LOSVIKT 2 for 45,00 45,00',
  'TOTALT 199,40',
  'KORT MASTERCARD 199,40',
  'Moms% Moms Netto Brutto',
  '12,00 21,36 178,04 199,40',
];

const WILLYS_LINES = [
  'WILLYS VANERSBORG',
  'Ostra vagen 22, Vanersborg',
  'Org.nr: 556163-2232',
  'Kvitto 2026-07-04 15:12',
  'ENERGIDRYCK CULT 25CL',
  '4 st x 9,41 37,64',
  '4 FOR 24,00 -13,64',
  'PANT 4 st x 1,00 4,00',
  'FALUKORV 800G 29,90',
  'LOK GUL I NAT',
  '0,812 kg x 14,90 kr/kg 12,10',
  'ATT BETALA 70,00',
  'KORT 70,00',
];

describe('parseLocally — ICA style (one line per item)', () => {
  const { parsed, checksumOk } = parseLocally(ocrFromLines(ICA_LINES));

  it('passes the total checksum', () => {
    expect(parsed.total_ore).toBe(19940);
    expect(checksumOk).toBe(true);
  });

  it('extracts date and time', () => {
    expect(parsed.purchase_date).toBe('2026-07-01');
    expect(parsed.purchase_time).toBe('17:42');
  });

  it('attaches pant to the beverages, not as items', () => {
    const milk = parsed.items.find((i) => i.name.includes('MELLANMJOLK'))!;
    const cola = parsed.items.find((i) => i.name.includes('COCA-COLA'))!;
    expect(milk.pant_ore).toBe(200);
    expect(cola.pant_ore).toBe(400);
    expect(parsed.items.some((i) => /^PANT$/i.test(i.name))).toBe(false);
  });

  it('handles weight items', () => {
    const apple = parsed.items.find((i) => i.name.includes('APPLE'))!;
    expect(apple.unit).toBe('kg');
    expect(apple.qty).toBeCloseTo(0.456);
    expect(apple.unit_price_ore).toBe(3990);
    expect(apple.line_total_ore).toBe(1820);
  });

  it('attaches discounts to the preceding item', () => {
    const coffee = parsed.items.find((i) => i.name.includes('GEVALIA'))!;
    expect(coffee.discount_ore).toBe(1500);
  });

  it('handles inline N-för-X offers', () => {
    const candy = parsed.items.find((i) => i.name.includes('GODIS'))!;
    expect(candy.offer_qty).toBe(2);
    expect(candy.offer_total_ore).toBe(4500);
  });

  it('does not turn payment or VAT lines into items', () => {
    expect(parsed.items).toHaveLength(6);
  });
});

describe('parseLocally — Willys style (multi-line items)', () => {
  const { parsed, checksumOk } = parseLocally(ocrFromLines(WILLYS_LINES));

  it('passes the total checksum', () => {
    expect(parsed.total_ore).toBe(7000);
    expect(checksumOk).toBe(true);
  });

  it('builds the multi-line offer item correctly', () => {
    const drink = parsed.items.find((i) => i.name.includes('ENERGIDRYCK'))!;
    expect(drink.qty).toBe(4);
    expect(drink.unit_price_ore).toBe(941);
    expect(drink.line_total_ore).toBe(3764);
    expect(drink.offer_qty).toBe(4);
    expect(drink.offer_total_ore).toBe(2400);
    expect(drink.pant_ore).toBe(400);
    expect(drink.discount_ore).toBe(0);
  });

  it('handles name-only line followed by weight line', () => {
    const onion = parsed.items.find((i) => i.name.includes('LOK'))!;
    expect(onion.unit).toBe('kg');
    expect(onion.line_total_ore).toBe(1210);
  });
});

describe('parseLocally — checksum failure', () => {
  it('fails the checksum when a line is garbled', () => {
    const broken = ICA_LINES.filter((l) => !l.includes('POLARBROD'));
    const { checksumOk } = parseLocally(ocrFromLines(broken));
    expect(checksumOk).toBe(false);
  });

  it('fails the checksum when no total is found', () => {
    const noTotal = WILLYS_LINES.filter((l) => !l.includes('ATT BETALA'));
    const { checksumOk } = parseLocally(ocrFromLines(noTotal));
    expect(checksumOk).toBe(false);
  });
});
