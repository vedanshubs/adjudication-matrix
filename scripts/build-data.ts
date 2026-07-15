/*
 * build-data.ts — compile the source spreadsheets into typed JSON the app reads from.
 *
 * Inputs  (Data/):
 *   Mappings/Criminal_Category_Mapping_v5.xlsx      -> taxonomy (32 categories, subcategories)
 *   Mappings/files (1)/{WI,AR,TN,IL}_..._Updated.csv -> knowledge base (v5-conformed)
 *
 * Outputs (src/core/generated/):
 *   taxonomy.json   { categories: [...] }
 *   kb.json         { entries: [...] }
 *
 * Run: npm run build:data
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import type { Anchor, AnchorSet, Category, CategoryType, KBEntry, Severity, Taxonomy, KnowledgeBase } from '../src/core/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'Data');
const OUT = path.join(ROOT, 'src', 'core', 'generated');

const V5 = path.join(DATA, 'Mappings', 'Criminal_Category_Mapping_v5.xlsx');
const STATE_DIR = path.join(DATA, 'Mappings', 'files (1)');
const STATES: Record<string, string> = {
  WI: 'WI_Wisconsin_Master_Updated.csv',
  AR: 'AR_Arkansas_Master_Updated.csv',
  TN: 'TN_Tennessee_Master_Updated.csv',
  IL: 'IL_Illinois_Master_Updated.csv',
};

type Row = Record<string, string>;

function readRows(file: string): Row[] {
  const wb = XLSX.readFile(file, { raw: false });
  return XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
}

/** Column names differ across masters (snake_case vs Title Case); resolve by candidates. */
function col(row: Row, ...candidates: string[]): string {
  for (const c of candidates) if (c in row) return String(row[c] ?? '').trim();
  return '';
}

function severityOf(classification: string): Severity {
  const t = classification.toLowerCase();
  if (/felony/.test(t)) return 'Felony';
  if (/misdemeanor/.test(t)) return 'Misdemeanor';
  if (/infraction|traffic|violation|civil|administrative/.test(t)) return 'Infraction';
  return 'Unknown';
}

function parseAltCitations(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[;,|\n]+/)
    .map((s) => s.trim())
    .filter((s) => s && s.toUpperCase() !== 'NULL');
}

// ---------- taxonomy ----------
function buildTaxonomy(): Taxonomy {
  const wb = XLSX.readFile(V5, { raw: false });
  const index = XLSX.utils.sheet_to_json<Row>(wb.Sheets['Category Index'], { defval: '' });
  const mapping = XLSX.utils.sheet_to_json<Row>(wb.Sheets['Category Mapping'], { defval: '' });

  const subs: Record<string, string[]> = {};
  for (const r of mapping) {
    const name = String(r['Category Name'] ?? '').trim();
    const sub = String(r['Subcategory'] ?? '').trim();
    if (!name) continue;
    (subs[name] ??= []);
    if (sub && !subs[name].includes(sub)) subs[name].push(sub);
  }

  const categories: Category[] = index
    .map((r): Category => ({
      code: String(r['Code'] ?? '').trim(),
      name: String(r['Category Name'] ?? '').trim(),
      type: (String(r['Type'] ?? '').trim() as CategoryType) || 'Criminal',
      subcategories: subs[String(r['Category Name'] ?? '').trim()] ?? [],
    }))
    .filter((c) => c.code && c.name);

  return { builtAt: new Date().toISOString(), source: path.basename(V5), categories };
}

// ---------- Tier 3 keyword anchors (v5-native) ----------
function buildAnchors(): AnchorSet {
  const wb = XLSX.readFile(V5, { raw: false });
  const mapping = XLSX.utils.sheet_to_json<Row>(wb.Sheets['Category Mapping'], { defval: '' });
  const anchors: Anchor[] = [];
  const seen = new Set<string>();
  const add = (phrase: string, category: string, subcategory: string, source: Anchor['source']) => {
    const clean = phrase.replace(/^[A-Z]{2}:\s*/, '').trim(); // drop "CA:" state note prefixes
    const key = clean.toLowerCase();
    if (clean.length < 3 || seen.has(key)) return;
    seen.add(key);
    anchors.push({ phrase: clean, category, subcategory, source });
  };
  for (const r of mapping) {
    const category = String(r['Category Name'] ?? '').trim();
    const subcategory = String(r['Subcategory'] ?? '').trim();
    if (!category) continue;
    if (subcategory) add(subcategory, category, subcategory, 'subcategory');
    for (const phrase of String(r['Offense Examples (from State CSVs)'] ?? '').split(/[;|]+/)) {
      const p = phrase.trim();
      if (p) add(p, category, subcategory, 'example');
    }
  }
  return { builtAt: new Date().toISOString(), source: path.basename(V5), anchors };
}

// ---------- knowledge base ----------
function buildKB(): KnowledgeBase {
  const entries: KBEntry[] = [];
  const sources: string[] = [];
  for (const [state, file] of Object.entries(STATES)) {
    const full = path.join(STATE_DIR, file);
    sources.push(file);
    const rows = readRows(full);
    const seen = new Set<string>();
    for (const r of rows) {
      const description = col(r, 'Offense_Description', 'Offense Description');
      const category = col(r, 'State_Category', 'State Category');
      if (!description || !category) continue;
      const key = description.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        state,
        category,
        subcategory: col(r, 'Subcategory'),
        severity: severityOf(col(r, 'Offense_Classification', 'Offense Classification')),
        description,
        statuteTitle: col(r, 'Statutory_Title', 'Statutory Title'),
        statuteNumber: col(r, 'Statute_Number', 'Statute Number'),
        altCitations: parseAltCitations(col(r, 'Alternate_Citations', 'Alternate Citations')),
      });
    }
  }
  return { builtAt: new Date().toISOString(), sources, entries };
}

// ---------- write ----------
function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const taxonomy = buildTaxonomy();
  const kb = buildKB();
  const anchors = buildAnchors();
  fs.writeFileSync(path.join(OUT, 'taxonomy.json'), JSON.stringify(taxonomy));
  fs.writeFileSync(path.join(OUT, 'kb.json'), JSON.stringify(kb));
  fs.writeFileSync(path.join(OUT, 'anchors.json'), JSON.stringify(anchors));

  const subTotal = taxonomy.categories.reduce((n, c) => n + c.subcategories.length, 0);
  const byState = kb.entries.reduce<Record<string, number>>((m, e) => ((m[e.state] = (m[e.state] ?? 0) + 1), m), {});
  console.log(`taxonomy: ${taxonomy.categories.length} categories, ${subTotal} subcategories`);
  console.log(`kb: ${kb.entries.length} entries`, byState);
  console.log(`anchors: ${anchors.anchors.length} keyword phrases`);
  console.log(`-> ${path.relative(ROOT, OUT)}/{taxonomy,kb,anchors}.json`);
}

main();
