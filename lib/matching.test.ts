import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  normalizeAlias,
  diceSimilarity,
  levenshtein,
  levenshteinSimilarity,
  bestMatch,
} from './matching';

describe('normalizeText', () => {
  it('lowercases and strips digits/punctuation', () => {
    expect(normalizeText('ICA Kvantum 08-123 45!')).toBe('ica kvantum');
  });

  it('keeps Swedish characters', () => {
    expect(normalizeText('Vänersborg Grönsaker')).toBe('vänersborg grönsaker');
  });
});

describe('normalizeAlias', () => {
  it('lowercases and collapses whitespace but keeps digits', () => {
    expect(normalizeAlias('MELLANMJÖLK  1.5L')).toBe('mellanmjölk 1.5l');
  });
});

describe('diceSimilarity', () => {
  it('is 1 for identical strings', () => {
    expect(diceSimilarity('ica kvantum', 'ica kvantum')).toBe(1);
  });

  it('is high for similar headers', () => {
    expect(diceSimilarity('ica kvantum oden', 'ica kvantum odin')).toBeGreaterThan(0.7);
  });

  it('is low for different stores', () => {
    expect(diceSimilarity('ica kvantum', 'willys hemma')).toBeLessThan(0.3);
  });
});

describe('levenshtein', () => {
  it('computes classic distances', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
  });
});

describe('levenshteinSimilarity', () => {
  it('handles OCR-style noise', () => {
    expect(levenshteinSimilarity('mellanmjolk 1,5l', 'mellanmj0lk 1.5l')).toBeGreaterThan(0.8);
  });
});

describe('bestMatch', () => {
  const lines = ['MELLANMJÖLK 1,5L 22.50', 'PANT 2.00', 'ÄPPLE ROYAL GALA 12.90'];

  it('finds the closest OCR line', () => {
    const match = bestMatch('MELLANMJOLK 1,5L 22.50', lines, 0.6);
    expect(match?.index).toBe(0);
  });

  it('returns null below threshold', () => {
    expect(bestMatch('completely different text here', lines, 0.6)).toBeNull();
  });
});
