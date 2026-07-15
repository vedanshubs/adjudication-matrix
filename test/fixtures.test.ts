import { describe, it, expect } from 'vitest';
import { candidates } from '../src/core/fixtures.ts';
import { evaluate, type Overall } from '../src/core/matrix.ts';

const EXPECTED: Record<string, Overall> = {
  reed: 'Flagged',
  whitfield: 'Flagged',
  nair: 'Flagged',
  pierce: 'Flagged',
  flores: 'Clear',
  marsh: 'Review',
  kim: 'Clear',
  coleman: 'Clear',
};

describe('mock candidates behave as labeled', () => {
  for (const cand of candidates) {
    it(`${cand.name} (${cand.note}) -> ${EXPECTED[cand.id]}`, () => {
      const a = evaluate(cand.charges);
      expect(a.overall).toBe(EXPECTED[cand.id]);
    });
  }

  it('every fixture charge maps to a real category (no accidental AI-defers)', () => {
    for (const cand of candidates) {
      const a = evaluate(cand.charges);
      const unmapped = a.evaluated.filter((e) => !e.category).map((e) => `${cand.name}: ${e.charge.description}`);
      expect(unmapped).toEqual([]);
    }
  });

  it('Marcus Reed dedups a duplicate row', () => {
    const a = evaluate(candidates.find((c) => c.id === 'reed')!.charges);
    expect(a.dedup.collapsed).toBe(1);
  });
});
