import { describe, it, expect } from 'vitest';
import { decide, type Candidate } from '../src/core/ai.ts';

const cand = (category: string, subcategory: string, cos: number, rerank: number): Candidate => ({
  phrase: subcategory,
  category,
  subcategory,
  cos,
  rerank,
});

describe('decide() — two-gate + category consensus', () => {
  it('accepts when embedder and reranker both pass', () => {
    const d = decide([cand('Drug Offenses', 'Possession', 0.88, 0.9), cand('Drug Offenses', 'Trafficking', 0.8, 0.4)]);
    expect(d.outcome).toBe('accept');
    expect(d.category).toBe('Drug Offenses');
    expect(d.subcategory).toBe('Possession');
  });

  it('rejects (not a charge) when the embedder is weak, even if reranker is high', () => {
    // the "Hello" case: reranker fooled to 1.0 but nothing is actually close
    const d = decide([cand('Obstruction & Justice Process', 'Solicitation', 0.58, 1.0), cand('Robbery & Burglary', 'Joyriding', 0.54, 0.7)]);
    expect(d.outcome).toBe('reject');
    expect(d.category).toBeNull();
    expect(d.reason).toMatch(/not a recognizable charge/);
  });

  it('accepts the CATEGORY when the shortlist agrees but the reranker cant pick a subcategory', () => {
    // the "Flash penis in public" case: all Sexual Offenses, best rerank below threshold
    const d = decide([
      cand('Sexual Offenses', 'Sexual Imposition', 0.65, 0.47),
      cand('Sexual Offenses', 'Sexual Battery', 0.65, 0.29),
      cand('Sexual Offenses', 'Public Sexual Indecency', 0.74, 0.11),
      cand('Sexual Offenses', 'Indecent Exposure', 0.69, 0.01),
    ]);
    expect(d.outcome).toBe('category-only');
    expect(d.category).toBe('Sexual Offenses');
    expect(d.subcategory).toBeNull();
    expect(d.consensusVotes).toBe(4);
  });

  it('rejects when reranker is low AND there is no category consensus', () => {
    const d = decide([
      cand('Drug Offenses', 'Possession', 0.7, 0.4),
      cand('Homicide', 'Murder', 0.68, 0.3),
      cand('Fraud & Forgery', 'Forgery', 0.66, 0.2),
      cand('Labor', 'Wage Theft', 0.65, 0.1),
    ]);
    expect(d.outcome).toBe('reject');
  });
});
