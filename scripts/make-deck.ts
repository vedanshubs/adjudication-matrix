/*
 * make-deck.ts — 2-slide deck: how Auto-Adjudication works + the self-learning loop.
 * The AI tier is kept deliberately generic (approach still under evaluation).
 * Run: npm run make:deck   -> Data/Documents/Auto_Adjudication_Approach.pptx
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pptxModule from 'pptxgenjs';
// interop: depending on the loader the ctor sits at .default.default, .default, or the module itself
const m: any = pptxModule;
const PptxGenJS: any = [m?.default?.default, m?.default, m].find((c) => typeof c === 'function' && c.prototype?.addSlide);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'Data', 'Documents', 'Auto_Adjudication_Approach.pptx');

const INK = '1F2A44', MUT = '6B7280', ACC = '2E6DB4';
const DET_BG = 'E8F1FB', DET_LN = '2E6DB4';
const AI_BG = 'FFF4E0', AI_LN = 'D99B16';
const HUM_BG = 'F1F2F6', HUM_LN = '9AA0BD';
const OUT_BG = 'E9F7F0', OUT_LN = '1F9D6B';

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_16x9'; // 10 x 5.625 in

// ---------------- Slide 1 — the cascade ----------------
const s1 = pptx.addSlide();
s1.addText('Auto-Adjudication — How a Charge Becomes a Decision', { x: 0.4, y: 0.28, w: 9.2, h: 0.4, fontSize: 22, bold: true, color: INK });
s1.addText('A confidence-tiered cascade: each charge falls only as far as it must. Cheapest, most certain method first.', { x: 0.4, y: 0.68, w: 9.2, h: 0.28, fontSize: 12, color: MUT });

const rungs: [string, string, string, string, string][] = [
  ['Layer 0', 'Normalize', 'Extract + canonicalize statute code, resolve state, normalize dates & severity', 'deterministic', 'det'],
  ['Tier 1', 'Statute lookup', 'Exact (state, canonical code) → category + subcategory', 'free · instant', 'det'],
  ['Tier 2', 'Exact description', 'Verbatim match against the knowledge base', 'free · instant', 'det'],
  ['Tier 3', 'Keyword + stemming', 'Glossary phrase match on the charge text', 'free · instant', 'det'],
  ['AI Tier', 'Resolves what deterministic can\'t', 'Approach under evaluation', 'AI', 'ai'],
  ['Human', 'Review', 'Confidence-gated — uncertain charges are never auto-decided', 'human', 'hum'],
];
let y = 1.06;
for (const [tier, name, desc, tag, kind] of rungs) {
  const bg = kind === 'det' ? DET_BG : kind === 'ai' ? AI_BG : HUM_BG;
  const ln = kind === 'det' ? DET_LN : kind === 'ai' ? AI_LN : HUM_LN;
  s1.addShape(pptx.ShapeType.roundRect, { x: 0.4, y, w: 6.5, h: 0.52, fill: { color: bg }, line: { color: ln, width: 1 }, rectRadius: 0.06 });
  s1.addText(tier, { x: 0.52, y, w: 0.9, h: 0.52, fontSize: 10.5, bold: true, color: ln, valign: 'middle' });
  s1.addText(name, { x: 1.42, y: y + 0.04, w: 2.2, h: 0.24, fontSize: 11, bold: true, color: INK, valign: 'middle' });
  s1.addText(desc, { x: 1.42, y: y + 0.25, w: 4.3, h: 0.22, fontSize: 8.5, color: MUT, valign: 'middle' });
  s1.addText(tag, { x: 5.72, y, w: 1.08, h: 0.52, fontSize: 8, color: ln, align: 'right', valign: 'middle' });
  y += 0.6;
}
// "falls" arrow
s1.addShape(pptx.ShapeType.rect, { x: 0.24, y: 1.1, w: 0.03, h: 3.3, fill: { color: 'D8DEE9' } });
s1.addText('▼', { x: 0.12, y: 4.35, w: 0.3, h: 0.2, fontSize: 8, color: 'D8DEE9' });

// callout
s1.addShape(pptx.ShapeType.roundRect, { x: 7.1, y: 1.06, w: 2.5, h: 1.0, fill: { color: 'FFFFFF' }, line: { color: 'D8DEE9', width: 1 }, rectRadius: 0.06 });
s1.addText('Most charges never reach the AI tier', { x: 7.22, y: 1.16, w: 2.26, h: 0.3, fontSize: 11, bold: true, color: ACC });
s1.addText('The deterministic tiers are free, instant and fully auditable — the AI tier is a safety net, not the default path.', { x: 7.22, y: 1.46, w: 2.26, h: 0.52, fontSize: 8.5, color: MUT });

// then-what chain
s1.addText('Then, per person:', { x: 7.1, y: 2.24, w: 2.5, h: 0.2, fontSize: 9, bold: true, color: INK });
const chain: [string, string][] = [
  ['Collapse duplicates', 'One incident counted once, not 30 rows'],
  ['Rule engine', 'Years × counts × severity, per state'],
  ['Decision', 'Deterministic and explainable'],
];
let cy = 2.5;
for (const [t, d] of chain) {
  s1.addShape(pptx.ShapeType.roundRect, { x: 7.1, y: cy, w: 2.5, h: 0.5, fill: { color: OUT_BG }, line: { color: OUT_LN, width: 1 }, rectRadius: 0.06 });
  s1.addText(t, { x: 7.22, y: cy + 0.04, w: 2.26, h: 0.22, fontSize: 10, bold: true, color: INK });
  s1.addText(d, { x: 7.22, y: cy + 0.25, w: 2.26, h: 0.2, fontSize: 8, color: MUT });
  cy += 0.62;
}
s1.addText('Accuracy is set, not gambled: a confidence threshold decides auto-accept vs. human review — and every decision records which tier, which match, and what score.', { x: 0.4, y: 4.78, w: 9.2, h: 0.4, fontSize: 9.5, color: MUT, italic: true });

s1.addNotes(
  '~22 sec\n\n' +
  'Auto-adjudication is a confidence-tiered cascade — the most certain, cost-effective methods first.\n\n' +
  'Layer zero canonicalizes the statute code and resolves the state. Then an exact state-plus-code lookup, ' +
  'an exact description match, and keyword matching with stemming — all deterministic, instant, and fully auditable.\n\n' +
  "The AI tier is the safety net for what those can't place, and a confidence threshold keeps human review " +
  'the final authority. Accuracy is never gambled.',
);

// ---------------- Slide 2 — the loop ----------------
const s2 = pptx.addSlide();
s2.addText('Feedback / Self-Learning Loop', { x: 0.4, y: 0.28, w: 9.2, h: 0.4, fontSize: 22, bold: true, color: INK });
s2.addText('The system gets cheaper and more accurate the longer it runs — with no model retraining, and nothing going live unreviewed.', { x: 0.4, y: 0.68, w: 9.2, h: 0.28, fontSize: 12, color: MUT });

const loop: [string, string][] = [
  ['1 · Charge resolved', 'by the AI tier or a person'],
  ['2 · Rule proposed', 'a text pattern, or a (state, code) mapping'],
  ['3 · Checked', 'frequency + confidence thresholds'],
  ['4 · Human approves', 'the gate — nothing goes live unseen'],
  ['5 · Promoted', 'into the deterministic tier, versioned'],
];
let lx = 0.4;
for (let i = 0; i < loop.length; i++) {
  const [t, d] = loop[i];
  const isGate = i === 3;
  s2.addShape(pptx.ShapeType.roundRect, { x: lx, y: 1.25, w: 1.72, h: 1.0, fill: { color: isGate ? AI_BG : DET_BG }, line: { color: isGate ? AI_LN : DET_LN, width: isGate ? 2 : 1 }, rectRadius: 0.06 });
  s2.addText(t, { x: lx + 0.1, y: 1.35, w: 1.52, h: 0.3, fontSize: 10.5, bold: true, color: INK });
  s2.addText(d, { x: lx + 0.1, y: 1.66, w: 1.52, h: 0.5, fontSize: 8.5, color: MUT });
  if (i < loop.length - 1) s2.addText('→', { x: lx + 1.74, y: 1.25, w: 0.22, h: 1.0, fontSize: 14, color: ACC, align: 'center', valign: 'middle' });
  lx += 1.94;
}
// return arrow
s2.addShape(pptx.ShapeType.roundRect, { x: 0.4, y: 2.5, w: 9.2, h: 0.42, fill: { color: OUT_BG }, line: { color: OUT_LN, width: 1 }, rectRadius: 0.06 });
s2.addText('↺   The next identical charge is handled by the deterministic tier — instantly, free, no AI call.   "AI today, deterministic tomorrow."', { x: 0.5, y: 2.5, w: 9.0, h: 0.42, fontSize: 10.5, bold: true, color: OUT_LN, valign: 'middle', align: 'center' });

s2.addText('Why this matters', { x: 0.4, y: 3.12, w: 4.4, h: 0.24, fontSize: 12, bold: true, color: INK });
s2.addText(
  [
    { text: 'Human-gated. ', options: { bold: true } }, { text: 'AI proposes, a person approves. One bad rule cannot quietly spread across thousands of decisions.\n' },
    { text: 'Versioned & reversible. ', options: { bold: true } }, { text: 'Every rule is stamped and can be rolled back; any past decision traces to the exact rules in force.\n' },
    { text: 'Compounding. ', options: { bold: true } }, { text: 'Hard cases become cheap lookups, so cost falls and coverage rises over time.' },
  ],
  { x: 0.4, y: 3.4, w: 4.5, h: 1.5, fontSize: 9.5, color: MUT, lineSpacingMultiple: 1.3 },
);
s2.addText('Guardrails', { x: 5.1, y: 3.12, w: 4.5, h: 0.24, fontSize: 12, bold: true, color: INK });
s2.addText(
  [
    { text: '• Only propose above frequency + confidence thresholds — one odd charge cannot mint a rule\n' },
    { text: '• Serious offences held to stricter review than routine, high-volume ones\n' },
    { text: '• We have already run this loop by hand: adding mined abbreviations lifted keyword coverage from ~⅓ to ~⅔' },
  ],
  { x: 5.1, y: 3.4, w: 4.5, h: 1.5, fontSize: 9.5, color: MUT, lineSpacingMultiple: 1.3 },
);
s2.addText('AI tier approach (embeddings + reranker vs. LLM) is still under evaluation — the loop and the deterministic core are unaffected by that choice.', { x: 0.4, y: 4.85, w: 9.2, h: 0.3, fontSize: 9.5, color: MUT, italic: true });

s2.addNotes(
  '~20 sec\n\n' +
  'A self-learning loop closes it. Each resolved charge proposes a rule — a text pattern or a state-code mapping — ' +
  'checked against frequency and confidence thresholds. A human approves it, and it is promoted into the ' +
  'deterministic tier, versioned and reversible.\n\n' +
  'The next identical charge is a free lookup — no AI call. Cheaper and more accurate the longer it runs, ' +
  'with no unreviewed rule ever going live.',
);

await pptx.writeFile({ fileName: OUT });
console.log('Wrote', path.relative(ROOT, OUT));
