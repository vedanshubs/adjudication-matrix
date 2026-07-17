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
- **Second-pass audit:** the 20 hardest charges (where *both* the deterministic and LLM systems
  failed) were re-reviewed by hand. Only **3 gold labels were actually wrong** (85% held up) — all
  in the theft/financial boundary. Those 3 were corrected; results below use the corrected gold.
  This audit surfaced a taxonomy gap: **Theft & Property Crimes has no value-based-theft subcategory**
  (value-theft currently sits under Financial Crimes).
- Reproduce: `npm run build:goldset` → `eval/goldset_v1.xlsx`; labels in `eval/goldset_v1_judged.xlsx`.

> ⚠️ **Circularity note:** the gold labels were LLM-drafted + human-approved. The LLM baseline
> (§4) must therefore be a **different** model, or its number is an optimistic ceiling.

---

## 3. Results

### 3.1 Set A — Option A vs. human gold (167 charges)

At the default threshold (0.50), against the human-corrected gold:

| Metric | Result |
|---|---|
| **Coverage** (auto-decided) | **87.4%** (146/167) |
| **Category accuracy** (auto) | **75.3%** |
| **Subcategory accuracy** (auto) | **50.7%** |

By tier (pre-correction detail; the 3 gold fixes add ~2 pts to category):

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

## 4. LLM baselines — 4 models on AWS Bedrock (us-east-2)

Same 167 gold charges, full v5 taxonomy in the prompt, constrained to pick from the list only,
`temperature 0`, scored identically to Option A. Reproduce: `BEDROCK_MODEL_ID=<id> npm run eval:llm`.

### The full model sweep (all vs. human-corrected gold)

| System | Category | Subcat | Cost / 1M† | Latency (avg) | Off-list cat |
|---|---:|---:|---:|---:|---:|
| **Option A** (self-hosted embedder+reranker) | 75.3% (dial → ~82%) | 50.7% | **~$0** | ~ms–300 ms | 0% |
| Qwen3-32B (`qwen.qwen3-32b-v1:0`) | 79.6% | 58.1% | ~$405 | 1,060 ms | 0% |
| gpt-oss-20b (`openai.gpt-oss-20b-1:0`) | 82.6% | 69.5% | ~$299 | 2,772 ms ⚠ | 4.8% ⚠ |
| gpt-oss-120b (`openai.gpt-oss-120b-1:0`) | 87.4% | 73.7% | ~$527 | 1,873 ms | 0% |
| **DeepSeek-V3** (`deepseek.v3-v1:0`) | **92.8%** | **74.3%** | ~$1,558 | 1,260 ms | 0% |

†Cost is input-dominated — the full taxonomy (~2,620 tokens) is re-sent every call. Prompt caching or
a shorter category list would cut all LLM costs ~10×. Per-token rates (in / out, per 1M): Qwen
$0.15/$0.62 · gpt-oss-20b $0.07/$0.30 · gpt-oss-120b $0.15/$0.60 · DeepSeek-V3 $0.58/$1.68.

### Reading the results
- **A stronger model genuinely helps** — accuracy climbs 75% → 93% across the ladder. (An earlier
  read that "it's all taxonomy, a bigger model won't help" was too strong; the sweep disproves it.)
- **But there is a hard ~93% ceiling.** DeepSeek-V3's remaining errors are almost entirely the
  **contestable-gold taxonomy boundaries** (`Bank Fraud` → Financial vs. gold's Fraud; gaming theft →
  Theft vs. gold's Financial). ~93% is about the max any model can score on this gold set — the rest
  is genuine taxonomy ambiguity, not model weakness.
- **gpt-oss-20b is a poor trade** — slowest of all (reasoning-heavy, p95 7 s) and invents categories
  4.8% of the time. It beats Qwen but is dominated by the 120b.
- **Open-weight matters.** gpt-oss and DeepSeek are open models, so the "LLM = data leaves + per-call
  fee" tradeoff need not apply — they can be self-hosted. gpt-oss-120b (120B) is far more practical to
  self-host than DeepSeek-V3 (671B MoE).

### Recommendation matrix

| Priority | Choice |
|---|---|
| Cheapest, local, fully auditable | **Option A** (~75–82%, dial-able) |
| Best accuracy-per-dollar | **gpt-oss-120b** (87% @ ~$527/M) |
| Max accuracy, hosted | **DeepSeek-V3** (93% @ ~$1,558/M) |
| Max accuracy, self-hosted | **gpt-oss-120b** (easiest open-weight to run) |

The question was never "is an LLM more accurate?" (yes, by 5–18 pts) but **"what precision does the
program need, at what cost, with what privacy/audit constraints?"** — and the sweep gives a defensible
answer for each of those priorities. Beyond ~93%, the only lever is **fixing the taxonomy**, not the model.

---

## 5. Fixes applied
- **Canonicalization (Tier 1):** `canonicalizeCode` now strips all separators, so `302.113` and
  `302-113` collapse to one key (dot↔hyphen match: 4.5% → 100%).
- **Inchoate demotion (Tier 3):** `Conspiracy / Attempt / Accessory / Aiding & Abetting` anchors
  are excluded from Tier 3 (they signal nothing alone) and defer to the AI tier. Result: Tier 3
  category accuracy 81.5% → **93.6%**; overall 70.5% → **73.3%** (75.3% post gold-correction).
- **Gold corrections (human audit):** 3 labels fixed in the theft/financial boundary.

---

## 6. Open items — for the KB team (the ~93% ceiling is taxonomy, not model)
1. **Theft / Financial / Fraud boundary.** `Theft of Property (tiered by value)` sits under Financial
   Crimes while retail/petty theft sits under Theft & Property — so generic "theft" is ambiguous, and
   **Theft & Property has no value-theft subcategory**. Both surfaced by the human audit; both cap
   *every* model. See `eval/taxonomy_punchlist.md`.
2. **Traffic family.** Moving Violations vs Impaired Driving vs Commercial Transportation — driving-
   while-suspended/revoked charges (`DWS`, `DUS`, `DWLS`) collide across all three.
3. **KB data quality (Set B).** Remove non-code entries (2.3%) from the alternate-citations column;
   review the ~1,000 ambiguous code keys (cross-cutting statutes like Attempt).
4. **Gold set** — expand beyond 168 for tighter per-category confidence; add a second labeler for
   inter-annotator agreement.

## Reproduce everything
```
npm run build:data                          # compile taxonomy + KB
npm run build:embeddings                    # precompute anchor embeddings (once)
npm run eval:statute                        # Set B: statute-code validation
npm run build:goldset                       # Set A sampler (blank labeling sheet)
npm run eval:score                          # score Option A vs. the labeled gold set
BEDROCK_MODEL_ID=<id> npm run eval:llm       # score an LLM baseline (needs AWS creds in .env)
npm run punchlist                           # taxonomy punch list (both systems joined)
```
