/*
 * mapping.ts — the deterministic resolution cascade (Layer 0 -> Tiers 1-3).
 *
 * mapCharge() runs a charge down the ladder and returns the answer PLUS a full
 * `trace` of every rung it tried and where it stopped. The trace is what the
 * walkthrough UI renders. Tiers beyond 3 (the AI layer) are represented as a
 * deferred step — designed, not yet wired.
 */
import { knowledgeBase } from './data.ts';
import anchorsJson from './generated/anchors.json';
import type { AnchorSet, Severity } from './types.ts';

const anchorSet = anchorsJson as AnchorSet;

export type ResolvedTier = 'Tier1_Statute' | 'Tier2_Exact' | 'Tier3_Keyword';
export type Confidence = 'High' | 'Medium' | 'Low' | 'None';
export type StepOutcome = 'hit' | 'miss' | 'skipped' | 'deferred';

export interface TraceStep {
  tier: string; // "Layer 0", "Tier 1", ...
  label: string; // human-readable name of the rung
  outcome: StepOutcome;
  detail: string;
}

export interface MapInput {
  description: string;
  state?: string; // e.g. "TN" — required for the statute tier
  statuteCode?: string; // optional; also auto-extracted from the description
}

export interface MapResult {
  input: MapInput;
  normalized: string;
  canonicalCode: string | null;
  category: string | null;
  subcategory: string | null;
  severityHint: Severity | null;
  resolvedBy: ResolvedTier | null;
  confidence: Confidence;
  matchedTerm: string | null;
  trace: TraceStep[];
}

// ---------- Layer 0: text + code normalization ----------
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'or', 'and', 'with', 'for', 'w', 'wo']);

/** Strip vendor count prefixes then lowercase / de-punctuate. */
export function normalize(s: string): string {
  return String(s ?? '')
    .replace(/^\s*\(?\d+[a-z]?\)?\s*/i, ' ') // "(1) ", "(1s) ", "2 "
    .replace(/\bcounts?\b\s*\(s\)?\s*of:?/gi, ' ') // "COUNT(S) OF:"
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  return w;
}

function tokens(s: string): string[] {
  return normalize(s).split(' ').filter((t) => t && !STOP.has(t)).map(stem);
}

/**
 * "90-95(A)(1)" -> "9095A1": drop ALL separators (dots, hyphens, spaces, §, parens) so
 * every formatting style of the same code collapses to one key. Keeping hyphens (an earlier
 * version) meant "302.113" and "302-113" produced different keys and failed to match.
 */
export function canonicalizeCode(code: string): string {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Best-effort code extraction from a compound free-text field. */
function extractCode(desc: string): string | null {
  const m = desc.match(/statute:?\s*([0-9][\w.\-()]*)/i) ?? desc.match(/\b(\d{1,3}-\d{1,3}[a-z0-9().-]*)\b/i);
  return m ? m[1] : null;
}

// ---------- indexes (built once from the compiled data) ----------
interface Hit { category: string; subcategory: string; severity: Severity | null; matched: string; }

const tier1 = new Map<string, Hit>(); // `${STATE}|${CANON}` -> hit
const tier2 = new Map<string, Hit>(); // normalized description -> hit
for (const e of knowledgeBase.entries) {
  const codes = [e.statuteNumber, ...e.altCitations].map(canonicalizeCode).filter((c) => c.length > 2);
  for (const c of codes) {
    const key = `${e.state.toUpperCase()}|${c}`;
    if (!tier1.has(key)) tier1.set(key, { category: e.category, subcategory: e.subcategory, severity: e.severity, matched: `${e.state} ${c}` });
  }
  const nk = normalize(e.description);
  if (nk && !tier2.has(nk)) tier2.set(nk, { category: e.category, subcategory: e.subcategory, severity: e.severity, matched: e.description });
}

// Inchoate subcategories are MODIFIERS ("conspiracy to distribute" is a drug crime; "harboring
// aliens" is immigration). As bare keywords they signal almost nothing about the real category,
// so they are EXCLUDED from Tier 3 entirely — such charges defer to the AI tier, which can place
// them semantically. (A truly bare "Conspiracy" still resolves there via the embedder.)
const INCHOATE_SUBS = new Set(['Conspiracy', 'Criminal Attempt', 'Accessory After the Fact', 'Accessory / Aiding & Abetting']);

// Tier 3 anchors: precomputed tokens, longest phrase first (specific beats generic).
const tier3 = anchorSet.anchors
  .map((a) => ({ toks: tokens(a.phrase), phrase: a.phrase, category: a.category, subcategory: a.subcategory }))
  .filter((a) => a.toks.length > 0 && !INCHOATE_SUBS.has(a.subcategory))
  .sort((a, b) => b.toks.length - a.toks.length);

function containsPhrase(hay: string[], needle: string[]): boolean {
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

// ---------- the cascade ----------
export function mapCharge(input: MapInput): MapResult {
  const trace: TraceStep[] = [];
  const desc = String(input.description ?? '').trim();
  const state = input.state?.trim().toUpperCase() || '';
  const normalized = normalize(desc);
  const rawCode = input.statuteCode?.trim() || extractCode(desc) || '';
  const canonicalCode = rawCode ? canonicalizeCode(rawCode) : null;

  trace.push({
    tier: 'Layer 0', label: 'Normalize', outcome: 'hit',
    detail: canonicalCode ? `"${normalized}" · code ${canonicalCode}${state ? ` · state ${state}` : ''}` : `"${normalized}"${state ? ` · state ${state}` : ''}`,
  });

  const done = (tier: ResolvedTier, hit: Hit, confidence: Confidence): MapResult => ({
    input, normalized, canonicalCode,
    category: hit.category, subcategory: hit.subcategory, severityHint: hit.severity,
    resolvedBy: tier, confidence, matchedTerm: hit.matched, trace,
  });

  // Tier 1 — statute lookup
  if (state && canonicalCode) {
    const hit = tier1.get(`${state}|${canonicalCode}`);
    if (hit) {
      trace.push({ tier: 'Tier 1', label: 'Statute lookup (state, code)', outcome: 'hit', detail: `${hit.matched} → ${hit.category} / ${hit.subcategory}` });
      return done('Tier1_Statute', hit, 'High');
    }
    trace.push({ tier: 'Tier 1', label: 'Statute lookup (state, code)', outcome: 'miss', detail: `no KB entry for (${state}, ${canonicalCode})` });
  } else {
    trace.push({ tier: 'Tier 1', label: 'Statute lookup (state, code)', outcome: 'skipped', detail: !canonicalCode ? 'no statute code' : 'no state resolved' });
  }

  // Tier 2 — exact description
  const t2 = tier2.get(normalized);
  if (t2) {
    trace.push({ tier: 'Tier 2', label: 'Exact description', outcome: 'hit', detail: `→ ${t2.category} / ${t2.subcategory}` });
    return done('Tier2_Exact', t2, 'High');
  }
  trace.push({ tier: 'Tier 2', label: 'Exact description', outcome: 'miss', detail: 'no verbatim KB match' });

  // Tier 3 — keyword + stemming (inchoate anchors excluded; they defer to AI)
  const hay = tokens(desc);
  for (const a of tier3) {
    if (containsPhrase(hay, a.toks)) {
      const confidence: Confidence = a.toks.length >= 2 ? 'Medium' : 'Low';
      trace.push({ tier: 'Tier 3', label: 'Keyword + stemming', outcome: 'hit', detail: `"${a.phrase}" → ${a.category} / ${a.subcategory}` });
      return done('Tier3_Keyword', { category: a.category, subcategory: a.subcategory, severity: null, matched: a.phrase }, confidence);
    }
  }
  trace.push({ tier: 'Tier 3', label: 'Keyword + stemming', outcome: 'miss', detail: 'no glossary phrase matched' });

  // Beyond deterministic — the AI layer (designed, not wired)
  trace.push({ tier: 'Tier 4–5', label: 'AI tier (embedder + reranker)', outcome: 'deferred', detail: 'would shortlist + rerank against anchors — not wired in this build' });
  trace.push({ tier: 'Tier 6', label: 'Human review', outcome: 'deferred', detail: 'routed to a person if the AI score is below threshold' });

  return {
    input, normalized, canonicalCode,
    category: null, subcategory: null, severityHint: null,
    resolvedBy: null, confidence: 'None', matchedTerm: null, trace,
  };
}
