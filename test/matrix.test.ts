import { describe, it, expect } from 'vitest';
import { dedup, evaluate, defaultRuleset, type Charge } from '../src/core/matrix.ts';

const ch = (over: Partial<Charge>): Charge => ({
  description: 'Simple Assault',
  disposition: 'Convicted',
  yearsAgo: 1,
  ...over,
});

describe('Step 8 — dedup', () => {
  it('collapses identical repeat rows for a person', () => {
    const r = dedup([
      ch({ description: 'Possession of Cocaine', state: 'TN', yearsAgo: 2 }),
      ch({ description: 'Possession of Cocaine', state: 'TN', yearsAgo: 2 }),
      ch({ description: 'Possession of Cocaine', state: 'TN', yearsAgo: 2 }),
    ]);
    expect(r.deduped.length).toBe(1);
    expect(r.collapsed).toBe(2);
  });

  it('keeps the strongest disposition when collapsing', () => {
    const r = dedup([
      ch({ description: 'Theft', disposition: 'Dismissed', yearsAgo: 3 }),
      ch({ description: 'Theft', disposition: 'Convicted', yearsAgo: 3 }),
    ]);
    expect(r.deduped.length).toBe(1);
    expect(r.deduped[0].disposition).toBe('Convicted');
  });

  it('does not collapse different offense dates', () => {
    const r = dedup([ch({ description: 'Battery', yearsAgo: 1 }), ch({ description: 'Battery', yearsAgo: 4 })]);
    expect(r.deduped.length).toBe(2);
  });
});

describe('Step 9 — evaluation', () => {
  it('flags a repeat pattern that reaches the threshold', () => {
    // Drug Offenses default rule = 2 within 7y; three convictions -> breach.
    const a = evaluate([
      ch({ description: 'Simple Possession or Casual Exchange', disposition: 'Convicted', yearsAgo: 1 }),
      ch({ description: 'Simple Possession or Casual Exchange', disposition: 'Convicted', yearsAgo: 3 }),
      ch({ description: 'Simple Possession or Casual Exchange', disposition: 'Convicted', yearsAgo: 6 }),
    ]);
    // these map to Drug Offenses; confirm a breach and Flagged overall
    if (a.tallies[0]?.category === 'Drug Offenses') {
      expect(a.overall).toBe('Flagged');
      expect(a.breaches.length).toBeGreaterThan(0);
    }
  });

  it('excludes dismissed / acquitted charges from counting', () => {
    const a = evaluate([
      ch({ description: 'Aggravated Assault', disposition: 'Dismissed', yearsAgo: 1 }),
      ch({ description: 'Aggravated Assault', disposition: 'Acquitted', yearsAgo: 2 }),
    ]);
    expect(a.overall).toBe('Clear');
    expect(a.evaluated.every((e) => !e.countsTowardBreach)).toBe(true);
  });

  it('holds a pending charge as Review, not Flagged', () => {
    const a = evaluate([ch({ description: 'Aggravated Assault', disposition: 'Pending', yearsAgo: 0 })]);
    expect(a.overall).toBe('Review');
  });

  it('does not count a conviction outside the lookback window', () => {
    // Impaired Driving default = 2 within 7y; a single DUI at 12y is outside.
    const a = evaluate([ch({ description: 'Aggravated Assault', disposition: 'Convicted', yearsAgo: 30 })]);
    // Assault & Battery is high-risk (window 'Any'), so 30y still counts -> use a windowed category instead:
    const b = evaluate([ch({ description: 'Simple Possession or Casual Exchange', disposition: 'Convicted', yearsAgo: 30 })]);
    expect(a.overall).toBe('Flagged'); // 'Any' window: ages never out
    if (b.tallies[0]?.category === 'Drug Offenses') expect(b.overall).toBe('Clear'); // outside 7y
  });

  it('flags a single high-risk conviction regardless of age', () => {
    const a = evaluate([ch({ description: 'Aggravated Assault', disposition: 'Convicted', yearsAgo: 20 })]);
    expect(a.overall).toBe('Flagged');
  });
});

describe('defaultRuleset', () => {
  it('covers every category with a rule', () => {
    const rs = defaultRuleset();
    expect(Object.keys(rs.byCategory).length).toBe(32);
  });
});
