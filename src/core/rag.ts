/*
 * rag.ts — the RAG classification tier (SERVER-SIDE ONLY).
 *
 * Retrieve the top-K candidate classifications from the knowledge base, then let an LLM pick
 * ONE of them by number. The model can only return an index into the retrieved list, so it
 * cannot invent a category, and every answer traces back to a real KB entry.
 *
 * Server-side only: it holds AWS credentials and loads the full embedding index.
 */
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { retrieve, type Candidate } from './ai.ts';
import { mapCharge, type MapResult } from './mapping.ts';

export const RAG_SYSTEM =
  'You classify criminal charges. You will be given a charge and a numbered list of candidate ' +
  'classifications retrieved from a legal knowledge base. Choose the ONE candidate that best matches ' +
  'the charge. You may only choose from the numbered list.\n' +
  'Rule: if the charge is a conspiracy, attempt, solicitation, or aiding and abetting of an underlying ' +
  'offense, classify it by that UNDERLYING offense — e.g. "conspiracy to distribute cocaine" is a drug ' +
  'offense, not a conspiracy/obstruction category.\n' +
  'Respond with ONLY JSON: {"choice": <number>}. If none of the candidates fit the charge at all, ' +
  'respond {"choice": 0}.';

const MODEL = process.env.BEDROCK_MODEL_ID ?? 'openai.gpt-oss-120b-1:0';
const REGION = process.env.AWS_REGION ?? 'us-east-2';
const TOPK = Number(process.env.RAG_TOPK ?? '10');
let client: BedrockRuntimeClient | null = null;
const getClient = () => (client ??= new BedrockRuntimeClient({ region: REGION }));

/** Collapse retrieved anchors to distinct (category, subcategory) options. */
export function distinctOptions(cands: Candidate[]): Candidate[] {
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

export function buildUserPrompt(charge: string, options: Candidate[]): string {
  const list = options
    .map((c, i) => `${i + 1}. ${c.category} / ${c.subcategory}  — e.g. "${c.phrase.slice(0, 110)}"`)
    .join('\n');
  return `Charge: "${charge}"\n\nCandidates:\n${list}\n\nReturn only {"choice": <number>}. /no_think`;
}

export interface RagResult {
  charge: string;
  det: MapResult; // the deterministic cascade result (may already have resolved it)
  usedRag: boolean;
  options: Candidate[]; // what was retrieved (the audit trail)
  choice: number; // 1-based index the model picked; 0 = none fit
  category: string | null;
  subcategory: string | null;
  abstained: boolean;
  model: string;
  inTok: number;
  outTok: number;
  ms: number;
}

/** Full tier flow: deterministic first; only if it defers do we retrieve + ask the model. */
export async function ragClassify(charge: string, state?: string, topK = TOPK): Promise<RagResult> {
  const det = mapCharge({ description: charge, state });
  const base = { charge, det, model: MODEL, inTok: 0, outTok: 0, ms: 0 };

  if (det.category) {
    return { ...base, usedRag: false, options: [], choice: -1, category: det.category, subcategory: det.subcategory, abstained: false };
  }

  const options = distinctOptions(await retrieve(charge, topK));
  const cmd = new ConverseCommand({
    modelId: MODEL,
    system: [{ text: RAG_SYSTEM }],
    messages: [{ role: 'user', content: [{ text: buildUserPrompt(charge, options) }] }],
    inferenceConfig: { maxTokens: 1200, temperature: 0 },
  });

  const t0 = Date.now();
  const res = await getClient().send(cmd);
  const ms = Date.now() - t0;
  const text = (res.output?.message?.content ?? []).map((c) => c.text ?? '').join('');
  const objs = text.replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[^{}]*\}/g) ?? [];
  const js = [...objs].reverse().find((o) => /choice/i.test(o));
  let choice = -1;
  if (js) { try { choice = Number(JSON.parse(js).choice); } catch { /* unparseable */ } }

  const picked = choice >= 1 && choice <= options.length ? options[choice - 1] : null;
  return {
    ...base,
    usedRag: true,
    options,
    choice,
    category: picked?.category ?? null,
    subcategory: picked?.subcategory ?? null,
    abstained: !picked,
    inTok: res.usage?.inputTokens ?? 0,
    outTok: res.usage?.outputTokens ?? 0,
    ms,
  };
}
