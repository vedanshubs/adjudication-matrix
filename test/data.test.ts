import { describe, it, expect } from 'vitest';
import { taxonomy, knowledgeBase, categoryByName } from '../src/core/data.ts';

describe('compiled taxonomy', () => {
  it('has the 32 v5 categories', () => {
    expect(taxonomy.categories.length).toBe(32);
  });

  it('every category has a code, name, and type', () => {
    for (const c of taxonomy.categories) {
      expect(c.code).toMatch(/^[A-Z]{2,4}$/);
      expect(c.name.length).toBeGreaterThan(0);
      expect(['Criminal', 'Administrative']).toContain(c.type);
    }
  });

  it('exposes known categories with subcategories', () => {
    const drug = categoryByName.get('Drug Offenses');
    expect(drug?.code).toBe('DRG');
    expect(drug!.subcategories.length).toBeGreaterThan(0);
  });
});

describe('compiled knowledge base', () => {
  it('has entries from all four conformed states', () => {
    const states = new Set(knowledgeBase.entries.map((e) => e.state));
    expect([...states].sort()).toEqual(['AR', 'IL', 'TN', 'WI']);
  });

  it('every KB entry maps to a real v5 category', () => {
    const orphans = knowledgeBase.entries.filter((e) => !categoryByName.has(e.category));
    expect(orphans).toEqual([]);
  });

  it('every entry has a description and a valid severity', () => {
    for (const e of knowledgeBase.entries) {
      expect(e.description.length).toBeGreaterThan(0);
      expect(['Felony', 'Misdemeanor', 'Infraction', 'Unknown']).toContain(e.severity);
    }
  });
});
