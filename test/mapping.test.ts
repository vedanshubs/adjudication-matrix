import { describe, it, expect } from 'vitest';
import { mapCharge, canonicalizeCode, normalize } from '../src/core/mapping.ts';
import { knowledgeBase } from '../src/core/data.ts';

describe('Layer 0 normalization', () => {
  it('strips count prefixes and punctuation', () => {
    expect(normalize('(1s) POSSESSION OF COCAINE')).toBe('possession of cocaine');
    expect(normalize('Theft & Property')).toBe('theft and property');
  });

  it('canonicalizes statute codes', () => {
    expect(canonicalizeCode('90-95(A)(1)')).toBe('9095A1');
    expect(canonicalizeCode('§ 5-10-101')).toBe('510101');
  });

  it('collapses dot / hyphen / space formatting variants to the same key', () => {
    expect(canonicalizeCode('302.113')).toBe(canonicalizeCode('302-113'));
    expect(canonicalizeCode('302.113')).toBe(canonicalizeCode('302 113'));
    expect(canonicalizeCode('§ 302.113')).toBe('302113');
  });
});

describe('Tier 2 — exact description', () => {
  it('resolves a verbatim KB description at high confidence', () => {
    const entry = knowledgeBase.entries.find((e) => e.description.length > 6)!;
    const r = mapCharge({ description: entry.description });
    expect(r.resolvedBy).toBe('Tier2_Exact');
    expect(r.confidence).toBe('High');
    expect(r.category).toBe(entry.category);
  });
});

describe('Tier 1 — statute lookup', () => {
  it('resolves a known (state, code) pair', () => {
    const entry = knowledgeBase.entries.find((e) => e.statuteNumber && canonicalizeCode(e.statuteNumber).length > 2)!;
    const r = mapCharge({ description: 'unrelated text', state: entry.state, statuteCode: entry.statuteNumber });
    expect(r.resolvedBy).toBe('Tier1_Statute');
    expect(r.confidence).toBe('High');
    expect(r.category).toBe(entry.category);
  });

  it('skips when no code is present', () => {
    const r = mapCharge({ description: 'zzzz nonsense qwerty' });
    const t1 = r.trace.find((s) => s.tier === 'Tier 1')!;
    expect(t1.outcome).toBe('skipped');
  });
});

describe('Tier 3 — keyword', () => {
  it('maps a charge whose text matches a v5 keyword phrase', () => {
    const r = mapCharge({ description: 'Simple Assault' });
    expect(r.category).toBe('Assault & Battery');
    expect(['Tier2_Exact', 'Tier3_Keyword']).toContain(r.resolvedBy);
  });
});

describe('unresolved -> AI/human deferral', () => {
  it('defers a charge nothing matches, with confidence None', () => {
    const r = mapCharge({ description: 'xyzzy plugh frobnicate' });
    expect(r.resolvedBy).toBeNull();
    expect(r.confidence).toBe('None');
    const ai = r.trace.find((s) => s.label.includes('AI tier'))!;
    expect(ai.outcome).toBe('deferred');
  });

  it('defers a semantic-gap charge the deterministic tiers cannot bridge', () => {
    // "cocaine" is not a literal keyword; only the embedder maps it to Drug Offenses.
    const r = mapCharge({ description: 'POSSESSION OF COCAINE' });
    expect(r.resolvedBy).toBeNull();
    expect(r.trace.find((s) => s.label.includes('AI tier'))!.outcome).toBe('deferred');
  });
});

describe('trace shape', () => {
  it('always starts with Layer 0 and records each rung tried', () => {
    const r = mapCharge({ description: 'POSSESSION OF COCAINE' });
    expect(r.trace[0].tier).toBe('Layer 0');
    expect(r.trace.some((s) => s.tier === 'Tier 2')).toBe(true);
  });
});
