/*
 * build-goldset.ts — Set A: stratified gold-set sampler from PROD charges.
 *
 * Pulls distinct real charges (exclude rule applied), stratifies so the sample isn't
 * dominated by easy high-frequency charges, pre-fills the machine's deterministic
 * prediction for context, and exports an xlsx labeling sheet with BLANK human-label
 * columns (plus a blind subset where the machine guess is hidden, to measure anchoring).
 *
 * Run: npm run build:goldset
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { mapCharge, normalize } from '../src/core/mapping.ts';
import { taxonomy } from '../src/core/data.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROD = path.join(ROOT, 'Data', 'Prod Data', 'ProdPR5kCharges7-2-2026.xls');
const OUT = path.join(ROOT, 'eval', 'goldset_v1.xlsx');
const TARGET = 200;
const BLIND_FRAC = 0.2;
const KEEP = /^(county_criminal|statewide_criminal|federal_national_criminal|federal_criminal_criminal)$/i;

// deterministic RNG so the gold set is reproducible
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);
const pickWeighted = <T>(items: T[], weight: (t: T) => number, n: number): T[] => {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, x) => s + weight(x), 0);
    let r = rng() * total;
    let i = 0;
    for (; i < pool.length; i++) { r -= weight(pool[i]); if (r <= 0) break; }
    out.push(pool.splice(Math.min(i, pool.length - 1), 1)[0]);
  }
  return out;
};

// ---- load + dedup prod charges ----
const wb = XLSX.readFile(PROD, { raw: false });
const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
interface Charge { desc: string; state: string; freq: number; states: Set<string>; tier: string; category: string; subcategory: string; conf: string; }
const byKey = new Map<string, Charge>();
for (const r of rows) {
  if (!KEEP.test(String(r['searchType']).trim())) continue;
  let desc = String(r['chargeOther']).trim();
  if (!desc || desc.toUpperCase() === 'NULL') desc = String(r['charge']).trim();
  if (!desc || desc.toUpperCase() === 'NULL') continue;
  const key = normalize(desc);
  if (!key) continue;
  const state = String(r['State']).trim();
  const existing = byKey.get(key);
  if (existing) { existing.freq++; if (state) existing.states.add(state); continue; }
  const m = mapCharge({ description: desc, state: state || undefined });
  byKey.set(key, {
    desc, state, freq: 1, states: new Set(state ? [state] : []),
    tier: m.resolvedBy ?? 'AI-deferred', category: m.category ?? '', subcategory: m.subcategory ?? '', conf: m.confidence,
  });
}
const charges = [...byKey.values()];
const bucket = (t: string) => (t.startsWith('Tier1') || t.startsWith('Tier2') ? 'exact' : t.startsWith('Tier3') ? 'keyword' : 'deferred');

// ---- stratified selection ----
const chosen = new Map<string, { c: Charge; stratum: string }>();
const add = (c: Charge, stratum: string) => { if (!chosen.has(c.desc)) chosen.set(c.desc, { c, stratum }); };

// 1) frequency-weighted (reflects reality) — 45%
pickWeighted(charges, (c) => c.freq, Math.round(TARGET * 0.45)).forEach((c) => add(c, 'frequency'));
// 2) hard: oversample AI-deferred (what the AI/human actually handle) — 30%
const deferred = charges.filter((c) => bucket(c.tier) === 'deferred');
pickWeighted(deferred, (c) => c.freq, Math.round(TARGET * 0.3)).forEach((c) => add(c, 'hard-AI'));
// 3) category-balanced: ensure every predicted category appears (rare ones too) — fill
const byCat = new Map<string, Charge[]>();
for (const c of charges) if (c.category) (byCat.get(c.category) ?? byCat.set(c.category, []).get(c.category)!).push(c);
for (const [, list] of byCat) pickWeighted(list, () => 1, 2).forEach((c) => add(c, 'category-balanced'));
// 4) edge: very short / abbreviated
charges.filter((c) => c.desc.length <= 12).slice(0, Math.round(TARGET * 0.05)).forEach((c) => add(c, 'edge-short'));

const sample = [...chosen.values()].slice(0, TARGET);

// ---- build the labeling sheet ----
const records = sample.map((s, i) => {
  const blind = rng() < BLIND_FRAC;
  return {
    id: i + 1,
    stratum: s.stratum,
    state: s.c.state || [...s.c.states][0] || '',
    charge_text: s.c.desc,
    statute_code: '', // prod is description-only
    prod_frequency: s.c.freq,
    machine_tier: blind ? '(blind)' : s.c.tier,
    machine_category: blind ? '(blind)' : s.c.category,
    machine_subcategory: blind ? '(blind)' : s.c.subcategory,
    machine_confidence: blind ? '(blind)' : s.c.conf,
    HUMAN_category: '',
    HUMAN_subcategory: '',
    is_criminal: '',
    flag: '', // not-a-charge / non-criminal / ambiguous / multi-offense
    difficulty: '',
    notes: '',
  };
});

const wbOut = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbOut, XLSX.utils.json_to_sheet(records), 'GoldSet');

// reference sheet: valid v5 categories + subcategories
const ref = taxonomy.categories.flatMap((c) => c.subcategories.map((s) => ({ Code: c.code, Category: c.name, Subcategory: s })));
XLSX.utils.book_append_sheet(wbOut, XLSX.utils.json_to_sheet(ref), 'Categories');

// instructions sheet
const instr = [
  ['Gold-set labeling instructions'],
  [''],
  ['Fill HUMAN_category and HUMAN_subcategory with the CORRECT values (see the Categories sheet for valid options).'],
  ['is_criminal: yes / no  (is this actually a criminal charge, vs civil/administrative?)'],
  ['flag: leave blank, or one of: not-a-charge, non-criminal, ambiguous, multi-offense, amended'],
  ['difficulty: easy / medium / hard'],
  ['Do NOT look at machine_* columns for the (blind) rows — label those from scratch (measures anchoring).'],
  ['Label independently of the machine guess even on non-blind rows; the guess is context only.'],
];
XLSX.utils.book_append_sheet(wbOut, XLSX.utils.aoa_to_sheet(instr), 'Instructions');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
XLSX.writeFile(wbOut, OUT);

// ---- report ----
const by = (f: (r: (typeof records)[0]) => string) => records.reduce<Record<string, number>>((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {});
console.log(`Distinct kept prod charges: ${charges.length}`);
console.log(`Gold set: ${records.length} charges  (blind subset: ${records.filter((r) => r.machine_tier === '(blind)').length})`);
console.log('By stratum:', by((r) => r.stratum));
console.log('By machine tier:', by((r) => r.machine_tier));
console.log(`Distinct predicted categories covered: ${new Set(sample.map((s) => s.c.category).filter(Boolean)).size} / ${taxonomy.categories.length}`);
console.log(`\nWrote ${path.relative(ROOT, OUT)}  (sheets: GoldSet, Categories, Instructions)`);
