# RAG Classification — Retrieve, then Let the Model Pick

_Last updated: 2026-07-17. Companion to `EVALUATION.md`._

A retrieve-then-decide design for the AI tier: the embedder retrieves the top-K candidate
classifications from the knowledge base, and an LLM chooses among **only those candidates**.
Measured on the same 167-charge human-verified gold set as everything else.

---

## 1. Why this design

Three measured facts pointed straight at it:

| Observation | Number |
|---|---|
| The correct category **is retrieved** in the top-10 | **92.2%** |
| The cross-encoder reranker **converts that into a pick** | 78.2% |
| → the gap the reranker leaves on the table | **~14 pts** |

The retrieval step has good recall; the *picking* step was the weak link. A cross-encoder only
measures text similarity — it has no world knowledge, so it can't tell that `DWS` means
"driving while suspended". An LLM can. So: **keep the retrieval, replace the picker.**

Sending only the retrieved candidates (instead of the full 32-category / 351-subcategory taxonomy)
also cuts input tokens ~7×, which is where nearly all LLM cost lives.

---

## 2. The retrieval ceiling (measured first)

Before building anything we measured whether the right answer is even retrievable. If it isn't in
the shortlist, no downstream model can recover it — this is a hard ceiling.

`npm run eval:recall`

| K | Category in top-K | Subcategory in top-K |
|---:|---:|---:|
| 1 | 70.1% | 48.5% |
| 5 | 89.2% | 79.4% |
| 8 | 91.6% | 84.8% |
| **10** | **92.2%** | **86.7%** |
| 20 | 95.2% | 89.1% |

On just the charges the deterministic tiers defer (what RAG actually handles): **89.1% @ K=10**.

**K=10 chosen:** 8→10 adds ~1 pt; 10→20 adds ~3 pts but doubles the model's input and decision space.

**4.8% is never retrieved at any K** — and **6 of those 8 charges are traffic**
(`DWS-C FEL-COMMIT FEL`, `IMPROP SUNSCREENING`, `IMPROPER PASSING-OPP DIR`, `DUS-FRA SUSP-NON PAYMENT`,
`WINTER REC AREA PARK VIOL`, `CARRY/DISPLAY LICENSE/PERMIT`). That is a **data gap, not a model gap** —
our anchors come from 4 states whose KBs are thin on traffic. More state KBs raise this ceiling for free.

---

## 3. How it works

```
charge → deterministic tiers (Layer 0 → statute → exact → keyword)   [free, 95.8% precise]
             │ deferred
             ▼
     embedder retrieves top-10 anchors (KB descriptions + v5 phrases)
             │ deduped to distinct (category, subcategory) options
             ▼
     LLM picks ONE by number  →  {"choice": N}   ·   {"choice": 0} = none fit → human
             ▼
     category + subcategory from the chosen KB entry
```

Two properties fall out of the design:
- **It cannot invent a category.** The model returns an index into the retrieved list, so every
  answer is structurally grounded in a real KB entry.
- **It abstains.** `choice: 0` means "none of these fit" → routed to a human (6 charges did this).

Auditability: each decision traces to *the 10 retrieved KB entries + which one was chosen*, rather
than an opaque generation.

---

## 4. Results

Deterministic tiers run first and handle 48 of 167 charges at **95.8%**; RAG handles the 119 they defer.

### 4.1 The inchoate fix

The first run mis-classified conspiracy charges (`CONSPIRACY TO DISTRIBUTE MARIJUANA` →
*Obstruction*) because inchoate anchors sit in the retrieval index and were being picked. Adding one
rule to the prompt — *"classify a conspiracy/attempt by the UNDERLYING offense"* — fixed it:

| | Before | After |
|---|---:|---:|
| Category | 87.6% | **89.4%** |
| Subcategory | 75.5% | **78.6%** |

### 4.2 Two pickers, same retrieval

| Picker | Category | Subcat | Coverage | Cost/1M | Latency | Out tok/call |
|---|---:|---:|---:|---:|---:|---:|
| **gpt-oss-120b** | 89.4% | **78.6%** | 96.4% | **~$119** | 1,908 ms | 174 |
| **DeepSeek-V3** | **90.0%** | 76.6% | 95.8% | ~$158 | **1,326 ms** | 7 |

Essentially tied. gpt-oss wins subcategory and cost; DeepSeek wins category by 0.6 pt and is faster
(it answers without verbose reasoning — 7 output tokens vs 174).

**Input tokens: ~360–420/call vs 2,636 for full-taxonomy — a ~7× reduction**, which is where the
cost saving comes from.

---

## 5. Against everything else measured

| System | Category | Subcat | Coverage | Cost/1M | Abstains |
|---|---:|---:|---:|---:|---|
| Option A (bge-large + reranker-large) | 84.7% | 57.6% | 86.2% | ~$0 | ✅ |
| Option A @ 0.95 dial | 88.0% | — | 79.6% | ~$0 | ✅ |
| gpt-oss-120b (full taxonomy) | 87.4% | 73.7% | 100% | ~$527 | ❌ |
| DeepSeek-V3 (full taxonomy) | **92.8%** | 74.3% | 100% | ~$1,558 | ❌ |
| **RAG: top-10 → gpt-oss-120b** | 89.4% | **78.6%** | 96.4% | **~$119** | ✅ |
| **RAG: top-10 → DeepSeek-V3** | 90.0% | 76.6% | 95.8% | ~$158 | ✅ |

### The key structural finding

**DeepSeek scores *lower* as a RAG picker (90.0%) than with the full taxonomy (92.8%).** That is not a
flaw in the prompt — it is the ceiling doing its job:

- **RAG is capped by retrieval recall** (89.1% on the deferred subset). A strong model cannot pick an
  answer that was never retrieved.
- **Full-taxonomy is capped only by the model**, so a very strong model can reach higher — at ~10× the
  token cost ($1,558 vs $158/M).

So the trade is explicit: **2.8 points of category accuracy costs 10× more.** And critically, **RAG's
cap is raised by data, not spend** — every state KB added improves retrieval and lifts the ceiling,
whereas full-taxonomy accuracy only improves by buying a bigger model.

---

## 6. Error analysis — what's still wrong

1. ~~Inchoate anchors leak into retrieval~~ — **fixed** (§4.1).
2. **Traffic remains the dominant residual** — `DWS-DWR`, `DUS STATE VIOLATION`, `DWLS`. Mostly the
   4.8% never-retrieved set. **Fix is data:** more state KBs with real traffic offense descriptions.
3. **Taxonomy-ambiguous cases persist** — `GRAND THEFT` → Financial Crimes vs gold's Theft & Property.
   Unfixable by any model; needs the taxonomy decision (see `EVALUATION.md` §6).
4. **Multi-offense strings** — `ASSLT PEACE OFF, POSSESS DRUGS, ETC` picks one of the two real
   offences. Arguably needs a multi-label answer rather than a single pick.

---

## 7. Recommendation

**Adopt RAG as the AI tier, with gpt-oss-120b as the picker.**

| Why | |
|---|---|
| Accuracy | 89.4% category, **78.6% subcategory — the best measured**, +21 pts over Option A |
| Cost | **~$119/M charges** before caching — 13× cheaper than full-taxonomy DeepSeek |
| Privacy | gpt-oss-120b is **open-weight → self-hostable**; marginal cost becomes compute-only |
| Safety | **abstains** (`choice: 0`) and **cannot invent a category** (returns an index) |
| Auditability | every answer traces to the 10 retrieved KB entries + which was chosen |
| Scaling | improves as state KBs grow — **data, not spend** |

Choose **DeepSeek-V3 as picker** instead only if the +0.6 pt category and lower latency justify +33% cost.
Choose **full-taxonomy DeepSeek** only if the last 2.8 points are worth 10× and you accept no abstention.

### Next steps, highest leverage first
1. **Add state KBs, traffic first** — directly attacks the 4.8% never-retrieved and the top error class,
   and raises the RAG ceiling for free.
2. **Add the result cache** (Redis, version-keyed) so each distinct charge is paid for once, ever.
3. **Resolve the taxonomy ambiguities** — the only lever past ~93% for any approach.
4. **Consider multi-label output** for multi-offense charge strings.
5. **Self-host gpt-oss-120b** to remove per-call cost and keep data in-house.

## Reproduce
```
npm run eval:recall                                        # retrieval ceiling (no LLM cost)
BEDROCK_MODEL_ID=<id> RAG_TOPK=10 npm run eval:rag          # RAG accuracy + tokens + cost
```
