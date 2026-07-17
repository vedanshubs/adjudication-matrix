/*
 * eval-llm.ts — LLM baseline: classify the gold charges with Qwen3-32B on AWS Bedrock,
 * constrained to the v5 taxonomy, scored identically to Option A (category + subcategory),
 * plus an off-list ("hallucination") rate.
 *
 * Requires AWS credentials in the environment:
 *   AWS_REGION (e.g. us-west-2), AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY [, AWS_SESSION_TOKEN]
 * Optional: BEDROCK_MODEL_ID (default qwen.qwen3-32b-v1:0)
 *
 * Run: npm run eval:llm
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { taxonomy } from '../src/core/data.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'eval');
// load credentials from a gitignored .env if present (AWS_REGION, AWS_BEARER_TOKEN_BEDROCK)
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env — rely on real env vars */ }

const MODEL = process.env.BEDROCK_MODEL_ID ?? 'qwen.qwen3-32b-v1:0';
const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-2';
const CONCURRENCY = Number(process.env.LLM_CONCURRENCY ?? '4');

if (!REGION) { console.error('Set AWS_REGION (and AWS credentials) first.'); process.exit(1); }
const client = new BedrockRuntimeClient({ region: REGION });

// compact catalog the model must choose from
const catalog = taxonomy.categories.map((c) => `- ${c.name}: ${c.subcategories.join('; ')}`).join('\n');
const SYSTEM = `You are a criminal-charge classifier. Assign each charge to exactly one category and one subcategory from the provided taxonomy. You may ONLY use categories and subcategories that appear in the taxonomy — never invent one. Respond with ONLY a JSON object: {"category": "...", "subcategory": "..."} and nothing else.`;

const norm = (s: string) => s.toLowerCase().replace(/[—–-]/g, '-').replace(/\s+/g, ' ').trim();

interface Call { rawCat: string; rawSub: string; inTok: number; outTok: number; ms: number; }
async function classify(charge: string): Promise<Call> {
  const cmd = new ConverseCommand({
    modelId: MODEL,
    system: [{ text: SYSTEM }],
    messages: [{ role: 'user', content: [{ text: `Taxonomy:\n${catalog}\n\nCharge: "${charge}"\n\nReturn only the JSON. /no_think` }] }],
    inferenceConfig: { maxTokens: 1500, temperature: 0 },
  });
  const t0 = Date.now();
  const res = await client.send(cmd);
  const ms = Date.now() - t0;
  const inTok = res.usage?.inputTokens ?? 0;
  const outTok = res.usage?.outputTokens ?? 0;
  const text = (res.output?.message?.content ?? []).map((c) => c.text ?? '').join('');
  // robust extraction for reasoning models: take the last flat {...} object that mentions a category
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const objs = cleaned.match(/\{[^{}]*\}/g) ?? [];
  const jsonStr = [...objs].reverse().find((o) => /category/i.test(o)) ?? objs[0];
  if (!jsonStr) return { rawCat: '', rawSub: '', inTok, outTok, ms };
  try { const j = JSON.parse(jsonStr); return { rawCat: String(j.category ?? ''), rawSub: String(j.subcategory ?? ''), inTok, outTok, ms }; }
  catch { return { rawCat: '', rawSub: '', inTok, outTok, ms }; }
}

// snap a model answer to the canonical taxonomy; flag off-list
function resolve(rawCat: string, rawSub: string) {
  const cat = taxonomy.categories.find((c) => norm(c.name) === norm(rawCat));
  if (!cat) return { category: rawCat, subcategory: rawSub, offListCat: true, offListSub: true };
  const sub = cat.subcategories.find((s) => norm(s) === norm(rawSub));
  return { category: cat.name, subcategory: sub ?? rawSub, offListCat: false, offListSub: !sub };
}

async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (i >= tries) throw e; await new Promise((r) => setTimeout(r, 500 * 2 ** i)); }
  }
}

async function main() {
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(XLSX.readFile(path.join(DIR, 'goldset_v1_judged.xlsx')).Sheets['GoldSet']);
  const gold = rows.filter((r) => String(r.HUMAN_category).trim());
  console.log(`Classifying ${gold.length} charges with ${MODEL} in ${REGION}...`);

  let out: any[] = new Array(gold.length);
  let done = 0;
  async function worker(start: number) {
    for (let i = start; i < gold.length; i += CONCURRENCY) {
      const r = gold[i];
      try {
        const c = await withRetry(() => classify(String(r.charge_text)));
        const res = resolve(c.rawCat, c.rawSub);
        out[i] = {
          id: Number(r.id), charge: String(r.charge_text),
          gold_cat: String(r.HUMAN_category), pred_cat: res.category, cat_ok: res.category === String(r.HUMAN_category),
          gold_sub: String(r.HUMAN_subcategory), pred_sub: res.subcategory, sub_ok: res.category === String(r.HUMAN_category) && res.subcategory === String(r.HUMAN_subcategory),
          off_list_cat: res.offListCat, off_list_sub: res.offListSub,
          in_tok: c.inTok, out_tok: c.outTok, ms: c.ms, failed: false,
        };
      } catch (e) {
        // transient network/throttle failure — skip this charge, don't abort the run
        out[i] = { id: Number(r.id), charge: String(r.charge_text), gold_cat: String(r.HUMAN_category), pred_cat: '', cat_ok: false, gold_sub: String(r.HUMAN_subcategory), pred_sub: '', sub_ok: false, off_list_cat: false, off_list_sub: false, in_tok: 0, out_tok: 0, ms: 0, failed: true };
      }
      if (++done % 10 === 0) process.stderr.write(`  ${done}/${gold.length}\r`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, k) => worker(k)));

  const failed = out.filter((r) => r.failed).length;
  out = out.filter((r) => !r.failed); // network failures excluded from scoring
  const n = out.length;
  const pct = (a: number) => ((100 * a) / n).toFixed(1) + '%';
  if (failed) console.log(`\n(${failed} charge(s) skipped due to transient network errors — excluded from scoring)`);
  const catOk = out.filter((r) => r.cat_ok).length;
  const subOk = out.filter((r) => r.sub_ok).length;
  const offCat = out.filter((r) => r.off_list_cat).length;
  const offSub = out.filter((r) => r.off_list_sub).length;

  // --- tokens, cost, latency ---
  const sum = (f: (r: any) => number) => out.reduce((s, r) => s + f(r), 0);
  const totalIn = sum((r) => r.in_tok), totalOut = sum((r) => r.out_tok);
  const lat = out.map((r) => r.ms).sort((a, b) => a - b);
  const p = (q: number) => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))];
  // Bedrock rates ($ per 1M tokens) — set to your account's actual Qwen3-32B price
  const PIN = Number(process.env.BEDROCK_PRICE_IN_PER_1M ?? '0');
  const POUT = Number(process.env.BEDROCK_PRICE_OUT_PER_1M ?? '0');
  const cost = (totalIn / 1e6) * PIN + (totalOut / 1e6) * POUT;
  const ratesSet = PIN > 0 || POUT > 0;

  console.log(`\n=== LLM baseline (${MODEL}) vs human gold (${n} charges) ===\n`);
  console.log('ACCURACY');
  console.log(`  Category:     ${pct(catOk)}  (${catOk}/${n})`);
  console.log(`  Subcategory:  ${pct(subOk)}  (${subOk}/${n})`);
  console.log(`  Off-list category:    ${pct(offCat)}  (invented a category not in v5)`);
  console.log(`  Off-list subcategory: ${pct(offSub)}`);
  console.log('\nTOKENS');
  console.log(`  input:  ${totalIn.toLocaleString()}  (avg ${Math.round(totalIn / n)}/charge)`);
  console.log(`  output: ${totalOut.toLocaleString()}  (avg ${Math.round(totalOut / n)}/charge)`);
  console.log('\nLATENCY (per charge)');
  console.log(`  avg ${Math.round(sum((r) => r.ms) / n)}ms · p50 ${p(0.5)}ms · p95 ${p(0.95)}ms`);
  console.log('\nCOST');
  if (ratesSet) {
    console.log(`  rates: $${PIN}/1M in · $${POUT}/1M out`);
    console.log(`  this run (${n} charges): $${cost.toFixed(4)}`);
    console.log(`  per charge: $${(cost / n).toFixed(6)}  ·  per 1,000: $${((cost / n) * 1000).toFixed(2)}  ·  per 1,000,000: $${((cost / n) * 1e6).toFixed(0)}`);
  } else {
    console.log(`  ⚠ rates not set — token counts above are exact. Add to .env to get $:`);
    console.log(`     BEDROCK_PRICE_IN_PER_1M=<price>   BEDROCK_PRICE_OUT_PER_1M=<price>`);
  }
  console.log('\nWrong category (first 15):');
  out.filter((r) => !r.cat_ok).slice(0, 15).forEach((r) => console.log(`  "${r.charge.slice(0, 40)}"  pred ${r.pred_cat} · gold ${r.gold_cat}`));

  const slug = MODEL.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out), 'LLM');
  XLSX.writeFile(wb, path.join(DIR, `score_${slug}.xlsx`));
  fs.writeFileSync(path.join(DIR, `score_${slug}.json`), JSON.stringify({
    model: MODEL, n, catAcc: catOk / n, subAcc: subOk / n, offListCat: offCat / n,
    tokens: { input: totalIn, output: totalOut, avgIn: totalIn / n, avgOut: totalOut / n },
    latencyMs: { avg: sum((r) => r.ms) / n, p50: p(0.5), p95: p(0.95) },
    cost: ratesSet ? { rateInPer1M: PIN, rateOutPer1M: POUT, run: cost, perCharge: cost / n, perMillion: (cost / n) * 1e6 } : null,
  }, null, 1));
  console.log(`\nWrote eval/score_${slug}.{xlsx,json}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
