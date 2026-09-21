# algebraic-probe

An instrument for bounding the algebraic attack surface of **arithmetisation-oriented**
hash functions and permutations, with a secondary bit-oriented arm.

Its output is bounds, distributions and scope statements. It does not claim a
break and it does not claim impossibility. For a given technique applied to a
given function at a given round count, it reports what that technique can and
cannot establish, with the evidence attached — and, where the technique is blind,
a function class that exhibits the blindness.

**Nothing has been promoted.** That is the standing result, not a placeholder.
The run terminated on completion, as its brief required, rather than on success.

---

## What it actually measures, and what that is worth

Read this section before the rest. It is the part most likely to change your mind
about whether the apparatus is pointed at anything.

### Evidence actually produced, by tier

| Tier | Meaning | Results in the committed run logs |
|---|---|---:|
| **P** | deductive — a certified bound or a witnessed lower bound | **35** |
| **E** | exhausted — the whole input space consumed | **19** |
| **S** | sampled — ≥30 seeds, distribution reported | **0** |

Every number this instrument has emitted is deductive or exhaustive.

### The statistical layer is built, tested, and unexercised

`stats/` implements Benjamini–Hochberg with an asserted family size, exact
binomial (Clopper–Pearson) intervals, power analysis, and a Tobit censored
regression. All of it is tested and mutation-checked. **None of it has produced a
result.** BH appears outside its own tests in exactly one place —
`provenance/audit.py`, which *recomputes* a declared correction to check a run
against its pre-registration — and the censored regression appears nowhere
outside its tests.

This was raised in review and the review was right: pre-registered families and
step-up corrections are the machinery of a discipline running many noisy
experiments. A degree bound is deductive; a distinguisher either runs or it does
not. Tier P and Tier E results do not need any of it. The statistics earn their
keep only at Tier S, which is the weakest evidence class here — and which
**PREREG-M1 §9.1 closes above probe dimension 2** (D-010), because at 50 seeds
the smallest per-draw probability detectable at 80% power is 0.0317 while the
Schwartz–Zippel worst case at dimension *k* is 2^−*k*.

So the honest position on Tier S: **on the current pre-registration this
instrument has almost no sampled promotion path, and has used none of it.**
Reopening it needs 468,882 seeds at *k*=16 and 3.07×10¹⁰ at *k*=32. The
statistical layer is insurance against a failure mode that has not yet arisen and
may not. It is not load-bearing for anything reported below. Whether to keep
carrying it is **E-01**.

One measurement bears on that and is recorded rather than acted on: calibrated
against exactly-known degrees, the probe's real witness rate exceeds the
worst-case model by 2× to 2540×. That does **not** reopen D-010 — those rates come
from targets whose degree was already known, and promotion concerns a target
whose degree is not — but it does mean the seed counts above are probably enormous
overestimates. See D-037.

### What the enforcement guarantees, and what it does not

Tier labels are assigned by the code path that produced a result, via a
module-private mint token, and `tiers/` raises on cross-tier combination,
comparison and label reassignment.

**This is a discipline aid, not a guarantee.** In CPython, `object.__new__`
followed by `object.__setattr__` forges a fully-formed Tier P result that never
went near a derivation, and relabels a sampled result as proven. This is not
hypothetical — it is asserted, as a passing test, in
`tests/test_tiers_bypass.py`, so the limitation lives in the suite rather than
only in this paragraph. There is no way to close it from inside the process.

What the enforcement does stop is every route taken by accident or inattention:
direct construction, post-hoc assignment, label upgrade, cross-tier arithmetic.
That is what it is for, and the claim stops there (D-040).

### How this differs from artifact evaluation

IACR already runs artifact evaluation at FSE/ToSC and CHES: post-hoc,
badge-based, a reviewer inspecting a submitted artifact. The difference here is
**construction-time enforcement rather than review-time inspection** — the
calibration gate refuses to run an uncalibrated module, the runner refuses to
record a run whose pre-registration post-dates it, the log refuses an append
after its own terminator.

That is a real difference and it has to be argued, not asserted. The argument:
review-time inspection catches what a reviewer thinks to look for, and the
failure this repository is built against — a plausible number written where a
checked one belongs — is invisible to inspection because it looks exactly like a
checked number. Construction-time refusal makes it impossible to *produce*
rather than detectable after the fact. The counter-argument is the section above:
enforcement in Python is bounded by what `object.__setattr__` can undo.

---

## Findings

### 1. MiMC's degree growth is far slower than doubling — Tier E, in-repo

Exact algebraic degree of *r*-round MiMC over GF(2^*n*), exhaustive ANF over the
whole input space, *r* = 1…10:

| *n* | exact degree by round | naive doubling |
|---|---|---|
| 9 | 2, 2, 4, 4, 6, **8**, 8, 8, 8, 8 | 2, 4, **8**, 8, … |
| 11 | 2, 2, 4, 4, 6, 8, **10**, 10, 10, 10 | 2, 4, 8, **10**, … |
| 13 | 2, 2, 4, 4, 6, 8, 10, 10, **12**, 12 | 2, 4, 8, **12**, … |

Per-round increments never exceed 2 and average below 2 before the permutation
cap — bounded, where a doubling process is not. Doubling saturates at round 3–4;
the exact degree needs 6 to 9 rounds. **Doubling gives up 3, 3 and 5 rounds** at
*n* = 9, 11, 13.

The growth prefix is *identical across field size* until the cap bites.

Pinned in `tests/test_mimc_degree_growth.py`, computed twice by independent code
paths (`modules/degree/measure.py` and `verify/anf.py`). This is measured here
and reported as such: it is deliberately **not** stated as agreement with any
published result, because the relevant papers are unreachable from this
environment (E-04) and substituting a value I derived for a published anchor is
forbidden by the brief.

`mimc_derived_bound` implements a sound, tighter bound from the exponent support
— mean gap against exact truth **0.44** versus **1.33** for doubling.

### 2. The Keccak-f[25] bound is exactly tight for four rounds, then loose by 2

Exhaustive exact degree over all 2²⁵ inputs, via a bit-packed Möbius transform
(`verify/packed.py`, `verify/keccak_columns.py`), ~25 s:

| rounds | exact | Tier P bound | gap |
|---|---|---|---|
| 1–4 | 2, 4, 8, 16 | 2, 4, 8, 16 | **0** |
| 5 | **22** | 24 | **2** |
| 6 | 24 | 24 | 0 — saturated at width−1 |

All 25 output lanes carry the same degree at every round. The certified bound is
**sound at every round measured** — falsifiable, and untestable before this
arm existed, since the reference path guards at 24 variables.

### 3. The witness probe never fires above the exact degree

750 draws across 15 cells where a theorem says every derivative must vanish:
**0 witnesses.** First check of the Tier S machinery against ground truth
(`scripts/witness_calibration.py`).

### 4. The recorded null was incomplete — degree is blind to landscape geometry

Put to me from outside: a landscape can be locally indistinguishable from random
while globally organised, so "no local signal" may have been recorded as "no
structure". Acted on rather than deflected.

`scripts/landscape.py`, *n* = 14, six cluster counts from 1 to 1024, Tier E:

| statistic | hierarchical cells it separates |
|---|---|
| **algebraic degree** | **0 of 5** — profile (14,13) throughout |
| local minima | 5 of 5 — 32–47% below the i.i.d. prediction |
| overlap P(q) | 4 of 5 — blind at 1024 clusters |
| density of states | 1 of 5 — a finite-cluster artefact |

The prediction 2ⁿ/(*n*+1) is derived in-repo from exchangeability alone and
tested by enumerating *every* ordering of the energies at *n* = 1, 2, 3 and
asserting the mean as an exact rational.

**The answer is yes: the null was incomplete.** A fourth blindness class now
records it, which makes every negative this instrument emits *weaker*.

The general finding is the stronger one: **every statistic measured here has a
regime where it reports "no structure" about a landscape that has structure by
construction.** A landscape module would not remove blindness; it would move it.

### 5. Composition defeats a monotone bound

The iterated cube map over GF(2⁹) has an exact degree that *decreases* at rounds
4 and 6. A doubling bound is monotone and cannot reproduce a decrease. A
block-restricted map at *n* = 12 breaches a ceiling that is a theorem about the
target, reaching 11 against a true degree of 1.

The earlier gap = 0 controls were validating the *implementation*, not the
instrument.

### 6. Four blindness classes, each naming what the measure cannot see

| class | structure the degree measure misses |
|---|---|
| `inverse_map` | one quadratic relation *xy* = 1 — degree *n*−1, one inversion to solve |
| `saturated_power` | univariate tractability under Boolean saturation |
| `multiplicative_coset` | non-affine structure: a distinguisher on **7** inputs where the degree measure demands **2⁹** |
| `landscape_geometry` | hierarchical organisation of the search landscape |

Their union is the honest description of what remains unexamined.

---

## Scope: AO primary, bit-oriented secondary, ARX demoted

The original brief named "ARX and arithmetisation-oriented". That has been
narrowed, and the reason is visible in the target list:

| target | family | state |
|---|---|---|
| `mimc-gf2n` | arithmetisation-oriented | **measured**, gate-blocked on E-04 |
| `keccak-f[25]` | bit-oriented (AND/XOR/rotate) — *not* ARX | **measured**, gate-blocked on E-04 |
| `sha256-compression-parametrised` | ARX | **absent** (E-03) |
| linear / power / inverse / random | synthetic controls | measured, GO |

**Every ARX target in this repository is SHA-256, and it was never available.**
100% of what has been measured is AO, bit-oriented, or synthetic. The stated
scope and the delivered scope did not match; the README no longer claims ARX as
primary.

The positive reason, from review and consistent with finding 1: degree analysis
for ARX is mature and well-tooled — division property, monomial prediction. The
live, contested, repeatedly-revised degree claims are in AO land, which is where
graded evidence has purchase. Finding 1 is this instrument's own Tier E
measurement of exactly that phenomenon.

---

## The three tiers

Every result carries exactly one label, assigned by the code path that produced
it (`tiers.result.prove` / `enumerated` / `sampled`), never by hand.

- **P — PROVEN.** Deductive. Repetition adds nothing; `with_repetitions` raises.
- **E — EXHAUSTED-IN-SPACE.** Complete enumeration of a stated space. Every
  value prints the space, its cardinality and its fraction of the universe.
- **S — SAMPLED.** ≥30 independent seeds, 50 preferred; the distribution is the
  value, never a point.

Combining, averaging or comparing across tiers raises `TierViolation` — subject
to the bypass documented above.

---

## State

| Piece | State |
| --- | --- |
| `tiers/` — labels and integrity enforcement | implemented, tested, bypass documented |
| `stats/` — BH, power, Clopper–Pearson, censored regression | implemented, tested, **unexercised on real data** |
| `provenance/` — commit embedding, prereg hashing, hash chain, audit | implemented, tested |
| `harness/` — registry, regime router, calibration gate, promotion gate, sweeps | implemented, tested |
| `core/` — control targets, Keccak-f, MiMC, energy landscapes | implemented, validated |
| `core/sha256.py` — the ARX target | absent; raises `NotAuthorised` (E-03) |
| `verify/` — independent exhaustive paths: ANF, packed ANF, landscape | implemented, tested |
| `modules/degree/` — Module 1 | built, measuring; **PARTIAL** (11/11 module gates, 4/7 targets GO) |
| `modules/hod/` — Module 4 | built, calibration-blocked (E-05) |
| Modules 2, 3, 5, 6 | not started; blocked on E-03/E-05 |

### Verification at this commit

```
638 tests (fast lane), 0 failed
5 structural CI checks, 0 failed
104 mutants across 12 layers, 0 survivors
compliance audit: chains unbroken, deviations reported
```

---

## Running it

```bash
cd algebraic-probe
pytest -q -m "not slow"                  # 638 passed
python scripts/ci_checks.py              # checks=5 failed=0
python scripts/mutation_test.py          # mutants=104 survivors=0
python scripts/readiness_report.py       # per-target go/no-go
python scripts/execute.py                # run what the gates authorise
python scripts/exhaust.py                # exact degree over whole spaces, ~25s
python scripts/witness_calibration.py    # probe vs known truth, ~28s
python scripts/landscape.py              # what degree cannot see, ~1s
python -m modules.degree.calibration     # what Module 1 will assert
python modules/degree/prereg/derive_thresholds.py
python scripts/render_reports.py          # regenerate reports/out/
```

Full git history is required: the runner-precedes-prereg check is a claim about
git ancestry, so `fetch-depth: 0` is load-bearing in CI.

---

## What blocks progress

| # | Blocker | What it holds up |
|---|---|---|
| **E-03** | the ARX target is not vendored | gate T01 everywhere; M2 entirely; M3/M5/M6 calibration. An *authorisation*, not a missing input — FIPS 180-4 specifies SHA-256 and `hashlib` validates it bit-exactly |
| **E-04** | two ground-truth citations unreachable (egress) | M1 on `keccak-f[25]` and `mimc-gf2n` |
| **E-05** | no published anchor exists for M2/M4/M6 | those modules ship calibration-blocked |
| **E-01** | the Tier S closure is unconfirmed | whether the statistical layer has any purpose |
| **E-09** | may exhaustive in-repo truth substitute for a published anchor? | recommendation: no, in the general form |
| **E-11** | the enlarged blindness statement | accept it, or commission a landscape module |

Eleven items, with the arithmetic for each, are in `ESCALATIONS.md`. Every
judgement call is in `DECISIONS.md` (40 entries), including the ones where a
measurement refuted something I had written.

---

## Layout

```
core/         parametrised primitives, control targets, energy landscapes
tiers/        tier label types and the integrity enforcement
modules/      one subpackage per module, each with prereg/, calibration/, blindness/
verify/       independent verification paths; imports nothing from modules/
              and is imported by nothing in modules/ (enforced in CI)
harness/      run orchestration, seeding, censoring, resumable SQLite sweeps
stats/        BH, Clopper-Pearson, censored regression, power analysis
provenance/   commit embedding, hash chaining, audit
reports/      lint plus generated output in reports/out/ (no prose, enforced)
runs/         committed run logs, append-only and hash-chained
checkpoints/  per-stage findings, A through H
REPORT.md     the single operator-facing report; contains judgement
DECISIONS.md  every judgement call, with reasoning
ESCALATIONS.md  what waits on the operator, and what each item blocks
```
