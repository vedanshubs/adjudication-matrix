/*
 * eval-recall.ts — measure the RAG ceiling.
 *
 * For every gold charge, embed it, retrieve the top-K anchors, and ask:
 *   is the CORRECT category present anywhere in the top-K?  (and the correct subcategory?)
 *
 * This is the hard upper bound for a retrieve-then-LLM-picks design: if the right answer
 * isn't retrieved, no LLM downstream can recover it. No LLM calls needed.
 *
 * Run: npm run eval:recall
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { mapCharge } from '../src/core/mapping.ts';
import { retrieve } from '../src/core/ai.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'eval');
const KS = [1, 3, 5, 8, 10, 20];

const rows = XLSX.utils.sheet_to_json<Record<string, string>>(
  XLSX.readFile(path.join(DIR, 'goldset_v1_judged.xlsx')).Sheets['GoldSet'],
);
const gold = rows.filter((r) => String(r.HUMAN_category).trim());

interface Hit { id: number; charge: string; goldCat: string; goldSub: string; catRank: number; subRank: number; deferred: boolean; }
const hits: Hit[] = [];
let n = 0;
for (const r of gold) {
  const charge = String(r.charge_text);
  const goldCat = String(r.HUMAN_category);
  const goldSub = String(r.HUMAN_subcategory).trim();
  const det = mapCharge({ description: charge, state: String(r.state) || undefined });
  const cands = await retrieve(charge, Math.max(...KS));
  // rank (1-based) of the first candidate matching the gold category / subcategory; 0 = not found
  const catRank = cands.findIndex((c) => c.category === goldCat) + 1;
  const subRank = goldSub ? cands.findIndex((c) => c.category === goldCat && c.subcategory === goldSub) + 1 : -1;
  hits.push({ id: Number(r.id), charge, goldCat, goldSub, catRank, subRank, deferred: !det.category });
  if (++n % 25 === 0) process.stderr.write(`  ${n}/${gold.length}\r`);
}

const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) + '%' : '—');
function report(label: string, subset: Hit[]) {
  console.log(`\n${label}  (n=${subset.length})`);
  console.log('   K     category in top-K     subcategory in top-K');
  for (const k of KS) {
    const cat = subset.filter((h) => h.catRank > 0 && h.catRank <= k).length;
    const subScorable = subset.filter((h) => h.subRank >= 0);
    const sub = subScorable.filter((h) => h.subRank > 0 && h.subRank <= k).length;
    console.log(`  ${String(k).padStart(2)}         ${pct(cat, subset.length).padStart(6)}                ${pct(sub, subScorable.length).padStart(6)}`);
  }
}

console.log('=== RAG ceiling: is the right answer retrieved at all? ===');
report('ALL gold charges', hits);
report('Only charges the deterministic tiers DEFER (what RAG would actually handle)', hits.filter((h) => h.deferred));

// what never gets retrieved at any K — the hard ceiling
const missed = hits.filter((h) => h.catRank === 0);
console.log(`\nNever retrieved at any K (category): ${missed.length}/${hits.length} = ${pct(missed.length, hits.length)}`);
missed.slice(0, 12).forEach((h) => console.log(`   "${h.charge.slice(0, 52)}"  gold ${h.goldCat}`));
