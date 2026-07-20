/*
 * ai.ts — Tier 4–5, the AI layer (Option A: embedder shortlist + cross-encoder reranker).
 *
 * NO generative model. The embedder narrows ~1,400 anchors to a shortlist; the reranker
 * scores the charge against each candidate and the best one wins IF it clears the
 * confidence threshold — otherwise the charge goes to a human. Anchor embeddings are
 * precomputed offline (build-embeddings.ts); at runtime we embed only the query.
 *
 * Models load lazily (quantized) the first time the AI tier is actually used.
 */
import anchorsJson from './generated/anchors.json';
import type { AnchorSet } from './types.ts';

// Node lets us A/B models via env; the browser falls back to the defaults.
const ENV: Record<string, string | undefined> =
  (typeof process !== 'undefined' && (process as { env?: Record<string, string | undefined> }).env) || {};
// The embedder is taken from the anchor index itself (see loadAnchorEmbeddings) so the query
// model can never mismatch the model the anchors were embedded with.
let EMBED_MODEL = ENV.EMBED_MODEL ?? 'Xenova/bge-small-en-v1.5';
const RERANK_MODEL = ENV.RERANK_MODEL ?? 'Xenova/bge-reranker-base';
const EMBED_DTYPE = (ENV.EMBED_DTYPE ?? 'q8') as 'q8' | 'fp32' | 'fp16';
const RERANK_DTYPE = (ENV.RERANK_DTYPE ?? 'q8') as 'q8' | 'fp32' | 'fp16';
export const AI_THRESHOLD = 0.5; // reranker sigmoid score to auto-accept
// Second gate: if the embedder's best match is this weak, the whole shortlist is
// garbage and the reranker is only picking "least-bad" — so refuse regardless of its
// score. Catches non-charges ("Hello") that fool the reranker into a spurious high score.
export const COS_FLOOR = 0.62;

const anchors = (anchorsJson as AnchorSet).anchors;

function decodeVectors(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

// Precomputed anchor embeddings (2.9 MB) — loaded lazily so the deterministic app
// doesn't pay for them on first paint, and works even if they haven't been built.
let matrix: Float32Array | null = null;
let DIM = 0;
async function loadAnchorEmbeddings(): Promise<void> {
  if (matrix) return;
  const emb = (await import('./generated/anchor-embeddings.json')).default as { dim: number; vectors: string; model?: string };
  DIM = emb.dim;
  if (emb.model) EMBED_MODEL = emb.model; // always query with the model the anchors were built with
  matrix = decodeVectors(emb.vectors);
}

export interface Candidate {
  phrase: string;
  category: string;
  subcategory: string;
  cos: number; // embedder cosine similarity
  rerank: number; // reranker score (sigmoid), set after reranking
}

export type AIOutcome =
  | 'accept' // both gates passed: category + subcategory
  | 'category-only' // shortlist agrees on a category, but reranker can't pick the subcategory
  | 'reject'; // weak embedder, or no category consensus -> human

export interface Decision {
  outcome: AIOutcome;
  category: string | null;
  subcategory: string | null;
  score: number; // best reranker score
  maxCos: number; // embedder's best cosine (the agreement signal)
  consensusCategory: string; // most-voted category in the shortlist
  consensusVotes: number; // how many of the shortlist voted it
  consensusOf: number; // shortlist size
  reason: string;
}

export interface AIResult extends Decision {
  accepted: boolean; // outcome === 'accept'
  categoryConfident: boolean; // accept OR category-only
  threshold: number;
  cosFloor: number;
  shortlist: Candidate[];
  timings: { embedMs: number; rerankMs: number };
}

/**
 * Pure decision from a reranked shortlist — the two-gate rule PLUS category consensus.
 * If the reranker can't pick a subcategory but the shortlist overwhelmingly agrees on a
 * CATEGORY (and the embedder isn't weak), accept the category and route only the
 * subcategory to a human — rather than dumping the whole charge to review.
 */
export function decide(shortlist: Candidate[], threshold = AI_THRESHOLD, cosFloor = COS_FLOOR): Decision {
  const best = [...shortlist].sort((a, b) => b.rerank - a.rerank)[0];
  const maxCos = Math.max(...shortlist.map((c) => c.cos));
  const votes = new Map<string, number>();
  for (const c of shortlist) votes.set(c.category, (votes.get(c.category) ?? 0) + 1);
  const [consensusCategory, consensusVotes] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  const consensusOf = shortlist.length;
  const base = { score: best.rerank, maxCos, consensusCategory, consensusVotes, consensusOf };

  if (maxCos < cosFloor)
    return { ...base, outcome: 'reject', category: null, subcategory: null, reason: `no anchor is semantically close (best cosine ${maxCos.toFixed(2)} < floor ${cosFloor}) — likely not a recognizable charge` };
  if (best.rerank >= threshold)
    return { ...base, outcome: 'accept', category: best.category, subcategory: best.subcategory, reason: 'both gates passed' };
  if (consensusVotes >= Math.ceil(consensusOf * 0.75))
    return { ...base, outcome: 'category-only', category: consensusCategory, subcategory: null, reason: `category agreed by ${consensusVotes}/${consensusOf} candidates; subcategory unclear — a person picks it` };
  return { ...base, outcome: 'reject', category: null, subcategory: null, reason: `reranker score ${best.rerank.toFixed(2)} below threshold ${threshold} and no category consensus` };
}

export type ProgressFn = (stage: 'embedder' | 'reranker', pct: number) => void;

// lazy singletons
let embedder: any = null;
let rerankTok: any = null;
let rerankModel: any = null;

export function modelsReady(): boolean {
  return !!embedder && !!rerankModel;
}

async function loadEmbedder(onProgress?: ProgressFn): Promise<void> {
  if (embedder) return;
  const tf = await import('@huggingface/transformers');
  tf.env.allowLocalModels = false;
  embedder = await tf.pipeline('feature-extraction', EMBED_MODEL, {
    dtype: EMBED_DTYPE,
    progress_callback: (p: any) => p?.progress != null && onProgress?.('embedder', p.progress),
  });
}

async function loadReranker(onProgress?: ProgressFn): Promise<void> {
  if (rerankModel) return;
  const tf = await import('@huggingface/transformers');
  tf.env.allowLocalModels = false;
  rerankTok = await tf.AutoTokenizer.from_pretrained(RERANK_MODEL);
  rerankModel = await tf.AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, {
    dtype: RERANK_DTYPE,
    progress_callback: (p: any) => p?.progress != null && onProgress?.('reranker', p.progress),
  });
}

export async function loadModels(onProgress?: ProgressFn): Promise<void> {
  await loadEmbedder(onProgress);
  await loadReranker(onProgress);
}

/**
 * Pure retrieval: embed the query and return the top-K nearest anchors by cosine.
 * No reranker involved — this is the RAG "retrieve" step, and its recall is the hard
 * ceiling for any retrieve-then-decide design.
 */
export async function retrieve(query: string, topK = 8, onProgress?: ProgressFn): Promise<Candidate[]> {
  await loadAnchorEmbeddings();
  await loadEmbedder(onProgress);
  const mat = matrix!;
  const q = (await embedder(query, { pooling: 'mean', normalize: true })).data as Float32Array;
  const scored: Candidate[] = anchors.map((a, i) => {
    let dot = 0;
    const off = i * DIM;
    for (let d = 0; d < DIM; d++) dot += q[d] * mat[off + d];
    return { phrase: a.phrase, category: a.category, subcategory: a.subcategory, cos: dot, rerank: 0 };
  });
  scored.sort((x, y) => y.cos - x.cos);
  return scored.slice(0, topK);
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Embed the query, shortlist top-K anchors by cosine, rerank, and gate on the threshold. */
export async function classifyWithAI(
  query: string,
  opts: { topK?: number; threshold?: number; onProgress?: ProgressFn } = {},
): Promise<AIResult> {
  const topK = opts.topK ?? 8;
  const threshold = opts.threshold ?? AI_THRESHOLD;

  // 1) + 2) retrieve: embed the query and take the top-K nearest anchors
  let t = performance.now();
  const shortlist = await retrieve(query, topK, opts.onProgress);
  const embedMs = performance.now() - t;

  // 3) rerank the shortlist (cross-encoder scores the charge against each candidate)
  await loadReranker(opts.onProgress);
  t = performance.now();
  const inputs = rerankTok(Array(shortlist.length).fill(query), {
    text_pair: shortlist.map((c) => c.phrase),
    padding: true,
    truncation: true,
  });
  const { logits } = await rerankModel(inputs);
  const data = logits.data as Float32Array;
  shortlist.forEach((c, i) => (c.rerank = sigmoid(data[i])));
  shortlist.sort((a, b) => b.rerank - a.rerank);
  const rerankMs = performance.now() - t;

  // decision: two-gate + category consensus
  const d = decide(shortlist, threshold, COS_FLOOR);
  return {
    ...d,
    accepted: d.outcome === 'accept',
    categoryConfident: d.outcome === 'accept' || d.outcome === 'category-only',
    threshold,
    cosFloor: COS_FLOOR,
    shortlist,
    timings: { embedMs, rerankMs },
  };
}
