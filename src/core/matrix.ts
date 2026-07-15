/*
 * matrix.ts — Step 8 (dedup per person) + Step 9 (rule engine).
 *
 * Pipeline for one person:
 *   raw charges -> dedup on (state, canonical-code | description) + date
 *              -> map each to a v5 category (Step 3)
 *              -> tally convictions per category within each lookback window
 *              -> breach when count >= threshold  =>  Clear / Review / Flagged
 *
 * Deterministic and config-driven: every outcome is explainable line by line.
 * The thresholds here are MOCK defaults — the real numbers are a per-state legal
 * policy. The engine that applies them is real.
 */
import { mapCharge, canonicalizeCode, normalize, type MapResult } from './mapping.ts';
import { categories, categoryByName } from './data.ts';
import type { Severity } from './types.ts';

export type Disposition = 'Convicted' | 'Pending' | 'Dismissed' | 'Acquitted';

export interface Charge {
  id?: string;
  description: string;
  state?: string;
  statuteCode?: string;
  disposition: Disposition;
  yearsAgo: number; // age of the offense; drives the lookback window
  severity?: Severity; // optional; otherwise taken from the KB via mapping
}

/** A lookback window + an offense-count threshold for one category. */
export interface CategoryRule {
  years: number | 'Any';
  count: number;
}

export interface Ruleset {
  byCategory: Record<string, CategoryRule>;
}

// ---------- Step 8: dedup ----------
const DISPO_RANK: Record<Disposition, number> = { Convicted: 3, Pending: 2, Acquitted: 1, Dismissed: 0 };

export interface DedupResult {
  deduped: Charge[];
  original: number;
  collapsed: number; // how many rows were folded away
}

/** Collapse repeat rows for one person; keep the strongest disposition per incident. */
export function dedup(charges: Charge[]): DedupResult {
  const groups = new Map<string, Charge>();
  for (const c of charges) {
    const code = c.statuteCode ? canonicalizeCode(c.statuteCode) : '';
    const idKey = code || normalize(c.description);
    const key = `${(c.state ?? '').toUpperCase()}|${idKey}|${c.yearsAgo}`;
    const existing = groups.get(key);
    if (!existing || DISPO_RANK[c.disposition] > DISPO_RANK[existing.disposition]) groups.set(key, c);
  }
  const deduped = [...groups.values()];
  return { deduped, original: charges.length, collapsed: charges.length - deduped.length };
}

// ---------- default (mock) ruleset ----------
const HIGH = new Set(['Homicide', 'Sexual Offenses', 'Robbery & Burglary', 'Assault & Battery', 'Domestic & Family Offenses', 'Firearms & Weapons']);
const MED = new Set(['Drug Offenses', 'Fraud & Forgery', 'Financial Crimes', 'Bribery & Corruption', 'Theft & Property Crimes', 'Obstruction & Justice Process', 'Impaired Driving']);

export function defaultRuleset(): Ruleset {
  const byCategory: Record<string, CategoryRule> = {};
  for (const c of categories) {
    byCategory[c.name] = HIGH.has(c.name)
      ? { years: 'Any', count: 1 }
      : MED.has(c.name)
        ? { years: 7, count: 2 }
        : { years: 5, count: 3 };
  }
  return { byCategory };
}

// ---------- Step 9: evaluation ----------
export interface EvaluatedCharge {
  charge: Charge;
  map: MapResult;
  category: string | null;
  subcategory: string | null;
  severity: Severity;
  countsTowardBreach: boolean;
  note: string;
}

export interface CategoryTally {
  category: string;
  code: string;
  rule: CategoryRule;
  convictionsInWindow: number;
  breach: boolean;
  pending: number;
  bySubcategory: Record<string, number>; // convictions in window, per subcategory
}

export type Overall = 'Clear' | 'Review' | 'Flagged';

export interface Adjudication {
  overall: Overall;
  evaluated: EvaluatedCharge[];
  tallies: CategoryTally[]; // only categories in play
  breaches: CategoryTally[];
  dedup: DedupResult;
}

function withinWindow(yearsAgo: number, years: number | 'Any'): boolean {
  return years === 'Any' ? true : yearsAgo <= years;
}

export function evaluate(charges: Charge[], ruleset: Ruleset = defaultRuleset()): Adjudication {
  const ded = dedup(charges);

  const evaluated: EvaluatedCharge[] = ded.deduped.map((charge) => {
    const map = mapCharge({ description: charge.description, state: charge.state, statuteCode: charge.statuteCode });
    const severity = charge.severity ?? map.severityHint ?? 'Unknown';
    const category = map.category;
    let countsTowardBreach = false;
    let note: string;
    if (!category) {
      note = 'unmapped — would route to AI / human';
    } else if (charge.disposition === 'Dismissed' || charge.disposition === 'Acquitted') {
      note = `${charge.disposition.toLowerCase()} — not counted`;
    } else if (charge.disposition === 'Pending') {
      note = 'pending — held for review, not counted';
    } else {
      const rule = ruleset.byCategory[category];
      if (rule && withinWindow(charge.yearsAgo, rule.years)) {
        countsTowardBreach = true;
        note = `counts toward ${category} (within ${rule.years === 'Any' ? 'any window' : rule.years + 'y'})`;
      } else {
        note = `outside ${rule ? rule.years + 'y' : ''} lookback — not counted`;
      }
    }
    return { charge, map, category, subcategory: map.subcategory, severity, countsTowardBreach, note };
  });

  // tally per category in play
  const tallies: CategoryTally[] = [];
  const inPlay = new Set(evaluated.map((e) => e.category).filter((c): c is string => !!c));
  for (const category of inPlay) {
    const rule = ruleset.byCategory[category] ?? { years: 'Any', count: 1 };
    const forCat = evaluated.filter((e) => e.category === category);
    const convictionsInWindow = forCat.filter((e) => e.countsTowardBreach).length;
    const pending = forCat.filter((e) => e.charge.disposition === 'Pending').length;
    const bySubcategory: Record<string, number> = {};
    for (const e of forCat) if (e.countsTowardBreach && e.subcategory) bySubcategory[e.subcategory] = (bySubcategory[e.subcategory] ?? 0) + 1;
    tallies.push({
      category,
      code: categoryByName.get(category)?.code ?? '—',
      rule,
      convictionsInWindow,
      breach: convictionsInWindow >= rule.count,
      pending,
      bySubcategory,
    });
  }
  tallies.sort((a, b) => Number(b.breach) - Number(a.breach) || b.convictionsInWindow - a.convictionsInWindow);

  const breaches = tallies.filter((t) => t.breach);
  const anyPending = evaluated.some((e) => e.charge.disposition === 'Pending' && e.category);
  const overall: Overall = breaches.length ? 'Flagged' : anyPending ? 'Review' : 'Clear';

  return { overall, evaluated, tallies, breaches, dedup: ded };
}
