// Shared UI helpers used by both views.
import type { TraceStep } from '../core/mapping.ts';

export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]!);

// Canonical ladder so every trace renders the FULL cascade — the rungs a charge
// never reached are shown dimmed, which is what makes "falls only as far as it must" visible.
const TIERS: { tier: string; label: string; cost: string }[] = [
  { tier: 'Layer 0', label: 'Normalize', cost: 'free · instant' },
  { tier: 'Tier 1', label: 'Statute lookup (state, code)', cost: 'free · instant' },
  { tier: 'Tier 2', label: 'Exact description', cost: 'free · instant' },
  { tier: 'Tier 3', label: 'Keyword + stemming', cost: 'free · instant' },
  { tier: 'Tier 4–5', label: 'AI tier (embedder + reranker)', cost: 'self-hosted AI' },
  { tier: 'Tier 6', label: 'Human review', cost: 'human' },
];

/** Returns the rung markup (no wrapper); inject into an element with class "ladder". */
export function renderLadder(trace: TraceStep[]): string {
  const byTier = new Map(trace.map((s) => [s.tier, s]));
  // The resolving rung is the Tier (not Layer 0) that hit.
  const resolvedIdx = TIERS.findIndex((t) => t.tier !== 'Layer 0' && byTier.get(t.tier)?.outcome === 'hit');

  return TIERS.map((def, i) => {
    const step = byTier.get(def.tier);
    const reached = !!step;
    const outcome = step?.outcome ?? 'skipped';
    const past = resolvedIdx >= 0 && i > resolvedIdx;
    const isResolved = i === resolvedIdx;
    const detail = reached ? step!.detail : past ? 'not reached — resolved earlier' : 'not reached';
    const cls = [past || !reached ? 'notreached' : outcome, isResolved ? 'resolved' : ''].join(' ');
    const outcomeTag = past || !reached ? 'not reached' : outcome;
    return `
      <div class="rung ${cls}">
        <div><div class="tier">${esc(def.tier)}</div><div class="cost">${esc(def.cost)}</div></div>
        <div>
          <div class="name">${esc(def.label)}${isResolved ? ' <span class="resolved-badge">◄ resolved here</span>' : ''}</div>
          <div class="detail">${esc(detail)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="outcome ${past || !reached ? 'skipped' : outcome}">${esc(outcomeTag)}</span><span class="dot"></span>
        </div>
      </div>`;
  }).join('');
}
