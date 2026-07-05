import { describe, expect, it } from 'vitest';
import { comparisonPriceOre, formatAmount, parseAmountFromText } from './units';

describe('comparisonPriceOre', () => {
  it('converts a 1.5 l bottle price to per liter', () => {
    // 22.90 kr for 1.5 l → 15.27 kr/l
    expect(comparisonPriceOre(2290, 1.5, 'l')).toEqual({ ore: 1527, per: 'l' });
  });

  it('converts a 33 cl can price to per liter', () => {
    // 9.41 kr for 33 cl → 28.52 kr/l
    expect(comparisonPriceOre(941, 33, 'cl')).toEqual({ ore: 2852, per: 'l' });
  });

  it('converts grams to per kg', () => {
    // 34.90 kr for 500 g → 69.80 kr/kg
    expect(comparisonPriceOre(3490, 500, 'g')).toEqual({ ore: 6980, per: 'kg' });
  });

  it('passes kg amounts through', () => {
    expect(comparisonPriceOre(8990, 1, 'kg')).toEqual({ ore: 8990, per: 'kg' });
  });

  it('converts hectograms to per kg', () => {
    // 8.95 kr for 1 hg → 89.50 kr/kg
    expect(comparisonPriceOre(895, 1, 'hg')).toEqual({ ore: 8950, per: 'kg' });
  });

  it('returns null for pieces, missing or invalid amounts', () => {
    expect(comparisonPriceOre(941, 6, 'pc')).toBeNull();
    expect(comparisonPriceOre(941, null, 'l')).toBeNull();
    expect(comparisonPriceOre(941, 0, 'l')).toBeNull();
    expect(comparisonPriceOre(941, 1.5, null)).toBeNull();
    expect(comparisonPriceOre(941, 1.5, 'bogus')).toBeNull();
  });
});

describe('parseAmountFromText', () => {
  it('reads trailing liter sizes with decimal comma', () => {
    expect(parseAmountFromText('COCA-COLA ZERO 1,5L')).toEqual({ value: 1.5, unit: 'l' });
  });

  it('reads ml, cl and g sizes with or without a space', () => {
    expect(parseAmountFromText('RED BULL 250ML')).toEqual({ value: 250, unit: 'ml' });
    expect(parseAmountFromText('PWK ENERGY 25 CL')).toEqual({ value: 25, unit: 'cl' });
    expect(parseAmountFromText('PRINGLES 200G')).toEqual({ value: 200, unit: 'g' });
    expect(parseAmountFromText('KETCHUP 500 GR')).toEqual({ value: 500, unit: 'g' });
    expect(parseAmountFromText('LOSGODIS 2 HG')).toEqual({ value: 2, unit: 'hg' });
  });

  it('takes the last size when several match', () => {
    expect(parseAmountFromText('FANTA 4X33CL 132CL')).toEqual({ value: 132, unit: 'cl' });
  });

  it('ignores piece counts and plain text', () => {
    expect(parseAmountFromText('BANANER KLASS 1')).toBeNull();
    expect(parseAmountFromText('MJOLK')).toBeNull();
  });
});

describe('formatAmount', () => {
  it('formats with Swedish decimals and st for pieces', () => {
    expect(formatAmount(1.5, 'l')).toBe('1,5 l');
    expect(formatAmount(330, 'ml')).toBe('330 ml');
    expect(formatAmount(6, 'pc')).toBe('6 st');
  });
});
