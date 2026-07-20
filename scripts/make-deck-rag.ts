/*
 * make-deck-rag.ts — 5-slide deck: the RAG approach we're taking for auto-adjudication.
 * Separate from make-deck.ts (the original 3-slide overview), which stays intact.
 * Run: npm run make:deck:rag  ->  Data/Documents/Auto_Adjudication_RAG_Approach.pptx
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pptxModule from 'pptxgenjs';
const m: any = pptxModule;
const PptxGenJS: any = [m?.default?.default, m?.default, m].find((c) => typeof c === 'function' && c.prototype?.addSlide);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'Data', 'Documents', 'Auto_Adjudication_RAG_Approach.pptx');

const INK = '1F2A44', MUT = '6B7280', ACC = '2E6DB4';
const DET_BG = 'E8F1FB', DET_LN = '2E6DB4';
const AI_BG = 'FFF4E0', AI_LN = 'D99B16';
const HUM_BG = 'F1F2F6', HUM_LN = '9AA0BD';
const OK_BG = 'E9F7F0', OK_LN = '1F9D6B';
const WARN = 'C0392B';

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_16x9';
const title = (s: any, t: string, sub: string) => {
  s.addText(t, { x: 0.4, y: 0.26, w: 9.2, h: 0.4, fontSize: 22, bold: true, color: INK });
  s.addText(sub, { x: 0.4, y: 0.66, w: 9.2, h: 0.3, fontSize: 12, color: MUT });
};

// ---------------- 1 — the approach ----------------
const s1 = pptx.addSlide();
title(s1, 'The Approach — Search the Law Books, Then Decide',
  'Each charge falls only as far as it must. The AI never answers freely — it chooses from entries in our own law books.');

const rungs: [string, string, string, string][] = [
  ['1', 'Look up the statute code', 'Exact match on (state, code) — instant and certain', 'det'],
  ['2', 'Match the description', 'Exact or keyword match against the books', 'det'],
  ['3', 'Search the books', 'Finds the 10 closest offences by meaning, not spelling', 'ai'],
  ['4', 'AI picks one of the 10', 'Chooses by number — it cannot invent a category', 'ai'],
  ['5', 'Human review', 'If nothing fits, a person decides. Nothing is guessed.', 'hum'],
];
let y = 1.15;
for (const [n, t, d, kind] of rungs) {
  const bg = kind === 'det' ? DET_BG : kind === 'ai' ? AI_BG : HUM_BG;
  const ln = kind === 'det' ? DET_LN : kind === 'ai' ? AI_LN : HUM_LN;
  s1.addShape(pptx.ShapeType.roundRect, { x: 0.4, y, w: 6.1, h: 0.62, fill: { color: bg }, line: { color: ln, width: 1 }, rectRadius: 0.06 });
  s1.addText(n, { x: 0.52, y, w: 0.35, h: 0.62, fontSize: 15, bold: true, color: ln, valign: 'middle' });
  s1.addText(t, { x: 0.95, y: y + 0.06, w: 3.1, h: 0.26, fontSize: 12, bold: true, color: INK });
  s1.addText(d, { x: 0.95, y: y + 0.31, w: 5.4, h: 0.24, fontSize: 9, color: MUT });
  y += 0.7;
}
s1.addShape(pptx.ShapeType.rect, { x: 0.24, y: 1.2, w: 0.03, h: 3.1, fill: { color: 'D8DEE9' } });

s1.addShape(pptx.ShapeType.roundRect, { x: 6.75, y: 1.15, w: 2.85, h: 1.5, fill: { color: 'FFFFFF' }, line: { color: OK_LN, width: 1.5 }, rectRadius: 0.06 });
s1.addText('Why this is safe', { x: 6.88, y: 1.24, w: 2.6, h: 0.26, fontSize: 12, bold: true, color: OK_LN });
s1.addText([
  { text: 'It can only choose from our own law books — it cannot make up a category.\n', options: { bullet: true } },
  { text: 'It says "none of these fit" and hands over to a person.\n', options: { bullet: true } },
  { text: 'Every answer shows the 10 options and which was picked.', options: { bullet: true } },
], { x: 6.88, y: 1.5, w: 2.6, h: 1.1, fontSize: 8.5, color: MUT, lineSpacingMultiple: 1.15 });

s1.addShape(pptx.ShapeType.roundRect, { x: 6.75, y: 2.78, w: 2.85, h: 1.5, fill: { color: DET_BG }, line: { color: DET_LN, width: 1 }, rectRadius: 0.06 });
s1.addText('Then, per person', { x: 6.88, y: 2.87, w: 2.6, h: 0.26, fontSize: 12, bold: true, color: ACC });
s1.addText([
  { text: 'Collapse duplicate records\n', options: { bullet: true } },
  { text: 'Apply the client’s year + count rules\n', options: { bullet: true } },
  { text: 'Produce a decision we can explain', options: { bullet: true } },
], { x: 6.88, y: 3.13, w: 2.6, h: 1.1, fontSize: 8.5, color: MUT, lineSpacingMultiple: 1.15 });

s1.addText('Steps 1–2 are free and instant, and handle the common charges. The AI only sees what they can’t place.', { x: 0.4, y: 4.72, w: 9.2, h: 0.3, fontSize: 10, italic: true, color: MUT });
s1.addNotes('~20 sec\n\nEvery charge runs down a ladder, cheapest first. A statute code or a description match settles it instantly and for free. Only what those cannot place goes to the AI — and even then the AI does not answer freely: we search our own law books for the ten closest offences and the model just picks one of them by number. It cannot invent a category, and if nothing fits it says so and a person decides.');

// ---------------- 2 — why this design ----------------
const s2 = pptx.addSlide();
title(s2, 'Why This Design — We Measured Where It Was Failing',
  'The search was already finding the right answer. The old method was choosing badly. So we replaced the chooser.');

const bars: [string, number, string, string][] = [
  ['Right answer is found by the search', 92, OK_LN, 'the books do contain it'],
  ['…what the OLD method picked', 78, WARN, 'similarity scoring — no understanding'],
  ['…what the NEW method (AI) picks', 87, ACC, 'reads the charge and reasons'],
];
let by = 1.35;
for (const [label, pct, color, note] of bars) {
  s2.addText(label, { x: 0.4, y: by, w: 3.5, h: 0.3, fontSize: 11.5, bold: true, color: INK, valign: 'middle' });
  s2.addShape(pptx.ShapeType.roundRect, { x: 4.0, y: by + 0.04, w: 4.6, h: 0.26, fill: { color: 'EDF0F5' }, line: { color: 'FFFFFF', width: 0 }, rectRadius: 0.03 });
  s2.addShape(pptx.ShapeType.roundRect, { x: 4.0, y: by + 0.04, w: 4.6 * (pct / 100), h: 0.26, fill: { color }, line: { color: 'FFFFFF', width: 0 }, rectRadius: 0.03 });
  s2.addText(`${pct}%`, { x: 8.7, y: by, w: 0.8, h: 0.3, fontSize: 12, bold: true, color, valign: 'middle' });
  s2.addText(note, { x: 4.0, y: by + 0.32, w: 4.6, h: 0.22, fontSize: 8.5, color: MUT });
  by += 0.78;
}

s2.addShape(pptx.ShapeType.roundRect, { x: 0.4, y: 3.75, w: 4.5, h: 1.05, fill: { color: AI_BG }, line: { color: AI_LN, width: 1 }, rectRadius: 0.06 });
s2.addText('The gap was the chooser, not the search', { x: 0.55, y: 3.84, w: 4.2, h: 0.26, fontSize: 12, bold: true, color: INK });
s2.addText('The old method compared word similarity — it had no idea that “DWS” means driving while suspended. The AI does.', { x: 0.55, y: 4.1, w: 4.2, h: 0.6, fontSize: 9.5, color: MUT });

s2.addShape(pptx.ShapeType.roundRect, { x: 5.1, y: 3.75, w: 4.5, h: 1.05, fill: { color: OK_BG }, line: { color: OK_LN, width: 1 }, rectRadius: 0.06 });
s2.addText('Biggest gain: the finer sub-category', { x: 5.25, y: 3.84, w: 4.2, h: 0.26, fontSize: 12, bold: true, color: INK });
s2.addText('Sub-category accuracy went from 58% to 79% — the largest single improvement we measured.', { x: 5.25, y: 4.1, w: 4.2, h: 0.6, fontSize: 9.5, color: MUT });

s2.addNotes('~20 sec\n\nWe measured the two halves separately. The search step was already good — the correct category is among the ten results ninety-two percent of the time. But the old method for choosing between them only got seventy-eight. So the books were fine and the search was fine; the chooser was the weak link. Replacing it with an AI that actually reads the charge closed most of that gap — and the biggest gain was on the finer sub-category, from fifty-eight to seventy-nine percent.');

// ---------------- 3 — the numbers ----------------
const s3 = pptx.addSlide();
title(s3, 'What We Measured — Five Approaches, Same Test',
  '167 real charges, each checked by hand. Same test for every approach.');

const cols = [3.55, 4.75, 5.95, 7.35];
s3.addText('APPROACH', { x: 0.42, y: 1.12, w: 3.1, h: 0.24, fontSize: 8.5, bold: true, color: MUT });
['CATEGORY', 'SUB-CAT', 'COST / 1M', 'IN-HOUSE?'].forEach((h, i) =>
  s3.addText(h, { x: cols[i], y: 1.12, w: 1.15, h: 0.24, fontSize: 8.5, bold: true, color: MUT, align: 'center' }));

const rows: [string, string, string, string, string, boolean][] = [
  ['In-house model only', '85%', '58%', 'free', 'yes', false],
  ['Large AI, whole category list', '87%', '74%', '$527', 'no', false],
  ['Largest AI, whole category list', '93%', '74%', '$1,558', 'no', false],
  ['Search the books + AI picks', '89%', '79%', '$119', 'yes', true],
];
let ry = 1.44;
for (const [name, cat, sub, cost, house, best] of rows) {
  s3.addShape(pptx.ShapeType.roundRect, { x: 0.4, y: ry, w: 9.2, h: 0.56, fill: { color: best ? OK_BG : 'FFFFFF' }, line: { color: best ? OK_LN : 'E2E6ED', width: best ? 1.75 : 1 }, rectRadius: 0.05 });
  s3.addText(name + (best ? '   ← our choice' : ''), { x: 0.55, y: ry, w: 3.1, h: 0.56, fontSize: 10.5, bold: best, color: best ? OK_LN : INK, valign: 'middle' });
  [cat, sub, cost, house].forEach((v, i) =>
    s3.addText(v, { x: cols[i], y: ry, w: 1.15, h: 0.56, fontSize: 11, bold: best, color: best ? OK_LN : INK, align: 'center', valign: 'middle' }));
  ry += 0.64;
}

s3.addShape(pptx.ShapeType.roundRect, { x: 0.4, y: 4.15, w: 9.2, h: 0.95, fill: { color: 'FFFFFF' }, line: { color: 'D8DEE9', width: 1 }, rectRadius: 0.06 });
s3.addText('The trade we’re making', { x: 0.55, y: 4.22, w: 4.0, h: 0.24, fontSize: 11.5, bold: true, color: INK });
s3.addText('The largest AI is ~4 points better on category — but costs 13× more, sends data outside, and never says “I’m not sure”. Our approach is close on category, better on sub-category, and keeps the data in-house.', { x: 0.55, y: 4.46, w: 8.9, h: 0.6, fontSize: 9.5, color: MUT });

s3.addNotes('~20 sec\n\nWe ran five approaches over the same hundred and sixty seven charges, each one checked by hand. Our approach — searching the books and letting the AI pick — gets eighty-nine percent on category and the best sub-category score of anything we tested, at about a hundred and twenty dollars per million charges. The largest AI is roughly four points better on category, but it costs thirteen times more, sends data outside, and never admits when it is unsure.');

// ---------------- 4 — cost & scale ----------------
const s4 = pptx.addSlide();
title(s4, 'Cost and Scale — It Gets Better as the Books Grow',
  'Three things keep this cheap, private, and improving over time.');

const cards: [string, string, string][] = [
  ['Pay once per charge, ever', 'A shared cache (Redis) stores every answer, keyed to the law-book version. In our 5,000-charge sample 57% were repeats — those return instantly and cost nothing. The hit rate only grows.', OK_LN],
  ['Runs on our own servers', 'The AI model is one we can host ourselves — no per-use fee, and candidate data never leaves our environment.', ACC],
  ['Improves with the law books', 'Accuracy is limited by what the books contain, not by how much we spend. Every state we add makes it better — with no change to the technology.', AI_LN],
];
let cx = 0.4;
for (const [t, d, color] of cards) {
  pptxCard(s4, cx, 1.2, 2.98, 1.75, t, d, color);
  cx += 3.1;
}
function pptxCard(s: any, x: number, yy: number, w: number, h: number, t: string, d: string, color: string) {
  s.addShape(pptx.ShapeType.roundRect, { x, y: yy, w, h, fill: { color: 'FFFFFF' }, line: { color, width: 1.5 }, rectRadius: 0.07 });
  s.addText(t, { x: x + 0.15, y: yy + 0.12, w: w - 0.3, h: 0.45, fontSize: 12.5, bold: true, color });
  s.addText(d, { x: x + 0.15, y: yy + 0.6, w: w - 0.3, h: h - 0.72, fontSize: 9.5, color: MUT });
}

s4.addShape(pptx.ShapeType.roundRect, { x: 0.4, y: 3.2, w: 9.2, h: 0.75, fill: { color: OK_BG }, line: { color: OK_LN, width: 1 }, rectRadius: 0.06 });
s4.addText('Accuracy grows with our data — not our budget.', { x: 0.4, y: 3.2, w: 9.2, h: 0.75, fontSize: 15, bold: true, color: OK_LN, align: 'center', valign: 'middle' });

s4.addText('Today the search covers 4 states. Every state we add raises the ceiling for free — whereas simply buying a bigger AI model only raises the bill.', { x: 0.4, y: 4.08, w: 9.2, h: 0.5, fontSize: 10.5, color: MUT, align: 'center' });
s4.addText('Uncertain charges still go to a person — accuracy is set deliberately, not left to chance.', { x: 0.4, y: 4.68, w: 9.2, h: 0.3, fontSize: 10, italic: true, color: MUT, align: 'center' });

s4.addNotes('~22 sec\n\nThree things keep this affordable. First, caching: the same charge descriptions repeat constantly — fifty-seven percent of our five thousand row sample were duplicates — so a Redis cache keyed to the law-book version means we pay for each distinct charge once, ever. The key includes the version, so when the books change the affected answers recompute rather than going stale. Second, the model can run on our own servers, so there is no per-use fee and candidate data stays in-house. And third, accuracy is limited by what our law books contain — so every state we add improves it for free. Accuracy grows with our data, not our budget.');

// ---------------- 5 — what we need ----------------
const s5 = pptx.addSlide();
title(s5, 'What We Need Next — The Limit Is the Data, Not the Technology',
  'All five approaches stalled at the same point, failing on the same charges. That points at the books, not the software.');

const needs: [string, string][] = [
  ['Record the abbreviations', 'Charges arrive as “DWS-DWR”, not “driving while suspended”. Nothing in the books matches short forms — the single biggest cause of failures.'],
  ['Decide where theft and DUI belong', 'Theft is spread across six categories, and drug-related DUI sits apart from other DUI. Each is one decision that removes a whole class of errors.'],
  ['Cover traffic offences properly', 'Traffic is roughly a third of all charges and our largest error group — several common traffic offences simply aren’t in the books.'],
  ['Finish standardising the books', 'Sub-category names don’t match the official list in 14% of rows, and California hasn’t been standardised at all.'],
];
let ny = 1.2;
for (const [t, d] of needs) {
  s5.addShape(pptx.ShapeType.roundRect, { x: 0.4, y: ny, w: 9.2, h: 0.78, fill: { color: 'FFFFFF' }, line: { color: 'D8DEE9', width: 1 }, rectRadius: 0.06 });
  s5.addShape(pptx.ShapeType.roundRect, { x: 0.4, y: ny, w: 0.09, h: 0.78, fill: { color: ACC }, line: { color: ACC, width: 0 }, rectRadius: 0.02 });
  s5.addText(t, { x: 0.65, y: ny + 0.06, w: 3.3, h: 0.3, fontSize: 12, bold: true, color: INK });
  s5.addText(d, { x: 3.95, y: ny + 0.08, w: 5.5, h: 0.62, fontSize: 9.5, color: MUT });
  ny += 0.86;
}
s5.addShape(pptx.ShapeType.roundRect, { x: 0.4, y: 4.68, w: 9.2, h: 0.55, fill: { color: AI_BG }, line: { color: AI_LN, width: 1 }, rectRadius: 0.06 });
s5.addText('These are improvements to the law books — and they raise accuracy for every approach at once.', { x: 0.4, y: 4.68, w: 9.2, h: 0.55, fontSize: 11.5, bold: true, color: INK, align: 'center', valign: 'middle' });

s5.addNotes('~18 sec\n\nThe honest finding is that we are now limited by the data, not the technology — every approach we tried stalled at the same point and failed on the same charges. Four things would move it: record the abbreviations that charges actually arrive as, decide where theft and drug-related DUI belong, cover traffic offences properly, and finish standardising the books including California. These are all improvements to the books, and they lift every approach at once.');

await pptx.writeFile({ fileName: OUT });
console.log('Wrote', path.relative(ROOT, OUT));
