/*
 * eval-statute.ts — Set B: validate the statute-code path (Tier 1) using the law books.
 *
 * Prod has no codes, so Tier 1 can't be tested from prod. But the KB carries ~40k
 * alternate-citation spellings. The KB itself is ground truth for code -> category, so
 * this needs no human labeling. It measures:
 *   1. Code inventory: distinct (state, canonical-code) keys.
 *   2. Ambiguity: keys that map to MORE THAN ONE category (real collisions / base-code sharing).
 *   3. Data quality: alt-citation entries that aren't codes at all.
 *   4. Canonicalization robustness: do common formatting variants of a real code still match?
 *
 * Run: npm run eval:statute
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { knowledgeBase } from '../src/core/data.ts';
import { canonicalizeCode } from '../src/core/mapping.ts';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'eval');
const isCodeLike = (s: string) => /\d/.test(s) && canonicalizeCode(s).length >= 3;

// gather every (statuteNumber + altCitations) spelling with its owning offense
interface Spelling { raw: string; canon: string; state: string; category: string; subcategory: string; codeLike: boolean; }
const spellings: Spelling[] = [];
for (const e of knowledgeBase.entries) {
  for (const raw of [e.statuteNumber, ...e.altCitations]) {
    if (!raw) continue;
    spellings.push({ raw, canon: canonicalizeCode(raw), state: e.state, category: e.category, subcategory: e.subcategory, codeLike: isCodeLike(raw) });
  }
}

// ---- 1 & 2: inventory + ambiguity over code-like keys ----
const keyToCats = new Map<string, Set<string>>();
const keyExample = new Map<string, string>();
for (const s of spellings) {
  if (!s.codeLike) continue;
  const key = `${s.state}|${s.canon}`;
  (keyToCats.get(key) ?? keyToCats.set(key, new Set()).get(key)!).add(s.category);
  if (!keyExample.has(key)) keyExample.set(key, s.raw);
}
const keys = [...keyToCats.entries()];
const ambiguous = keys.filter(([, cats]) => cats.size > 1);

// ---- 3: data quality (non-code junk in the citation columns) ----
const junk = spellings.filter((s) => !s.codeLike);
const junkExamples = [...new Set(junk.map((s) => s.raw))].filter((r) => !/\d/.test(r)).slice(0, 10);

// ---- 4: canonicalization robustness (does an unseen formatting still match?) ----
const indexed = new Set(keys.map(([k]) => k));
const mutations: [string, (c: string) => string][] = [
  ['dots→hyphens', (c) => c.replace(/\./g, '-')],
  ['strip § and spaces', (c) => c.replace(/[§\s]/g, '')],
  ['strip parens', (c) => c.replace(/[()]/g, '')],
  ['spaces for dots', (c) => c.replace(/\./g, ' ')],
];
const sample = spellings.filter((s) => s.codeLike && /[.\s()§]/.test(s.raw)).slice(0, 4000);
const robustness = mutations.map(([name, fn]) => {
  let tested = 0, matched = 0;
  for (const s of sample) {
    const mutated = fn(s.raw);
    if (mutated === s.raw) continue;
    tested++;
    if (indexed.has(`${s.state}|${canonicalizeCode(mutated)}`)) matched++;
  }
  return { name, tested, matched, rate: tested ? matched / tested : 1 };
});

// ---- report ----
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + '%' : '—');
console.log('=== Set B — Statute-code (Tier 1) validation ===\n');
console.log(`Offenses in KB:            ${knowledgeBase.entries.length}`);
console.log(`Citation spellings total:  ${spellings.length}`);
console.log(`  code-like:               ${spellings.filter((s) => s.codeLike).length}`);
console.log(`  non-code (junk):         ${junk.length}  (${pct(junk.length, spellings.length)})`);
console.log(`\nDistinct (state, code) keys: ${keys.length}`);
console.log(`  AMBIGUOUS (map to >1 category): ${ambiguous.length}  (${pct(ambiguous.length, keys.length)})`);
console.log('\nSample ambiguous keys:');
ambiguous.slice(0, 8).forEach(([k, cats]) => console.log(`  ${k.padEnd(22)} "${keyExample.get(k)}" -> {${[...cats].join(', ')}}`));
console.log('\nData-quality — non-code entries sitting in the citation columns:');
junkExamples.forEach((r) => console.log(`  "${r}"`));
console.log('\nCanonicalization robustness (does a reformatted code still match its indexed key?):');
robustness.forEach((r) => console.log(`  ${r.name.padEnd(20)} ${pct(r.matched, r.tested)}  (${r.matched}/${r.tested})`));

// write the ambiguous keys for the KB team
fs.mkdirSync(OUT, { recursive: true });
const csv = ['state,canonical_code,example_spelling,categories', ...ambiguous.map(([k, cats]) => {
  const [state, code] = k.split('|');
  return `${state},${code},"${keyExample.get(k)}","${[...cats].join(' | ')}"`;
})].join('\n');
fs.writeFileSync(path.join(OUT, 'statute_ambiguous_keys.csv'), csv);
console.log(`\nWrote eval/statute_ambiguous_keys.csv (${ambiguous.length} rows)`);
