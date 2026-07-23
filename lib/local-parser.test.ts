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

describe('parseLocally — hectogram lines (lösgodis)', () => {
  it('converts hg quantities and per-hg prices to kg', () => {
    const lines = [
      'HEMKOP TORPA',
      'Kvitto 2026-07-05 12:00',
      'LOSGODIS',
      '4,5 hg x 8,95 kr/hg 40,28',
      'TOTALT 40,28',
      'KORT 40,28',
    ];
    const { parsed, checksumOk } = parseLocally(ocrFromLines(lines));
    expect(checksumOk).toBe(true);
    const candy = parsed.items.find((i) => i.name.includes('LOSGODIS'))!;
    expect(candy.unit).toBe('kg');
    expect(candy.qty).toBeCloseTo(0.45);
    expect(candy.unit_price_ore).toBe(8950);
    expect(candy.line_total_ore).toBe(4028);
  });
});

describe('parseLocally — OCR quirks', () => {
  it('handles a space inside the price ("29, 90" from tesseract 5.5)', () => {
    const lines = WILLYS_LINES.map((l) =>
      l === 'FALUKORV 800G 29,90' ? 'FALUKORV 800G 29, 90' : l
    );
    const { parsed, checksumOk } = parseLocally(ocrFromLines(lines));
    expect(checksumOk).toBe(true);
    const korv = parsed.items.find((i) => i.name.includes('FALUKORV'))!;
    expect(korv.line_total_ore).toBe(2990);
  });
});

describe('parseLocally — pant refund (PANTRETUR)', () => {
  const PANTRETUR_LINES = [
    'Hemköp Torpa, Vänersborg',
    'Kvitto 2026-07-05 09:55',
    'COCA-COLA ZERO 1,5L 24,90',
    'PANT 4,00',
    'PANTRETUR -10,00',
    'TOTALT 18,90',
  ];
  const { parsed, checksumOk } = parseLocally(ocrFromLines(PANTRETUR_LINES));

  it('captures the refund as a receipt-level credit, not an item', () => {
    expect(parsed.pant_return_ore).toBe(1000);
    expect(parsed.items.some((i) => /RETUR/i.test(i.name))).toBe(false);
    expect(parsed.items).toHaveLength(1);
  });

  it('passes the checksum once the refund is subtracted', () => {
    // 24,90 + 4,00 pant - 10,00 refund = 18,90
    expect(parsed.total_ore).toBe(1890);
    expect(checksumOk).toBe(true);
  });

  it('keeps the beverage pant surcharge separate from the refund', () => {
    const cola = parsed.items[0];
    expect(cola.pant_ore).toBe(400);
  });
});

describe('parseLocally — delivery & service fees', () => {
  const DELIVERY_LINES = [
    'MATKASSE ONLINE',
    'Kvitto 2026-07-20 14:00',
    'MJOLK 1,5L 15,00',
    'BROD 25,00',
    'Utkörningsavgift 49,00',
    'Serviceavgift 20,00',
    'TOTALT 109,00',
  ];
  const { parsed, checksumOk } = parseLocally(ocrFromLines(DELIVERY_LINES));

  it('captures fees as receipt-level charges, not items', () => {
    expect(parsed.delivery_fee_ore).toBe(4900);
    expect(parsed.service_fee_ore).toBe(2000);
    expect(parsed.items.some((i) => /AVGIFT|SERVICE|UTK/i.test(i.name))).toBe(false);
    expect(parsed.items).toHaveLength(2);
  });

  it('passes the checksum once fees are added to the item sum', () => {
    // 15,00 + 25,00 + 49,00 delivery + 20,00 service = 109,00
    expect(parsed.total_ore).toBe(10900);
    expect(checksumOk).toBe(true);
  });
});

describe('parseLocally — receipt number', () => {
  it('extracts a labelled receipt number (Kvittonr)', () => {
    const lines = ['Hemköp Torpa', 'Kvittonr: 4711', 'Kvitto 2026-07-05 09:55', 'MJOLK 12,00', 'TOTALT 12,00'];
    const { parsed } = parseLocally(ocrFromLines(lines));
    expect(parsed.receipt_number).toBe('4711');
  });

  it('extracts an invoice number (English label)', () => {
    const lines = ['STORE AB', 'Invoice no 000123', 'MILK 12,00', 'TOTAL 12,00'];
    const { parsed } = parseLocally(ocrFromLines(lines));
    expect(parsed.receipt_number).toBe('000123');
  });

  it('extracts a Bong number', () => {
    const lines = ['ICA', 'Bong 5582', 'BROD 20,00', 'TOTALT 20,00'];
    const { parsed } = parseLocally(ocrFromLines(lines));
    expect(parsed.receipt_number).toBe('5582');
  });

  it('does not mistake the bare "Kvitto <date>" header for a number', () => {
    // ICA_LINES has "Kvitto 2026-07-01 17:42" but no explicit number label
    const { parsed } = parseLocally(ocrFromLines(ICA_LINES));
    expect(parsed.receipt_number).toBeNull();
  });

  it('does not grab the org number', () => {
    const lines = ['STORE', 'Org.nr: 556000-1234', 'MILK 12,00', 'TOTALT 12,00'];
    const { parsed } = parseLocally(ocrFromLines(lines));
    expect(parsed.receipt_number).toBeNull();
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
