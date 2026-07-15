# Adjudication — Performance Evaluation

_Living document. Last updated: 2026-07-15._

Evaluates the classification pipeline ("Option A": deterministic cascade + self-hosted
embedder + cross-encoder reranker, **no generative LLM**) against a human-verified gold set,
and sets up a head-to-head against an LLM baseline.

---

## 1. Method

Accuracy is **measured on labeled data**, not assumed. Two evaluation sets:

- **Set A — description gold set (human-verified).** Real prod charges, stratified, labeled by
  hand with the correct v5 category + subcategory. Measures the description path (Tiers 2–3 + AI).
- **Set B — statute-code validation (auto).** Derived from the law books' alternate citations
  (the KB is ground truth for code → category, so no human labeling). Measures Tier 1.

The metric that matters is **not** "model accuracy" in the abstract but **"% auto-decided at a
target precision"** — that determines human-review load and therefore cost.

**Key terms**
- **Coverage** — share of charges the system auto-decides (vs. routes to a human). Drives cost.
- **Precision / accuracy (auto)** — of the auto-decided charges, the share with the correct label.
- Coverage and precision trade off, set by the reranker **threshold** (the "dial").

---

## 2. Set A — the gold set

- **Source:** production charges (`ProdPR5kCharges7-2-2026`), exclude-rule applied, deduped →
  731 distinct charges. Prod is **description-only** (no statute codes).
- **Sample:** 168 charges, stratified — frequency-weighted (reflects reality), hard/AI-deferred
  (oversampled), category-balanced, and short/edge cases. Includes a **30-charge blind subset**
  (machine prediction hidden) to measure labeler anchoring.
- **Labels (per charge):** category, subcategory, is-criminal, flag (not-a-charge / non-criminal /
  ambiguous / multi-offense / amended), difficulty, notes.
- **Ground truth:** drafted by an LLM judge, then **reviewed and approved by a human.** 167 of 168
  are classifiable charges (1 is literally "Other" → not-a-charge).
- Reproduce: `npm run build:goldset` → `eval/goldset_v1.xlsx`; labels in `eval/goldset_v1_judged.xlsx`.

> ⚠️ **Circularity note:** the gold labels were LLM-drafted + human-approved. The LLM baseline
> (§4) must therefore be a **different** model, or its number is an optimistic ceiling.

---

## 3. Results

### 3.1 Set A — Option A vs. human gold (167 charges)

At the default threshold (0.50):

| Metric | Result |
|---|---|
| **Coverage** (auto-decided) | **87.4%** (146/167) |
| **Category accuracy** (auto) | **73.3%** |
| **Subcategory accuracy** (auto) | **50.7%** |

By tier:

| Tier | n | Category acc | Subcategory acc |
|---|---|---|---|
| Tier 2 (exact) | 1 | 100% | 100% |
| Tier 3 (keyword) | 47 | **93.6%** | 85.1% |
| AI: accept | 91 | 60.4% | 36.3% |
| AI: category-only | 7 | **100%** | — (subcat → human) |
| AI: reject → human | 21 | (routed out) | — |

**The precision-vs-coverage dial** (reranker threshold sweep; affects AI-tier charges only):

| Threshold | Coverage | Category acc (auto) |
|---|---|---|
| 0.50 | 87.4% | 73.3% |
| 0.70 | 83.8% | 76.4% |
| 0.90 | 77.8% | 77.7% |
| 0.95 | 74.9% | 81.6% |

Reproduce: `npm run eval:score` → `eval/score_optionA.{json,xlsx}`.

### 3.2 Error analysis
- **Tier 3 is strong (93.6%).** The deterministic keyword path is reliable.
- **The AI tier is the drag (60% category).** Dominant error class: **traffic / driving** charges —
  `DRIVING WHILE INTOXICATED` → Drug Offenses, `DRIVING UNDER SUSP-REV` → Drug Offenses,
  `OPERATE VEH W/O LICENSE` → Commercial Transportation. The v5 anchor set for traffic/DUI is
  thin and confusable, and the small quantized reranker can't disambiguate them.
- **Some "errors" are taxonomy-boundary disagreements** (e.g. `GRAND THEFT` → Theft & Property vs.
  gold's Financial Crimes), where even the gold label is a judgment call.

### 3.3 Set B — statute-code validation
From all citation spellings in the law books:

- **42,511 spellings → 16,954 distinct (state, code) keys.**
- **Canonicalization robustness:** 100% across formatting variants (dots/hyphens/spaces/§/parens)
  — after a **fix** (see §5). Was 4.5% for dot↔hyphen before.
- **Ambiguity: 6.0% of code keys map to >1 category** — driven by cross-cutting statutes
  (e.g. WI §939.32 "Attempt" → 9 categories). These need full-code + description to disambiguate.
- **Data quality:** 2.3% of "citations" are not codes at all (offense names in the citation
  column) → flagged to the KB team. See `eval/statute_ambiguous_keys.csv`.

Reproduce: `npm run eval:statute`.

---

## 4. LLM baseline (planned)
Run a **different** frontier LLM over the same 167 gold charges, constrained to the v5 list, scored
identically (category + subcategory accuracy). Then assemble the multi-axis scorecard:

| Axis | Option A | LLM |
|---|---|---|
| Category accuracy | 73.3% (measured) | _tbd_ |
| Subcategory accuracy | 50.7% | _tbd_ |
| Coverage @ precision | dial (see 3.1) | — |
| Cost / charge | ~$0 + local compute | $ per API call |
| Latency | ~ms, local | network |
| Privacy | in-house | data leaves |
| Auditable | candidate + score | opaque |

The question is **not** "is the LLM more accurate?" but "does Option A hit the required precision
bar at a fraction of the cost, auditable, data in-house?"

---

## 5. Fixes applied
- **Canonicalization (Tier 1):** `canonicalizeCode` now strips all separators, so `302.113` and
  `302-113` collapse to one key (dot↔hyphen match: 4.5% → 100%).
- **Inchoate demotion (Tier 3):** `Conspiracy / Attempt / Accessory / Aiding & Abetting` anchors
  are excluded from Tier 3 (they signal nothing alone) and defer to the AI tier. Result: Tier 3
  category accuracy 81.5% → **93.6%**; overall 70.5% → **73.3%**.

---

## 6. Open items
1. **AI-tier accuracy on traffic/DUI** — enrich the v5 anchor set (KB-side) and/or use a larger /
   fine-tuned reranker (the architecture doc's "revisit later" path).
2. **LLM baseline + scorecard** (§4).
3. **Gold set** — expand beyond 168 for tighter per-category confidence; add inter-annotator
   agreement if a second labeler is available.
4. **KB data quality** — remove non-code entries from the alternate-citations column; review the
   1,020 ambiguous code keys.

## Reproduce everything
```
npm run build:data        # compile taxonomy + KB
npm run build:embeddings  # precompute anchor embeddings (once)
npm run eval:statute      # Set B report
npm run build:goldset     # Set A sampler (blank sheet)
npm run eval:score        # score Option A vs. the labeled gold set
```
