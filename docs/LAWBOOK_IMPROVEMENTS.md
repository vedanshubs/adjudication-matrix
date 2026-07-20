# Law Book / Taxonomy — Recommended Improvements

_Prepared 2026-07-17. Everything here comes from real testing: we ran the law books through an
automated charge-classification system and measured what went wrong, using 167 charges that a human
checked by hand. Source data: WI · AR · TN · IL law books (2,517 offences, 42,511 citation spellings)._

## Why we're asking for these changes

We tested **five different classification approaches** — from a small in-house model up to a large AI
model. They all got stuck at roughly the **same accuracy**, and they all got the **same charges
wrong**.

That's the important clue. When five very different systems make the *same* mistake, the problem
usually isn't the software — **it's that the source data or the category list is ambiguous**, so
there's no single right answer to find.

Below are the specific spots where that happens. Each one is a place where **fixing the books helps
every approach at once** — and no amount of better technology can substitute for it.

**A note on tone:** the books are detailed and well built, and the category standardisation work on
WI/AR/TN/IL is clearly solid. These are the narrow edges where *automated* classification runs into
trouble, which is a stricter bar than human reference use.

### Summary

| # | What's wrong                                                     | How much it hurts | How hard to fix        |
| - | ---------------------------------------------------------------- | ----------------- | ---------------------- |
| 1 | Subcategory names don't match the official list (14% of rows)    | **High**    | Medium                 |
| 2 | "Theft" is spread across 6 different categories                  | **High**    | Low — just a decision |
| 3 | Drug-related DUI sits in a second category, splitting DUI in two | **High**    | Low — just a decision |
| 4 | Traffic offences are thinly covered                              | **High**    | Medium                 |
| 5 | No place to record abbreviations (`DWS`, `TBUT`…)           | **High**    | Medium                 |
| 6 | Offence names written into the statute-code column (962 entries) | Medium            | Low                    |
| 7 | 6% of statute codes point to more than one category              | Medium            | Low — just a flag     |
| 8 | California hasn't been standardised (80% of its rows)            | **High**    | High                   |

---

## 1. Subcategory names in the law books don't match the official v5 list

**In one sentence:** the **category** names were standardised across all four states ✅, but the
**subcategory** names never were — so 14% of rows use a subcategory name the official list
(`Criminal_Category_Mapping_v5.xlsx` → "Category Mapping" sheet) doesn't recognise.

### The clearest example — three names for one offence

| Name used in the books                 | Which states | Is it in v5? |
| -------------------------------------- | ------------ | ------------ |
| `Possession`                         | AR, IL       | ❌ no        |
| `Drug Possession`                    | TN           | ❌ no        |
| `Possession of Controlled Substance` | TN, IL       | ✅ yes       |

The same offence is filed under three different names — and **TN and IL each use both a correct and
an incorrect one**, so it's inconsistent between states *and* within a single state's own book.

### Where the problem actually is

| State        | Rows using a name not in v5 |                                |
| ------------ | --------------------------- | ------------------------------ |
| **WI** | 131 / 349                   | **37.5%** ← worst       |
| **AR** | 87 / 234                    | **37.2%** ← worst       |
| TN           | 113 / 830                   | 13.6%                          |
| **IL** | 25 / 1,104                  | **2.3%** ✅ nearly clean |

**IL is the model to copy** — whoever prepared it did the subcategory work properly. WI and AR need
the most attention.

Also worth knowing: of the 138 distinct non-v5 names, **115 (83%) are used by only one state** — each
book drifted its own way, so there's no single find-and-replace that fixes everything.

### The three kinds of mismatch

**🟢 Just wording — a straight rename (the majority):**

| Book says                                   | v5 says                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| `Animal Cruelty`                          | `Animal Cruelty / Abuse`                                              |
| `Active Pre-Trial Booking Arrest Records` | `Active Pre-Trial Booking **/** Arrest Records` *(a missing slash)* |
| `Drug Manufacturing / Sale`               | `Drug Manufacturing / Production`                                     |
| `Pardon / Restoration`                    | `Pardon / Executive Clemency`                                         |

**🟡 The book is broader than v5 — someone must choose:**

| Book says                       | v5 splits it into                                                   |
| ------------------------------- | ------------------------------------------------------------------- |
| `Environmental Crimes`        | `— Air / Water` **and** `— Waste / Hazardous Materials` |
| `Parole / Release Mechanisms` | `Parole` **and** `Parole Revocation`                      |

**🔴 Genuinely mis-filed — needs a real fix:**

- `Other Public Health & Welfare` — a catch-all bucket that doesn't exist in v5
- Category **Public Order & Conduct** with subcategory **`Theft`** — theft isn't a Public Order
  subcategory at all

### Why it matters

**Because it fails silently.** Suppose a client rule says:

> *"Flag at 2 convictions of **Possession of Controlled Substance**"*

The rule looks for that exact name. The law book row says just **`Possession`**. They don't match, so
**the charge is never counted — and nothing reports an error.** The rule quietly misses it. The same
applies to any report, count, or per-subcategory threshold.

### Recommendation

Do for **subcategories** what was already done for categories: align each book's subcategory names to
the official v5 list (or, where a state name is genuinely needed, add it to v5 as an official entry).

Start with **WI and AR** (~37% each), use **IL as the reference**. Most of it is simple renaming —
only the 🟡 and 🔴 cases need a decision.

---

## 2. "Theft" is spread across six different categories

**In one sentence:** there's no single home for theft, so plain theft charges have nowhere obvious
to go — and two categories contain the same offence.

Theft-type subcategories currently sit in **six** categories:

| Category                          | Theft-type subcategories it contains                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Theft & Property Crimes** | Auto Theft · Petty / Retail Theft · Mail Theft · Theft of Services · Scrap Metal Theft          |
| **Financial Crimes**        | Embezzlement ·**Theft of Property (tiered by value)** · Receiving / Dealing Stolen Property |
| **Public Order & Conduct**  | **Receiving Stolen Property** ← same offence as the one above                                |
| Fraud & Forgery                   | Identity Theft                                                                                      |
| Telecommunications                | Utility Theft                                                                                       |
| Labor                             | Wage Theft                                                                                          |

**Two specific problems:**

1. **Plain theft has no home in the theft category.** General, value-based theft
   (`Theft of Property (tiered by value)`) is filed under **Financial Crimes**, and
   **Theft & Property Crimes has no general theft subcategory at all.** So a charge like
   *"GRAND THEFT"* or *"THEFT OVER $500"* has nowhere natural to go in the category named after theft.
2. **The same offence exists twice.** `Receiving Stolen Property` (Public Order) and
   `Receiving / Dealing Stolen Property` (Financial Crimes) are the same thing in two places.

**How we know this is a real problem:** when a reviewer checked the 20 hardest charges by hand,
**2 of the 3 confirmed labelling errors came from exactly this** — *"GRAND THEFT"* and
*"THEFT, RSP, CRIM DAMAG"* were both filed under Financial Crimes when they should have been Theft &
Property. Two separate AI systems independently said Theft & Property too. When the software *and*
the human reviewer disagree with the label, the category list is what needs fixing.

**What we'd suggest:**

- Add a **general theft subcategory under Theft & Property Crimes** and move
  `Theft of Property (tiered by value)` there.
- Keep **Financial Crimes** for money-instrument offences (embezzlement, bank fraud, money laundering),
  not plain theft.
- Delete one of the two `Receiving Stolen Property` entries.

---

## 3. Drug-related DUI sits in a second category, splitting DUI in two

**In one sentence:** DUI charges can land in two different categories depending on whether drugs are
mentioned, so drink-driving and drug-driving get separated.

Right now:

- **Impaired Driving** contains 9 DUI subcategories (DUI/DWI general, 1st/2nd/4th offence, commercial
  DUI, boating under the influence…)
- **Drug Offenses** contains one more: **`DUI — Drug Related`**

**Why that causes errors:** a charge like *"DUI DRUGS OR METABOLITE"* matches the Drug Offenses entry
almost word-for-word, so classifiers file it under **Drug Offenses** instead of **Impaired Driving**.
We saw this happen **three separate times, with three different systems**.

**How we know which is right:** **all 14 DUI charges** in the human-checked set were labelled
**Impaired Driving** — not one was labelled Drug Offenses. So the working convention is clear; the
category list just contradicts it.

**What we'd suggest:** **remove `DUI — Drug Related` from Drug Offenses.** Impaired driving is
impaired driving whatever the substance was. If the substance matters for reporting, record it as a
detail on the charge rather than as a different category. Otherwise DUI charges will keep splitting
between two categories forever.

---

## 4. Traffic offences are thinly covered

**In one sentence:** many everyday traffic charges simply aren't described in the books, so nothing
can match them.

Of the charges where the system **could not find the right category anywhere in the books**,
**6 out of 8 were traffic**:

```
DWS-C FEL-COMMIT FEL · CARRY/DISPLAY LICENSE/PERMIT · WINTER REC AREA PARK VIOL
IMPROP SUNSCREENING  · IMPROPER PASSING-OPP DIR    · DUS-FRA SUSP-NON PAYMENT
```

**Why it matters:** traffic is one of the highest-volume charge types we see in real data (~31% of our
sample) and it's the single biggest source of errors for every approach we tested. If an offence
isn't written down in the books, no software can classify it — this one is purely a coverage gap.

**What we'd suggest:** prioritise **traffic offences** when expanding the books — driving while
suspended or revoked, licence and registration violations, equipment violations (window tint,
lighting), parking, and moving violations.

---

## 5. There's nowhere to record abbreviations

**In one sentence:** real charges arrive heavily abbreviated, but the books only contain the full
official wording — so there's nothing for the short forms to match against.

Examples that matched nothing:

| Charge as it actually arrives | What it means                                            |
| ----------------------------- | -------------------------------------------------------- |
| `DWS-DWR`                   | Driving While Suspended / Revoked                        |
| `DUS-FRA SUSP-NON PAYMENT`  | Driving Under Suspension — Financial Responsibility Act |
| `TBUT`                      | Theft By Unlawful Taking                                 |
| `MANU-DEL CNTRLD SUB-SC 2`  | Manufacture/Deliver Controlled Substance, Schedule 2     |

`DWS-DWR` is seven letters with no actual words in it. The system's best match was
*"DWD Administrative Stop-Work Order"* — chosen purely because the **letters look similar**. There was
nothing better to match against.

**Why it matters:** this is the single biggest cause of failed matches, and it's **fixable with data,
not technology**. Your own earlier work already proved it — adding mined abbreviations lifted matching
from roughly one-third to two-thirds of charges.

**What we'd suggest:** add an **"Aliases / Abbreviations"** column next to `Alternate Citations`,
holding the short forms actually seen in incoming data. **This is the highest-value, lowest-risk item
on this list.**

---

## 6. Offence names written into the statute-code column

**In one sentence:** the `Alternate Citations` column is meant to hold statute codes, but ~1,000
entries are offence names instead.

**962 entries (2.3%)** in the citation columns aren't codes at all:

```
"Second-Degree Murder" · "Voluntary Manslaughter" · "Homicide by Reckless Driving"
"Earned Release" · "ERP / Challenge Placement"
```

**Why it matters:** that column is read as a list of statute codes. Offence names sitting in it clutter
the lookup with entries that can never match a real citation.

**What we'd suggest:** move the descriptive text into a description or alias field, and keep
`Alternate Citations` for statute references only.

---

## 7. Some statute codes point to more than one category

**In one sentence:** a few statutes (like "Attempt") apply to many different crimes, so looking up the
code alone can give the wrong answer.

Of 16,954 distinct state + code combinations, **854 (6%)** point to more than one category. The
clearest example: **Wisconsin § 939.32 ("Attempt") maps to 9 different categories** — Homicide,
Assault, Sexual Offenses, Fraud, Financial Crimes and more.

**Why it matters:** this is perfectly correct in law — "attempt" genuinely applies across all crime
types. The risk is that software looking up that code takes the *first* match and is **confidently
wrong**. It needs to know the code is ambiguous.

**What we'd suggest:** add a simple flag (e.g. **`Cross-Cutting = Y`**) on these statutes, so a lookup
knows the code alone isn't enough and the offence description must be used too. *(We can supply the
full list of 854.)*

---

## 8. California hasn't been standardised

**In one sentence:** the California file still uses its old category names, so it can't be used yet.

`CA_Statutes_Complete.csv` has 3,011 rows using **143 different category labels** — but only **9** are
real v5 categories. **2,419 rows (80%) use the old naming** (`Fraud / White-Collar`,
`Public Trust Fraud`, `Weapons Offenses`, `Cybercrime`, `Transportation`…). The `Group_Category`
column has the same issue.

**Why it matters:** California is one of the highest-volume states and is currently unusable.

**What we'd suggest:** run California through the same standardisation already done for WI/AR/TN/IL.
*(We can supply the full list of 134 non-matching labels with row counts.)*

---

## Suggested order of work

1. **Add the abbreviations column** (#5) — biggest gain for the effort; helps everything.
2. **Decide on theft and DUI placement** (#2, #3) — quick decisions that each remove a whole class of errors.
3. **Align the subcategory names** (#1) — start with WI and AR; IL is the model.
4. **Traffic coverage and California** (#4, #8) — the two biggest coverage gaps.
5. **Tidy the citation column and flag the cross-cutting codes** (#6, #7).

## What we can provide

Happy to supply any of these as spreadsheets to make the work concrete:

- the **356 rows** whose subcategory name doesn't match, with the suggested v5 equivalent
- the **854 statute codes** that point to multiple categories
- the **134 California labels** that need mapping, with row counts
