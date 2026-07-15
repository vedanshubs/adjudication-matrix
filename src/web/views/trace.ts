// View 1 — single-charge resolution cascade. Type a charge, watch it fall the ladder;
// if the deterministic tiers can't place it, run the real AI tier (embedder + reranker).
import { mapCharge, type MapResult, type TraceStep } from '../../core/mapping.ts';
import { categoryByName } from '../../core/data.ts';
import { classifyWithAI, type AIResult } from '../../core/ai.ts';
import { esc, renderLadder } from '../ui.ts';

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
      <div class="aistep"><b>1 · Embedder</b><span>shortlist top-8 nearest anchors by meaning</span></div>
      <div class="aiarrow">→</div>
      <div class="aistep"><b>2 · Reranker</b><span>cross-encoder scores the charge vs each</span></div>
      <div class="aiarrow">→</div>
      <div class="aistep"><b>3 · Threshold</b><span>score ≥ dial → accept · else → human</span></div>
    </div>
    <div id="t-ai-run" style="margin-top:12px"><button class="chip" id="t-ai-btn" style="padding:8px 16px">Run AI classification</button>
      <span class="muted" style="font-size:11.5px;margin-left:8px">first run downloads the small models (~60 MB, cached after)</span></div>
    <div id="t-ai-out"></div>
  </div>`;
}

function aiResultHtml(ai: AIResult): string {
  const code = (name: string) => categoryByName.get(name)?.code ?? '—';
  const pct = Math.round(ai.score * 100);
  const thrPct = Math.round(ai.threshold * 100);
  const weakEmbed = ai.maxCos < ai.cosFloor;
  const verdict =
    ai.outcome === 'accept'
      ? `<span class="pill Clear">ACCEPT</span> <b>${code(ai.category!)} ${esc(ai.category)}</b> <span class="muted">/ ${esc(ai.subcategory)}</span>`
      : ai.outcome === 'category-only'
        ? `<span class="pill Review">CATEGORY ✓ · SUBCATEGORY → HUMAN</span> <b>${code(ai.category!)} ${esc(ai.category)}</b> <span class="muted">— agreed by ${ai.consensusVotes}/${ai.consensusOf} candidates; a person picks the subcategory</span>`
        : weakEmbed
          ? `<span class="pill Flagged">→ NOT A CHARGE?</span> ${esc(ai.reason)}`
          : `<span class="pill Flagged">→ HUMAN</span> ${esc(ai.reason)}`;
  // embedder-agreement bar (the guardrail signal)
  const cosPct = Math.round(ai.maxCos * 100);
  const floorPct = Math.round(ai.cosFloor * 100);
  return `
    <div style="margin-top:14px">
      <div style="margin-bottom:10px">${verdict}</div>
      <div class="gate">
        <div class="gate-row"><span class="gate-lbl">Embedder agreement</span>
          <div class="dial"><div class="dial-fill ${weakEmbed ? 'bad' : 'ok'}" style="width:${cosPct}%"></div><div class="dial-thr" style="left:${floorPct}%" title="floor ${ai.cosFloor}"></div></div>
          <span class="gate-val ${weakEmbed ? 'no' : 'yes'}">${ai.maxCos.toFixed(2)} ${weakEmbed ? '✗' : '✓'} <span class="muted">floor ${ai.cosFloor}</span></span></div>
        <div class="gate-row"><span class="gate-lbl">Reranker confidence</span>
          <div class="dial"><div class="dial-fill ${ai.score >= ai.threshold ? 'ok' : 'bad'}" style="width:${pct}%"></div><div class="dial-thr" style="left:${thrPct}%" title="threshold ${ai.threshold}"></div></div>
          <span class="gate-val ${ai.score >= ai.threshold ? 'yes' : 'no'}">${ai.score.toFixed(2)} ${ai.score >= ai.threshold ? '✓' : '✗'} <span class="muted">dial ${ai.threshold}</span></span></div>
      </div>
      <div class="muted" style="font-size:11px;margin:6px 0 12px">accept needs <b>both</b> gates · embed ${ai.timings.embedMs.toFixed(0)}ms + rerank ${ai.timings.rerankMs.toFixed(0)}ms</div>
      <table>
        <thead><tr><th>Reranked candidate</th><th>Category</th><th>Subcategory</th><th>Embed cos</th><th>Rerank</th></tr></thead>
        <tbody>${ai.shortlist
          .map(
            (c, i) => `<tr${i === 0 ? ' class="active"' : ''}>
            <td>${esc(c.phrase)}</td>
            <td><span class="code">${code(c.category)}</span> ${esc(c.category)}</td>
            <td class="muted">${esc(c.subcategory)}</td>
            <td class="muted">${c.cos.toFixed(2)}</td>
            <td style="font-family:ui-monospace,Consolas,monospace">${c.rerank.toFixed(3)}</td>
          </tr>`,
          )
          .join('')}</tbody>
      </table>
    </div>`;
}

/** Reflect the AI outcome back onto the cascade ladder so Tier 4–5 / 6 update. */
function augmentTrace(trace: TraceStep[], ai: AIResult): TraceStep[] {
  return trace.map((s) => {
    if (s.tier === 'Tier 4–5') {
      if (ai.outcome === 'accept') return { ...s, outcome: 'hit', detail: `reranker picked "${ai.shortlist[0].phrase}" → ${ai.category} / ${ai.subcategory} (${ai.score.toFixed(2)})` };
      if (ai.outcome === 'category-only') return { ...s, outcome: 'hit', detail: `category ${ai.category} agreed ${ai.consensusVotes}/${ai.consensusOf} — subcategory to human` };
      return { ...s, outcome: 'miss', detail: ai.reason };
    }
    if (s.tier === 'Tier 6') {
      if (ai.outcome === 'accept') return s;
      const what = ai.outcome === 'category-only' ? 'picks the subcategory' : 'decides the charge';
      return { ...s, outcome: 'deferred', detail: `awaiting human — ${what}` };
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
      const q = desc.value;
      try {
        const ai = await classifyWithAI(q, {
          onProgress: (stage, pct) => { btn.textContent = `Loading ${stage}… ${Math.round(pct)}%`; },
        });
        if (desc.value !== q) return; // input changed while loading
        btn.textContent = 'Re-run AI classification';
        btn.disabled = false;
        out.innerHTML = aiResultHtml(ai);
        ladderEl.innerHTML = renderLadder(augmentTrace(current.trace, ai));
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Run AI classification';
        out.innerHTML = `<div class="muted" style="margin-top:10px;color:var(--low)">AI tier failed to load: ${esc((e as Error).message)}</div>`;
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
