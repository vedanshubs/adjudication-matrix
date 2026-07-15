/*
 * merge-judge-labels.ts — fill the HUMAN_* columns of the gold set from judge_labels.json.
 * Validates each category/subcategory against the v5 taxonomy (fuzzy on dashes/spacing) and
 * snaps to the canonical name; reports anything that doesn't match. Writes goldset_v1_judged.xlsx.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { taxonomy, categoryByCode } from '../src/core/data.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'eval');
const norm = (s: string) => s.toLowerCase().replace(/[—–-]/g, '-').replace(/\s+/g, ' ').trim();

interface Label { id: number; cat: string; sub: string; crim: string; flag: string; diff: string; notes: string; }
const labels: Label[] = JSON.parse(fs.readFileSync(path.join(DIR, 'judge_labels.json'), 'utf8'));
const byId = new Map(labels.map((l) => [l.id, l]));

const problems: string[] = [];
function resolve(l: Label): { category: string; subcategory: string } {
  if (!l.cat) return { category: '', subcategory: '' };
  const cat = categoryByCode.get(l.cat);
  if (!cat) { problems.push(`id ${l.id}: unknown category code "${l.cat}"`); return { category: l.cat, subcategory: l.sub }; }
  const match = cat.subcategories.find((s) => norm(s) === norm(l.sub));
  if (!match) problems.push(`id ${l.id}: subcategory "${l.sub}" not found under ${cat.name}`);
  return { category: cat.name, subcategory: match ?? l.sub };
}

const wb = XLSX.readFile(path.join(DIR, 'goldset_v1.xlsx'));
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['GoldSet']);
for (const r of rows) {
  const l = byId.get(Number(r.id));
  if (!l) continue;
  const { category, subcategory } = resolve(l);
  r.HUMAN_category = category;
  r.HUMAN_subcategory = subcategory;
  r.is_criminal = l.crim;
  r.flag = l.flag;
  r.difficulty = l.diff;
  r.notes = l.notes;
}

// rebuild the workbook (keep Categories + Instructions sheets)
const out = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(rows), 'GoldSet');
for (const name of ['Categories', 'Instructions']) if (wb.Sheets[name]) XLSX.utils.book_append_sheet(out, wb.Sheets[name], name);
XLSX.writeFile(out, path.join(DIR, 'goldset_v1_judged.xlsx'));

console.log(`Filled ${rows.filter((r) => r.HUMAN_category || r.flag).length}/${rows.length} rows.`);
console.log(problems.length ? `\n⚠ ${problems.length} validation problems:\n  ` + problems.join('\n  ') : '✓ all categories/subcategories valid against v5');
// quick distribution
const dist = labels.reduce<Record<string, number>>((m, l) => ((m[l.cat || '(none)'] = (m[l.cat || '(none)'] ?? 0) + 1), m), {});
console.log('\nBy category:', Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
console.log(`\nWrote eval/goldset_v1_judged.xlsx  (taxonomy: ${taxonomy.categories.length} categories)`);
