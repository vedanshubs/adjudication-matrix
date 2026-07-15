// View 2 — Candidate: a person's charges -> tidy up (dedup) -> rules -> verdict.
// Category-centric layout: each category the person has is a self-contained card
// (its charges + its rule + its verdict), so the "why" is obvious at a glance.
import { evaluate, defaultRuleset, type Charge, type Ruleset, type Adjudication, type Disposition, type EvaluatedCharge, type CategoryTally } from '../../core/matrix.ts';
import { categories } from '../../core/data.ts';
import { candidates } from '../../core/fixtures.ts';
import type { Severity } from '../../core/types.ts';
import { esc, renderLadder } from '../ui.ts';

const YEAR_OPTS: (number | 'Any')[] = ['Any', 1, 2, 3, 5, 7, 10];
const COUNT_OPTS = [1, 2, 3, 4, 5, 10];
const clone = (chs: Charge[]): Charge[] => chs.map((c) => ({ ...c }));

// Editable inputs (type any value) with the presets offered as suggestions.
const yearsControl = (cat: string, val: number | 'Any') =>
  `<input class="mini-in" list="dl-years" data-cat="${esc(cat)}" data-role="years" value="${val}" title="a number of years, or Any">`;
const countControl = (cat: string, val: number) =>
  `<input class="mini-in num" type="number" min="1" list="dl-count" data-cat="${esc(cat)}" data-role="count" value="${val}">`;
const DATALISTS = `<datalist id="dl-years">${YEAR_OPTS.map((o) => `<option>${o}</option>`).join('')}</datalist><datalist id="dl-count">${COUNT_OPTS.map((o) => `<option>${o}</option>`).join('')}</datalist>`;
const windowLabel = (y: number | 'Any') => (y === 'Any' ? 'any time' : `${y}y`);
const plural = (n: number) => (n === 1 ? '' : 's');

export function renderCandidateView(root: HTMLElement): void {
  let charges: Charge[] = clone(candidates[0].charges);
  let personName = candidates[0].name;
  const ruleset: Ruleset = defaultRuleset();
  let showMatrix = false;

  // ---------- plain-English verdict ----------
  function verdictSentence(a: Adjudication): string {
    if (a.overall === 'Flagged') {
      if (a.breaches.length === 1) {
        const b = a.breaches[0];
        const w = b.rule.years === 'Any' ? 'on record' : `in the last ${b.rule.years} years`;
        return `${personName} has ${b.convictionsInWindow} ${b.category} conviction${plural(b.convictionsInWindow)} ${w} — the limit is ${b.rule.count}, so this record is flagged.`;
      }
      const list = a.breaches.slice(0, 3).map((b) => `${b.category} (${b.convictionsInWindow} of ${b.rule.count})`).join(', ');
      return `${personName}'s record crosses the line in ${a.breaches.length} categories: ${list}. Flagged.`;
    }
    if (a.overall === 'Review') {
      const p = a.evaluated.find((e) => e.charge.disposition === 'Pending' && e.category);
      return `${personName} has a pending ${p?.category ?? ''} charge — it's held for a person to review before any decision.`;
    }
    return `Nothing on ${personName}'s record reaches a threshold. No action needed.`;
  }

  function verdictBanner(a: Adjudication): string {
    const icon = { Clear: '✓', Review: '⏸', Flagged: '⚠' }[a.overall];
    const meaning = { Clear: 'no action', Review: 'needs a person', Flagged: 'adverse' }[a.overall];
    return `<div class="verdict ${a.overall}">
      <div class="v-badge"><div class="v-icon">${icon}</div><div><div class="v-title">${a.overall.toUpperCase()}</div><div class="v-mean">${meaning}</div></div></div>
      <div class="v-say">${esc(verdictSentence(a))}</div>
    </div>`;
  }

  // ---------- pipeline strip ----------
  function pipeline(a: Adjudication): string {
    const d = a.dedup;
    const steps = [
      { t: 'Record', v: `${d.original} charge${plural(d.original)}` },
      { t: '🧹 Tidied up', v: d.collapsed ? `${d.original}→${d.deduped.length}, ${d.collapsed} duplicate${plural(d.collapsed)} folded` : 'no duplicates' },
      { t: '⚖ Rules', v: `${a.tallies.length} categor${a.tallies.length === 1 ? 'y' : 'ies'} checked` },
      { t: 'Verdict', v: a.overall },
    ];
    return `<div class="pipe">${steps.map((s, i) => `<div class="pstep"><div class="pt">${s.t}</div><div class="pv">${esc(s.v)}</div></div>${i < 3 ? '<div class="parrow">→</div>' : ''}`).join('')}</div>`;
  }

  // ---------- category cards ----------
  function chargeLine(e: EvaluatedCharge): string {
    const counts = e.countsTowardBreach
      ? `<span class="counts yes">✓ counts</span>`
      : `<span class="counts no">— ${esc(e.note.replace(/ —.*/, '').replace(/pending.*/, 'pending, not counted'))}</span>`;
    return `<div class="cl">
      <div class="cl-main">${esc(e.charge.description)}
        <span class="muted">· ${e.charge.disposition} · ${e.charge.yearsAgo}y ago</span>
        <details><summary class="muted trace-toggle">how classified ▸</summary><div class="ladder" style="margin-top:6px">${renderLadder(e.map.trace)}</div></details>
      </div>
      <div class="cl-side">${counts}<button class="xbtn" data-rm-desc="${esc(e.charge.description)}" data-rm-yr="${e.charge.yearsAgo}">✕</button></div>
    </div>`;
  }

  function categoryCard(cat: string, code: string, tally: CategoryTally | undefined, evs: EvaluatedCharge[]): string {
    const rule = ruleset.byCategory[cat];
    const count = tally?.convictionsInWindow ?? 0;
    const breach = !!tally?.breach;
    const pending = evs.some((e) => e.charge.disposition === 'Pending');
    const status = breach ? 'breach' : pending ? 'pending' : count > 0 ? 'ok' : 'none';
    const dot = { breach: 'bad', pending: 'defer', ok: 'ok', none: 'skip' }[status];
    const tag = breach ? '<span class="ctag bad">BREACH</span>' : pending ? '<span class="ctag defer">HELD</span>' : '<span class="ctag ok">under limit</span>';
    return `<div class="cat-card ${breach ? 'breach' : ''}">
      <div class="cat-head">
        <div class="cat-name"><span class="dot ${dot}"></span> <span class="code">${code}</span> <b>${esc(cat)}</b></div>
        <div class="cat-sum"><b>${count} of ${rule.count}</b> in ${windowLabel(rule.years)} ${tag}</div>
      </div>
      <div class="cat-charges">${evs.map(chargeLine).join('')}</div>
      <div class="cat-rule">Look back ${yearsControl(cat, rule.years)} years · Flag at ${countControl(cat, rule.count)} conviction${rule.count === 1 ? '' : 's'}</div>
    </div>`;
  }

  function categoryCards(a: Adjudication): string {
    const byCat = new Map<string, EvaluatedCharge[]>();
    const unmapped: EvaluatedCharge[] = [];
    for (const e of a.evaluated) {
      if (!e.category) unmapped.push(e);
      else (byCat.get(e.category) ?? byCat.set(e.category, []).get(e.category)!).push(e);
    }
    const codeOf = (c: string) => a.tallies.find((t) => t.category === c)?.code ?? categories.find((x) => x.name === c)?.code ?? '—';
    // breached categories first (tallies is already sorted breach-first)
    const ordered = a.tallies.map((t) => t.category).filter((c) => byCat.has(c));
    const cards = ordered.map((c) => categoryCard(c, codeOf(c), a.tallies.find((t) => t.category === c), byCat.get(c)!));
    if (unmapped.length) {
      cards.push(`<div class="cat-card">
        <div class="cat-head"><div class="cat-name"><span class="dot defer"></span> <b>Unclassified</b></div>
        <div class="cat-sum"><span class="ctag defer">→ AI tier</span></div></div>
        <div class="cat-charges">${unmapped.map(chargeLine).join('')}</div></div>`);
    }
    return cards.join('') || `<div class="card muted">No charges yet — pick a sample or add one.</div>`;
  }

  // ---------- advanced full matrix ----------
  function fullMatrix(a: Adjudication): string {
    const tallyByCat = new Map(a.tallies.map((t) => [t.category, t]));
    const inPlay = new Set(a.tallies.map((t) => t.category));
    return `<table><thead><tr><th>Code</th><th>Category</th><th>Look back</th><th>Flag at</th><th>Count</th><th></th></tr></thead><tbody>${categories
      .map((cat) => {
        const rule = ruleset.byCategory[cat.name];
        const t = tallyByCat.get(cat.name);
        const count = t?.convictionsInWindow ?? 0;
        const breach = !!t?.breach;
        return `<tr class="${breach ? 'breach' : ''} ${inPlay.has(cat.name) ? 'active' : ''}"><td><span class="code">${cat.code}</span></td><td>${esc(cat.name)}</td><td>${yearsControl(cat.name, rule.years)}</td><td>${countControl(cat.name, rule.count)}</td><td style="font-family:ui-monospace,Consolas,monospace">${count} / ${rule.count}</td><td><span class="dot ${count === 0 ? 'skip' : breach ? 'bad' : 'ok'}"></span></td></tr>`;
      })
      .join('')}</tbody></table>`;
  }

  // ---------- render ----------
  function render(): void {
    const a = evaluate(charges, ruleset);
    root.innerHTML = `
      ${DATALISTS}
      <div style="display:grid;grid-template-columns:300px 1fr;gap:16px;align-items:start">
        <div>
          <div class="card"><h2>Candidate</h2><label>Load a sample</label>
            <select id="cand-sel">${candidates.map((c, i) => `<option value="${i}">${esc(c.name)}</option>`).join('')}</select>
            <div class="muted" style="font-size:11.5px;margin-top:6px">${esc(candidates.find((c) => c.name === personName)?.note ?? 'custom record')}</div>
          </div>
          <div class="card"><h2>Add a charge</h2>
            <label>Offense description</label><textarea id="ac-desc" placeholder="e.g. Aggravated Assault"></textarea>
            <div class="row c2" style="margin-top:6px">
              <div><label>Severity</label><select id="ac-sev"><option>Felony</option><option>Misdemeanor</option><option>Infraction</option><option>Unknown</option></select></div>
              <div><label>Disposition</label><select id="ac-disp"><option>Convicted</option><option>Pending</option><option>Dismissed</option><option>Acquitted</option></select></div>
            </div>
            <div class="row c2" style="margin-top:6px">
              <div><label>State</label><input id="ac-state" placeholder="TN" /></div>
              <div><label>Years ago</label><input id="ac-years" type="number" value="2" min="0" max="40" /></div>
            </div>
            <button class="chip" id="ac-add" style="margin-top:10px;padding:7px 14px">Add charge</button>
          </div>
        </div>
        <div>
          ${verdictBanner(a)}
          ${pipeline(a)}
          <div class="cat-list">${categoryCards(a)}</div>
          <div class="card" style="margin-top:6px">
            <button class="chip" id="toggle-matrix">${showMatrix ? '▾ Hide' : '▸ Show'} full 32-category matrix (advanced)</button>
            <div style="margin-top:12px;${showMatrix ? '' : 'display:none'}">${showMatrix ? fullMatrix(a) : ''}</div>
          </div>
        </div>
      </div>`;
    wire();
  }

  function wire(): void {
    const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
    const sel = q<HTMLSelectElement>('#cand-sel');
    sel.value = String(Math.max(0, candidates.findIndex((c) => c.name === personName)));
    sel.addEventListener('change', () => {
      const cand = candidates[sel.selectedIndex];
      charges = clone(cand.charges);
      personName = cand.name;
      render();
    });
    root.querySelectorAll<HTMLButtonElement>('[data-rm-desc]').forEach((b) =>
      b.addEventListener('click', () => {
        charges = charges.filter((c) => !(c.description === b.dataset.rmDesc && String(c.yearsAgo) === b.dataset.rmYr));
        render();
      }),
    );
    q<HTMLButtonElement>('#ac-add').addEventListener('click', () => {
      const desc = q<HTMLTextAreaElement>('#ac-desc').value.trim();
      if (!desc) return;
      charges.push({
        description: desc,
        severity: q<HTMLSelectElement>('#ac-sev').value as Severity,
        disposition: q<HTMLSelectElement>('#ac-disp').value as Disposition,
        state: q<HTMLInputElement>('#ac-state').value.trim() || undefined,
        yearsAgo: Number(q<HTMLInputElement>('#ac-years').value),
      });
      render();
    });
    q<HTMLButtonElement>('#toggle-matrix').addEventListener('click', () => { showMatrix = !showMatrix; render(); });
    root.querySelectorAll<HTMLInputElement>('input[data-cat]').forEach((el) =>
      el.addEventListener('change', () => {
        const rule = ruleset.byCategory[el.dataset.cat!];
        if (el.dataset.role === 'years') {
          const v = el.value.trim();
          if (/^any$/i.test(v)) rule.years = 'Any';
          else { const n = Number(v); if (Number.isFinite(n) && n >= 0) rule.years = Math.floor(n); }
        } else {
          const n = Number(el.value);
          if (Number.isFinite(n) && n >= 1) rule.count = Math.floor(n);
        }
        render();
      }),
    );
  }

  render();
}
