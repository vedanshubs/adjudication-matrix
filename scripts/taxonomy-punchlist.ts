/*
 * taxonomy-punchlist.ts — isolate TAXONOMY problems from MODEL problems.
 *
 * Joins the per-charge results of Option A (embedder+reranker) and the Qwen LLM baseline
 * against the human gold. The key signal:
 *   - BOTH wrong  -> the taxonomy/label is the problem (two very different systems agree it isn't
 *                    what the gold says). Highest-value fix — no model change helps.
 *   - BOTH wrong AND both picked the SAME category -> the gold convention itself is contestable.
 *   - Only one wrong -> a model weakness, not a taxonomy issue.
 *
 * Output: eval/taxonomy_punchlist.md (shareable with the KB team) + .xlsx
 * Run: npm run punchlist
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'eval');
const read = (f: string, sheet: string) => XLSX.utils.sheet_to_json<any>(XLSX.readFile(path.join(DIR, f)).Sheets[sheet]);

const optA = new Map(read('score_optionA.xlsx', 'Scores').map((r) => [Number(r.id), r]));
const llm = read('score_qwen.xlsx', 'LLM');

interface Row { id: number; charge: string; gold: string; a: string; q: string; aOk: boolean; qOk: boolean; agree: boolean; }
const rows: Row[] = [];
for (const q of llm) {
  const a = optA.get(Number(q.id));
  if (!a) continue;
  rows.push({
    id: Number(q.id), charge: String(q.charge), gold: String(q.gold_cat),
    a: String(a.pred_cat), q: String(q.pred_cat),
    aOk: a.cat_ok === true || a.cat_ok === 'true', qOk: q.cat_ok === true || q.cat_ok === 'true',
    agree: String(a.pred_cat) === String(q.pred_cat),
  });
}

const bothWrong = rows.filter((r) => !r.aOk && !r.qOk);
const bothWrongAgree = bothWrong.filter((r) => r.agree); // strongest: both independently picked the same non-gold answer
const onlyA = rows.filter((r) => !r.aOk && r.qOk);
const onlyQ = rows.filter((r) => r.aOk && !r.qOk);
const bothRight = rows.filter((r) => r.aOk && r.qOk);

// group both-wrong by confusion pair (gold -> what they said)
const pairs = new Map<string, Row[]>();
for (const r of bothWrong) {
  const key = `${r.gold}  →  ${r.agree ? r.a : `${r.a} (A) / ${r.q} (LLM)`}`;
  (pairs.get(key) ?? pairs.set(key, []).get(key)!).push(r);
}
const ranked = [...pairs.entries()].sort((x, y) => y[1].length - x[1].length);

// ---- markdown punch list ----
const pct = (n: number) => ((100 * n) / rows.length).toFixed(1) + '%';
const md: string[] = [];
md.push('# Taxonomy Punch List — for the KB team\n');
md.push(`_Generated from the ${rows.length}-charge human-verified gold set. Two independent systems were run:_`);
md.push('_**Option A** (self-hosted embedder + cross-encoder reranker) and **Qwen3-32B** (LLM, AWS Bedrock)._\n');
md.push('## Why this list matters\n');
md.push('When two *very different* systems independently disagree with the gold label **in the same way**, the problem is almost never the model — it is that the **category boundary or subcategory is ambiguous**. These are the fixes that raise accuracy for *every* approach at once. A bigger model does not help here.\n');
md.push('## Summary\n');
md.push('| | Charges | Share |');
md.push('|---|---:|---:|');
md.push(`| Both systems correct | ${bothRight.length} | ${pct(bothRight.length)} |`);
md.push(`| **Both wrong → taxonomy signal** | **${bothWrong.length}** | **${pct(bothWrong.length)}** |`);
md.push(`| &nbsp;&nbsp;…of which both picked the *same* answer (gold convention contestable) | ${bothWrongAgree.length} | ${pct(bothWrongAgree.length)} |`);
md.push(`| Only Option A wrong (model weakness) | ${onlyA.length} | ${pct(onlyA.length)} |`);
md.push(`| Only the LLM wrong (model weakness) | ${onlyQ.length} | ${pct(onlyQ.length)} |`);
md.push('\n## Confusion patterns to resolve (ranked by frequency)\n');
for (const [key, rs] of ranked) {
  md.push(`### ${key}  — ${rs.length} charge${rs.length === 1 ? '' : 's'}`);
  for (const r of rs.slice(0, 6)) md.push(`- \`${r.charge.slice(0, 80)}\``);
  md.push('');
}
md.push('## Recommended actions\n');
md.push('1. **Disambiguate the traffic family.** `Moving Violations & Traffic Offenses` vs `Impaired Driving` vs `Commercial Transportation` — driving-while-suspended / revoked / under-restraint charges collide across all three. Consider explicit rules for DWS/DUS/DWLS and clearer subcategory names.');
md.push('2. **Clarify the Fraud / Financial Crimes / Theft boundary.** `Theft of Property (tiered by value)` currently sits under **Financial Crimes** while `Petty Theft / Retail Theft` sits under **Theft & Property Crimes** — so generic "theft" and "grand theft" are genuinely ambiguous. Same for bank/wire/mail fraud (Fraud & Forgery vs Financial Crimes).');
md.push('3. **Add anchor examples for the thin categories.** Where both systems miss, the v5 `Offense Examples` column is usually sparse — richer examples directly improve the deterministic tier *and* the AI shortlist.');
md.push('4. **Revisit the gold convention where both systems agree against it** (see the “same answer” rows above) — the label may be the thing that is wrong.');
fs.writeFileSync(path.join(DIR, 'taxonomy_punchlist.md'), md.join('\n'));

// ---- xlsx ----
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bothWrong.map((r) => ({
  id: r.id, charge: r.charge, gold_category: r.gold, optionA_said: r.a, llm_said: r.q, both_said_same: r.agree,
}))), 'BothWrong');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((r) => ({
  id: r.id, charge: r.charge, gold: r.gold, optionA: r.a, optionA_ok: r.aOk, llm: r.q, llm_ok: r.qOk,
}))), 'All');
XLSX.writeFile(wb, path.join(DIR, 'taxonomy_punchlist.xlsx'));

console.log(`joined ${rows.length} charges`);
console.log(`  both correct:        ${bothRight.length} (${pct(bothRight.length)})`);
console.log(`  BOTH WRONG:          ${bothWrong.length} (${pct(bothWrong.length)})  <- taxonomy signal`);
console.log(`    ...same answer:    ${bothWrongAgree.length}  <- gold convention contestable`);
console.log(`  only Option A wrong: ${onlyA.length}`);
console.log(`  only LLM wrong:      ${onlyQ.length}`);
console.log('\nTop confusion patterns:');
ranked.slice(0, 8).forEach(([k, rs]) => console.log(`  ${String(rs.length).padStart(2)}x  ${k}`));
console.log('\nWrote eval/taxonomy_punchlist.md and .xlsx');
