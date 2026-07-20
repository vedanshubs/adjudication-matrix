// View 1 — single-charge resolution cascade. Type a charge, watch it fall the ladder;
// if the deterministic tiers can't place it, run the real AI tier (embedder + reranker).
import { mapCharge, type MapResult, type TraceStep } from '../../core/mapping.ts';
import { categoryByName } from '../../core/data.ts';
import { esc, renderLadder } from '../ui.ts';

/** Shape returned by POST /api/classify (the server-side RAG tier). */
interface RagResponse {
  category: string | null;
  subcategory: string | null;
  abstained: boolean;
  choice: number;
  options: { phrase: string; category: string; subcategory: string; cos: number }[];
  model: string;
  tokens: { input: number; output: number };
  ms: number;
}

const EXAMPLES = [
  'Simple Assault',
  'Aggravated Assault',
  'POSSESSION OF COCAINE',
  'FEL PROB VIOL OUT OF COUNTY',
  'DUI DRUGS OR METABOLITE',
  'Reckless Driving',
];

function resolvedBanner(r: MapResult): string {
  const code = categoryByName.get(r.category!)?.code ?? '—';
  const tierName = { Tier1_Statute: 'Tier 1 · statute', Tier2_Exact: 'Tier 2 · exact', Tier3_Keyword: 'Tier 3 · keyword' }[r.resolvedBy!];
  return `<div class="result" style="background:var(--clearbg)">
    <span class="pill Clear">RESOLVED</span>
    <div>
      <div class="big"><span class="code">${code}</span> ${esc(r.category)} <span class="muted">/ ${esc(r.subcategory)}</span></div>
      <div class="muted">via ${tierName} · matched "${esc(r.matchedTerm)}" <span class="conf ${r.confidence}">${r.confidence} confidence</span></div>
    </div>
  </div>`;
}

function aiCard(): string {
  return `<div class="card" id="t-ai" style="background:var(--reviewbg);border-color:#7a5f16">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <span class="pill deferred">→ AI TIER</span>
      <div><div class="big">Deterministic tiers couldn't place this</div>
      <div class="muted">No literal code, exact match, or keyword — so it goes to the AI layer. This build runs it for real, in your browser.</div></div>
    </div>
    <div class="aiflow">
      <div class="aistep"><b>1 · Retrieve</b><span>embedder pulls the top-10 nearest KB entries</span></div>
      <div class="aiarrow">→</div>
      <div class="aistep"><b>2 · LLM picks</b><span>chooses ONE candidate by number — cannot invent one</span></div>
      <div class="aiarrow">→</div>
      <div class="aistep"><b>3 · Or abstains</b><span>"none fit" → routed to a human</span></div>
    </div>
    <div id="t-ai-run" style="margin-top:12px"><button class="chip" id="t-ai-btn" style="padding:8px 16px">Run RAG classification</button>
      <span class="muted" style="font-size:11.5px;margin-left:8px">runs server-side (needs <code>npm run api</code>)</span></div>
    <div id="t-ai-out"></div>
  </div>`;
}

function aiResultHtml(ai: RagResponse): string {
  const code = (name: string) => categoryByName.get(name)?.code ?? '—';
  const verdict = ai.abstained
    ? `<span class="pill Flagged">→ HUMAN</span> the model judged that none of the retrieved candidates fit`
    : `<span class="pill Clear">PICKED #${ai.choice}</span> <b>${code(ai.category!)} ${esc(ai.category)}</b> <span class="muted">/ ${esc(ai.subcategory)}</span>`;
  return `
    <div style="margin-top:14px">
      <div style="margin-bottom:10px">${verdict}</div>
      <div class="muted" style="font-size:11px;margin:6px 0 12px">
        ${esc(ai.model)} · ${ai.tokens.input} in + ${ai.tokens.output} out tokens · ${ai.ms} ms ·
        the model returns an <b>index</b> into this list, so it cannot invent a category
      </div>
      <table>
        <thead><tr><th>#</th><th>Retrieved KB entry</th><th>Category</th><th>Subcategory</th><th>cos</th></tr></thead>
        <tbody>${ai.options
          .map(
            (c, i) => `<tr${i + 1 === ai.choice ? ' class="breach"' : ''}>
            <td><b>${i + 1}</b>${i + 1 === ai.choice ? ' ◄' : ''}</td>
            <td>${esc(c.phrase.slice(0, 110))}${c.phrase.length > 110 ? '…' : ''}</td>
            <td><span class="code">${code(c.category)}</span> ${esc(c.category)}</td>
            <td class="muted">${esc(c.subcategory)}</td>
            <td class="muted">${c.cos.toFixed(2)}</td>
          </tr>`,
          )
          .join('')}</tbody>
      </table>
    </div>`;
}

/** Reflect the RAG outcome back onto the cascade ladder so Tier 4–5 / 6 update. */
function augmentTrace(trace: TraceStep[], ai: RagResponse): TraceStep[] {
  return trace.map((s) => {
    if (s.tier === 'Tier 4–5') {
      return ai.abstained
        ? { ...s, outcome: 'miss', detail: 'retrieved 10 candidates; the model judged none of them fit' }
        : { ...s, outcome: 'hit', detail: `retrieved ${ai.options.length}, model picked #${ai.choice} → ${ai.category} / ${ai.subcategory}` };
    }
    if (s.tier === 'Tier 6') {
      return ai.abstained ? { ...s, outcome: 'deferred', detail: 'awaiting human — no candidate fit' } : s;
    }
    return s;
  });
}

export function renderTraceView(root: HTMLElement): void {
  root.innerHTML = `
    <div class="card">
      <h2>Charge input</h2>
      <label>Offense description</label>
      <textarea id="t-desc" placeholder="e.g. Simple Assault">Simple Assault</textarea>
      <div class="row c2" style="margin-top:8px">
        <div><label>State (optional — enables statute tier)</label><input id="t-state" placeholder="e.g. TN" /></div>
        <div><label>Statute code (optional)</label><input id="t-code" placeholder="e.g. 39-13-101" /></div>
      </div>
      <div class="examples">${EXAMPLES.map((e) => `<span class="chip" data-ex="${esc(e)}">${esc(e)}</span>`).join('')}</div>
    </div>
    <div id="t-result"></div>
    <div class="card">
      <h2>Resolution cascade</h2>
      <div class="ladder" id="t-ladder"></div>
    </div>`;

  const desc = root.querySelector<HTMLTextAreaElement>('#t-desc')!;
  const state = root.querySelector<HTMLInputElement>('#t-state')!;
  const code = root.querySelector<HTMLInputElement>('#t-code')!;
  const resultEl = root.querySelector<HTMLDivElement>('#t-result')!;
  const ladderEl = root.querySelector<HTMLDivElement>('#t-ladder')!;

  let current: MapResult;

  const run = () => {
    current = mapCharge({ description: desc.value, state: state.value || undefined, statuteCode: code.value || undefined });
    ladderEl.innerHTML = renderLadder(current.trace);
    if (current.category) {
      resultEl.innerHTML = resolvedBanner(current);
    } else {
      resultEl.innerHTML = aiCard();
      wireAI();
    }
  };

  const wireAI = () => {
    const btn = root.querySelector<HTMLButtonElement>('#t-ai-btn')!;
    const out = root.querySelector<HTMLDivElement>('#t-ai-out')!;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Retrieving + asking the model…';
      const q = desc.value;
      try {
        const resp = await fetch('/api/classify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: q, state: state.value || undefined }),
        });
        if (!resp.ok) throw new Error(`API ${resp.status}: ${(await resp.json().catch(() => ({}))).error ?? resp.statusText}`);
        const ai = (await resp.json()) as RagResponse;
        if (desc.value !== q) return; // input changed while in flight
        btn.textContent = 'Re-run RAG classification';
        btn.disabled = false;
        out.innerHTML = aiResultHtml(ai);
        ladderEl.innerHTML = renderLadder(augmentTrace(current.trace, ai));
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Run RAG classification';
        out.innerHTML = `<div class="muted" style="margin-top:10px;color:var(--low)">RAG tier unavailable: ${esc((e as Error).message)}<br/>Is the API running? <code>npm run api</code></div>`;
      }
    });
  };

  desc.addEventListener('input', run);
  state.addEventListener('input', run);
  code.addEventListener('input', run);
  root.querySelectorAll<HTMLElement>('.chip').forEach((chip) =>
    chip.addEventListener('click', () => { desc.value = chip.dataset.ex!; run(); }),
  );
  run();
}
