/*
 * eval-score.ts — score Option A against the human-verified gold set, with a threshold sweep.
 *
 * Runs the deterministic cascade; for deferred charges runs the AI tier ONCE to capture the
 * reranked shortlist, then re-decides at several thresholds (decide() is pure) to trace the
 * precision-vs-coverage curve. Reports accuracy on auto-decided charges, per tier, and a
 * confusion list.
 *
 * Run: npm run eval:score   (loads the AI models; ~1 min)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { mapCharge } from '../src/core/mapping.ts';
import { classifyWithAI, decide, AI_THRESHOLD, type Candidate } from '../src/core/ai.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'eval');
type Row = Record<string, string>;

interface Item { id: number; charge: string; state: string; goldCat: string; goldSub: string; detCat: string; detSub: string; detTier: string; shortlist?: Candidate[]; }

const rows = XLSX.utils.sheet_to_json<Row>(XLSX.readFile(path.join(DIR, 'goldset_v1_judged.xlsx')).Sheets['GoldSet']);
const gold = rows.filter((r) => String(r.HUMAN_category).trim());

// gather (run AI once per deferred charge)
const items: Item[] = [];
let n = 0;
for (const r of gold) {
  const charge = String(r.charge_text);
  const det = mapCharge({ description: charge, state: String(r.state) || undefined });
  const item: Item = { id: Number(r.id), charge, state: String(r.state), goldCat: String(r.HUMAN_category), goldSub: String(r.HUMAN_subcategory), detCat: det.category ?? '', detSub: det.subcategory ?? '', detTier: det.resolvedBy ?? '' };
  if (!det.category) item.shortlist = (await classifyWithAI(charge)).shortlist;
  items.push(item);
  if (++n % 20 === 0) process.stderr.write(`  scored ${n}/${gold.length}\r`);
}

interface Pred { predCat: string; predSub: string; auto: boolean; tier: string; }
function predictAt(item: Item, threshold: number): Pred {
  if (item.detCat) return { predCat: item.detCat, predSub: item.detSub, auto: true, tier: item.detTier };
  const d = decide(item.shortlist!, threshold);
  if (d.outcome === 'accept') return { predCat: d.category!, predSub: d.subcategory!, auto: true, tier: 'AI:accept' };
  if (d.outcome === 'category-only') return { predCat: d.category!, predSub: '', auto: true, tier: 'AI:category-only' };
  return { predCat: d.consensusCategory, predSub: '', auto: false, tier: 'AI:reject' };
}

const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) + '%' : '—');
function metrics(threshold: number) {
  const ps = items.map((it) => ({ it, p: predictAt(it, threshold) }));
  const auto = ps.filter((x) => x.p.auto);
  const catOkAuto = auto.filter((x) => x.p.predCat === x.it.goldCat).length;
  const subOkAuto = auto.filter((x) => x.p.predCat === x.it.goldCat && x.p.predSub === x.it.goldSub).length;
  return { ps, coverage: auto.length / items.length, catAuto: catOkAuto / auto.length, subAuto: subOkAuto / auto.length, autoN: auto.length };
}

// --- report at the default threshold ---
const m = metrics(AI_THRESHOLD);
console.log(`\n=== Option A — scored against human gold (${items.length} charges) @ threshold ${AI_THRESHOLD} ===\n`);
console.log(`COVERAGE (auto-decided):        ${m.autoN}/${items.length} = ${pct(m.autoN, items.length)}`);
console.log(`Category accuracy (auto):       ${pct(m.catAuto * m.autoN, m.autoN)}`);
console.log(`Subcategory accuracy (auto):    ${pct(m.subAuto * m.autoN, m.autoN)}`);

// per tier
const tiers = [...new Set(m.ps.map((x) => x.p.tier))].sort();
console.log('\nBy tier:  (n · category-acc · subcat-acc)');
for (const t of tiers) {
  const rs = m.ps.filter((x) => x.p.tier === t);
  const c = rs.filter((x) => x.p.predCat === x.it.goldCat).length;
  const s = rs.filter((x) => x.p.predCat === x.it.goldCat && x.p.predSub === x.it.goldSub).length;
  console.log(`  ${t.padEnd(16)} ${String(rs.length).padStart(3)}   cat ${pct(c, rs.length)} · sub ${pct(s, rs.length)}`);
}

// --- threshold sweep (the dial) ---
console.log('\nPrecision-vs-coverage (reranker threshold sweep — affects AI-tier charges only):');
console.log('  threshold   coverage   category-acc(auto)');
for (const t of [0.3, 0.5, 0.7, 0.85, 0.9, 0.95]) {
  const s = metrics(t);
  console.log(`    ${t.toFixed(2)}       ${pct(s.autoN, items.length).padStart(6)}      ${pct(s.catAuto * s.autoN, s.autoN)}`);
}

// confusion at default
console.log('\nWrong category (auto-decided):');
m.ps.filter((x) => x.p.auto && x.p.predCat !== x.it.goldCat).slice(0, 15).forEach((x) => console.log(`  [${x.p.tier}] "${x.it.charge.slice(0, 40)}"  pred ${x.p.predCat} · gold ${x.it.goldCat}`));

// per-charge results (needed to join against the LLM baseline for the taxonomy punch list)
const perCharge = m.ps.map(({ it, p }) => ({
  id: it.id, charge: it.charge, state: it.state, tier: p.tier, auto: p.auto,
  gold_cat: it.goldCat, pred_cat: p.predCat, cat_ok: p.predCat === it.goldCat,
  gold_sub: it.goldSub, pred_sub: p.predSub, sub_ok: p.predCat === it.goldCat && p.predSub === it.goldSub,
}));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(perCharge), 'Scores');
XLSX.writeFile(wb, path.join(DIR, 'score_optionA.xlsx'));
fs.writeFileSync(path.join(DIR, 'score_optionA.json'), JSON.stringify({ threshold: AI_THRESHOLD, coverage: m.coverage, catAccAuto: m.catAuto, subAccAuto: m.subAuto }, null, 1));
console.log('\nWrote eval/score_optionA.{xlsx,json}');
