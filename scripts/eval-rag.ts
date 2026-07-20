/*
 * eval-rag.ts — RAG classifier: retrieve top-K anchors, then an LLM picks from ONLY those.
 *
 * Why this shape:
 *  - the embedder has good recall (right category is in the top-10 ~92% of the time)
 *  - the cross-encoder reranker is the weak link at converting that into a pick (78%)
 *  - an LLM given 10 grounded candidates should close most of that gap, while sending
 *    ~10x fewer input tokens than shipping the whole taxonomy every call
 *
 * The model may ONLY choose from the retrieved candidates (by number), so it structurally
 * cannot invent a category, and every decision is traceable to a real KB entry.
 *
 * Requires AWS creds in .env. Run: BEDROCK_MODEL_ID=<id> npm run eval:rag
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { mapCharge } from '../src/core/mapping.ts';
import { retrieve, type Candidate } from '../src/core/ai.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'eval');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* rely on real env */ }

const MODEL = process.env.BEDROCK_MODEL_ID ?? 'openai.gpt-oss-120b-1:0';
const REGION = process.env.AWS_REGION ?? 'us-east-2';
const TOPK = Number(process.env.RAG_TOPK ?? '10');
const CONCURRENCY = Number(process.env.LLM_CONCURRENCY ?? '3');
const client = new BedrockRuntimeClient({ region: REGION });

const SYSTEM =
  'You classify criminal charges. You will be given a charge and a numbered list of candidate ' +
  'classifications retrieved from a legal knowledge base. Choose the ONE candidate that best matches ' +
  'the charge. You may only choose from the numbered list.\n' +
  'Rule: if the charge is a conspiracy, attempt, solicitation, or aiding and abetting of an underlying ' +
  'offense, classify it by that UNDERLYING offense — e.g. "conspiracy to distribute cocaine" is a drug ' +
  'offense, not a conspiracy/obstruction category.\n' +
  'Respond with ONLY JSON: {"choice": <number>}. If none of the candidates fit the charge at all, ' +
  'respond {"choice": 0}.';

// dedupe candidates down to distinct (category, subcategory) pairs so the model sees real options
function distinctOptions(cands: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of cands) {
    const k = `${c.category}||${c.subcategory}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

interface Pick { choice: number; inTok: number; outTok: number; ms: number; }
async function askLLM(charge: string, options: Candidate[]): Promise<Pick> {
  const list = options.map((c, i) => `${i + 1}. ${c.category} / ${c.subcategory}  — e.g. "${c.phrase.slice(0, 110)}"`).join('\n');
  const cmd = new ConverseCommand({
    modelId: MODEL,
    system: [{ text: SYSTEM }],
    messages: [{ role: 'user', content: [{ text: `Charge: "${charge}"\n\nCandidates:\n${list}\n\nReturn only {"choice": <number>}. /no_think` }] }],
    inferenceConfig: { maxTokens: 1200, temperature: 0 },
  });
  const t0 = Date.now();
  const res = await client.send(cmd);
  const ms = Date.now() - t0;
  const text = (res.output?.message?.content ?? []).map((c) => c.text ?? '').join('');
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const objs = cleaned.match(/\{[^{}]*\}/g) ?? [];
  const js = [...objs].reverse().find((o) => /choice/i.test(o));
  let choice = -1;
  if (js) { try { choice = Number(JSON.parse(js).choice); } catch { /* unparseable */ } }
  return { choice, inTok: res.usage?.inputTokens ?? 0, outTok: res.usage?.outputTokens ?? 0, ms };
}

async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (i >= tries) throw e; await new Promise((r) => setTimeout(r, 600 * 2 ** i)); }
  }
}

async function main() {
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(XLSX.readFile(path.join(DIR, 'goldset_v1_judged.xlsx')).Sheets['GoldSet']);
  const gold = rows.filter((r) => String(r.HUMAN_category).trim());
  console.log(`RAG: retrieve top-${TOPK} → ${MODEL} picks. ${gold.length} charges, region ${REGION}\n`);

  // pre-retrieve for every charge (local, no API cost)
  const prepared = [] as { r: Record<string, string>; det: ReturnType<typeof mapCharge>; options: Candidate[] }[];
  for (const r of gold) {
    const det = mapCharge({ description: String(r.charge_text), state: String(r.state) || undefined });
    const options = distinctOptions(await retrieve(String(r.charge_text), TOPK));
    prepared.push({ r, det, options });
  }
  console.log('retrieval done; querying the model...');

  const out: any[] = new Array(prepared.length);
  let done = 0;
  async function worker(start: number) {
    for (let i = start; i < prepared.length; i += CONCURRENCY) {
      const { r, det, options } = prepared[i];
      const charge = String(r.charge_text);
      const goldCat = String(r.HUMAN_category), goldSub = String(r.HUMAN_subcategory).trim();
      let predCat = '', predSub = '', tier = '', inTok = 0, outTok = 0, ms = 0, abstained = false;

      if (det.category) {
        // deterministic tiers still win first — RAG only handles what they defer
        predCat = det.category; predSub = det.subcategory ?? ''; tier = det.resolvedBy ?? 'deterministic';
      } else {
        const p = await withRetry(() => askLLM(charge, options));
        inTok = p.inTok; outTok = p.outTok; ms = p.ms; tier = 'RAG';
        if (p.choice >= 1 && p.choice <= options.length) {
          predCat = options[p.choice - 1].category;
          predSub = options[p.choice - 1].subcategory;
        } else { abstained = true; } // choice 0 = "none fit" → human
      }
      out[i] = {
        id: Number(r.id), charge, tier, abstained,
        gold_cat: goldCat, pred_cat: predCat, cat_ok: predCat === goldCat,
        gold_sub: goldSub, pred_sub: predSub, sub_ok: !!goldSub && predCat === goldCat && predSub === goldSub,
        in_tok: inTok, out_tok: outTok, ms,
      };
      if (++done % 15 === 0) process.stderr.write(`  ${done}/${prepared.length}\r`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, k) => worker(k)));

  // ---- report ----
  const n = out.length;
  const decided = out.filter((r) => !r.abstained);
  const ragRows = out.filter((r) => r.tier === 'RAG');
  const ragDecided = ragRows.filter((r) => !r.abstained);
  const subScorable = decided.filter((r) => r.gold_sub);
  const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) + '%' : '—');
  const sum = (f: (r: any) => number, rs = ragRows) => rs.reduce((s, r) => s + f(r), 0);

  console.log(`\n=== RAG (top-${TOPK} → ${MODEL}) vs human gold (${n} charges) ===\n`);
  console.log(`Coverage (auto-decided):     ${decided.length}/${n} = ${pct(decided.length, n)}`);
  console.log(`Category accuracy (decided): ${pct(decided.filter((r) => r.cat_ok).length, decided.length)}`);
  console.log(`Subcategory accuracy:        ${pct(subScorable.filter((r) => r.sub_ok).length, subScorable.length)}`);
  console.log(`\nSplit by tier:`);
  console.log(`  deterministic  ${String(out.length - ragRows.length).padStart(3)}   cat ${pct(out.filter((r) => r.tier !== 'RAG' && r.cat_ok).length, out.length - ragRows.length)}`);
  console.log(`  RAG            ${String(ragRows.length).padStart(3)}   cat ${pct(ragDecided.filter((r) => r.cat_ok).length, ragDecided.length)} · sub ${pct(ragDecided.filter((r) => r.sub_ok).length, ragDecided.filter((r) => r.gold_sub).length)} · abstained ${ragRows.length - ragDecided.length}`);

  const totIn = sum((r) => r.in_tok), totOut = sum((r) => r.out_tok);
  const PIN = Number(process.env.BEDROCK_PRICE_IN_PER_1M ?? '0.15');
  const POUT = Number(process.env.BEDROCK_PRICE_OUT_PER_1M ?? '0.60');
  const cost = (totIn / 1e6) * PIN + (totOut / 1e6) * POUT;
  console.log(`\nTOKENS (LLM calls only: ${ragRows.length})`);
  console.log(`  input ${totIn.toLocaleString()} (avg ${Math.round(totIn / Math.max(1, ragRows.length))}/call) · output ${totOut.toLocaleString()} (avg ${Math.round(totOut / Math.max(1, ragRows.length))}/call)`);
  console.log(`LATENCY  avg ${Math.round(sum((r) => r.ms) / Math.max(1, ragRows.length))}ms/call`);
  console.log(`COST @ $${PIN}/1M in, $${POUT}/1M out: this run $${cost.toFixed(4)}`);
  console.log(`  per charge (all ${n}) $${(cost / n).toFixed(6)}  ·  per 1M charges ~$${((cost / n) * 1e6).toFixed(0)}`);

  console.log('\nWrong category (first 12):');
  decided.filter((r) => !r.cat_ok).slice(0, 12).forEach((r) => console.log(`  [${r.tier}] "${r.charge.slice(0, 42)}"  pred ${r.pred_cat} · gold ${r.gold_cat}`));

  const slug = `rag_${MODEL.replace(/[^a-z0-9]+/gi, '_')}_k${TOPK}`;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out), 'RAG');
  XLSX.writeFile(wb, path.join(DIR, `score_${slug}.xlsx`));
  fs.writeFileSync(path.join(DIR, `score_${slug}.json`), JSON.stringify({
    model: MODEL, topK: TOPK, n, coverage: decided.length / n,
    catAcc: decided.filter((r) => r.cat_ok).length / decided.length,
    subAcc: subScorable.filter((r) => r.sub_ok).length / subScorable.length,
    llmCalls: ragRows.length, tokens: { input: totIn, output: totOut },
    costPerMillionCharges: (cost / n) * 1e6,
  }, null, 1));
  console.log(`\nWrote eval/score_${slug}.{xlsx,json}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
