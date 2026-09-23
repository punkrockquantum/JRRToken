# algebraic-probe

An instrument for bounding the algebraic attack surface of hash functions and
permutations: **SHA-256** (ARX), **Keccak-f** (bit-oriented) and
**arithmetisation-oriented** designs.

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
| **P** | deductive — a certified bound or a witnessed lower bound | **82** |
| **E** | exhausted — the whole input space consumed | **38** |
| **S** | sampled — ≥30 seeds, distribution reported | **0** |

Every number this instrument has emitted **into a run log** is deductive or
exhaustive. Module 3 declares a Tier S path and exercises it in the suite, but no
Tier S result has been through the provenance runner, so the third row is still
zero and is not rounded up.

### The statistical layer is built, tested, and load-bearing in exactly one place

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

**What changed with Module 3.** M3 is the first module whose declared tiers
include S, and building it turned up the one thing the criticism above could not:
the Tier S rule was *untested*. A sampled cell claims elevation above the random
level via `ci_low > random_level`. Substituting the **point estimate** survived
every test in the repository, because every sampled cell here sat at 0 hits or at
50, where point and interval bound fall on the same side of the random level.

Rather than weaken the mutant, the missing cell was measured:

```
RandomFunction.create(12, 6, 1), din=1, dout=10
hits 1/50   rate 0.02   random level 2^-6 = 0.015625   ci_low 0.000506228
point estimate clears the random level = True
interval clears it                    = False
```

Fifty draws cannot separate one hit from chance at a 6-bit output width. The
straddling cell is now a test and `DIFF-04` enforces it (D-051). This is the
narrowest possible answer to the criticism and is stated as such: the interval
discipline is load-bearing in one place and checked there. Nothing here validates
BH, the power analysis or the censored regression, which remain unexercised.

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

### 1. SHA-256: the naive ARX bound is vacuous; support-capping fixes it

The primary target, measured for the first time (E-03 authorised 2026-09-22).
SHA-256's non-linearity is modular addition, and a degree bound that tracks only
a number per bit lets the carry rule *multiply* it: traced through
`core.sha256.compress` the propagated value is **4,526** after one round,
**2.5×10⁸** after two, **1.6×10¹³** after three. Only the free-variable ceiling
keeps it finite, so the bound is 512 at every round count — sound, and useless.

Tracking each bit's variable *support* alongside its degree and capping at
`popcount(support)` after every operation restores the elementary fact that a
function of *k* variables has degree at most *k*:

| rounds | 1 | 2 | 3 | 4 | 8 | 12 | 16 | 17+ |
|---|---|---|---|---|---|---|---|---|
| naive | 512 | 512 | 512 | 512 | 512 | 512 | 512 | 512 |
| **support-capped** | **31** | **63** | **95** | **127** | **255** | **383** | **511** | 512 |

Exactly **32r − 1** through round 16 — one message word per round, with the top
bit's degree coming from a carry spanning all but one of the variables below it.
Improvement up to **481 bits**. Both bounds are recorded in the run log, as
`d_ub` and `d_ub_derived`.

**Lower bounds, two independent ways.** A restriction's degree never exceeds the
function's, so exhausting a *k*-bit window of W[0] proves a lower bound on the
unrestricted target. In 18 of 18 cells — three window widths × six round counts
from 1 to 64 — the exact degree **saturates at the window width**, and soundness
holds in every cell. Independently, a witnessed derivative on the full 512-bit
input fires on the first seed at *k* = 8, 12 and 16 at every round count. Proven
lower bound: **16**.

```
rounds=1     16 <= deg <= 31
rounds=4     16 <= deg <= 127
rounds=64    16 <= deg <= 512
```

**One round is enough to saturate.** The reading — a statement about the
technique, not a claim about SHA-256 — is that degree-based higher-order
differentials need a derivative order this bound puts out of reach, and the
degree is already full in any feasibly-exhaustible subspace after a single round.
This instrument's degree arm has no purchase on SHA-256 beyond round 1.

**Not established:** the round-dependence of 32r − 1 is Tier P only. A restricted
target saturates at its own free-variable count, so the restriction ceiling bites
before the round count does; checking it exhaustively needs a window wider than
32 bits, ≥ 4.3×10⁹ evaluations. See `checkpoints/I-sha256.md`.

### 2. MiMC's degree growth is far slower than doubling — Tier E, in-repo

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

### 3. The Keccak-f[25] bound is exactly tight for four rounds, then loose by 2

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

### 4. The witness probe never fires above the exact degree

750 draws across 15 cells where a theorem says every derivative must vanish:
**0 witnesses.** First check of the Tier S machinery against ground truth
(`scripts/witness_calibration.py`).

### 5. The recorded null was incomplete — degree is blind to landscape geometry

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

### 6. Composition defeats a monotone bound

The iterated cube map over GF(2⁹) has an exact degree that *decreases* at rounds
4 and 6. A doubling bound is monotone and cannot reproduce a decrease. A
block-restricted map at *n* = 12 breaches a ceiling that is a theorem about the
target, reaching 11 against a true degree of 1.

The earlier gap = 0 controls were validating the *implementation*, not the
instrument.

### 7. SHA-256's dependency graph: two completeness rounds, five apart — Tier P

Module 2, buildable only once E-03 resolved. Reachability and degrees of freedom,
both deductive.

| quantity | value |
|---|---|
| union of reachable bits complete at round | **16** |
| every output bit reaches every input bit at round | **21** |
| free message bits | 512, saturating at round 16 |
| last directly settable round | 15 |

Round 16 consumes the last block word, so the union going complete there is
expected. That *every output bit individually* takes five more rounds is the
finding: rounds 16–20 are the only regime where a dependency-based distinguisher
could live.

**A pre-registered prediction of mine was refuted.** PREREG-M2 H2 predicted that
bit-level propagation would be strictly tighter than the word-level closure
somewhere. It never is — `word_level_overstatement` is 0 at every round count.
Modular addition's carry chain unions every operand bit at or below each
position, so every bit of a consumed word becomes reachable anyway. That is a
fact about ARX mixing, not about the implementation. The test asserts the
refutation rather than being deleted.

**Reachability is not dependence, and the module never says it is.**
`CancellingXor` — `f(x) = (A x) XOR (B x)` with A and B sharing rows — is fully
reachable with output bits that are *identically zero*, verified exhaustively.

### 8. x³ over GF(2ⁿ) is APN with exactly half its table impossible — Tier E

Computed, not cited. `differential_uniformity` returning exactly 2 *is* the
definition of almost perfect nonlinear.

| n | max differential count | probability | random level | table exactly impossible |
|---|---:|---|---|---:|
| 7 | 2 | 2^-6 | 2^-7 | **50.0%** |
| 9 | 2 | 2^-8 | 2^-9 | **50.0%** |
| 11 | 2 | 2^-10 | 2^-11 | **50.0%** |

The best differential clears the random level by **one bit** — the smallest
elevation an even-counted table can show — while half of every row is
unreachable. The derivative of a quadratic power map is affine, so its image is a
coset of an index-two subspace: two-to-one onto half the space, zero on the rest.
Uniformity and impossibility are the same fact from opposite sides, and a search
thresholded on "above random" sees only one of them. This is M3's blindness
class, and it is the sharpest one in the repository because the numbers are exact
rather than approximate.

### 9. Two modules reach round 16 by paths that share no code — Tier P and Tier S

Sampling differentials forward on SHA-256, a flipped W[15] bit stops being
invisible at round **16**. Module 2 reaches 16 structurally, by closing the
schedule recurrence over word indices without evaluating SHA-256 at all.

Scope, stated rather than left to be inferred: this is a cross-check on both
modules' reading of the message schedule, and a disagreement would have meant one
of them was wrong about it. Neither computation examines the round function, so
it is not evidence about that, and it says nothing about any differential above
round 16.

The result arrived through a failing test whose expectation was wrong — the first
draft flipped block bit 0, which lies in W[15] and which a 4-round compression
never reads, so the zero output difference held 50/50 (D-050).

### 10. SHA-256 stops offering a word-level split at round 24 — Tier E

Cut the round sequence; a block word one chunk consumes and the other does not is
*neutral* for that chunk. A cut with neutral words on **both** sides is what lets
the two halves be enumerated separately and met in the middle.

| rounds | independent cuts | matching freedom |
|---:|---:|---:|
| 16 | 15 | 256 bits |
| 20 | 10 | 128 |
| 23 | 7 | 32 |
| 24 | **0** | **0** |

Matching freedom falls by **exactly one 32-bit word per round** from 16 and
reaches zero at 24; the last round count with a word-level split is **23**. The
closed form is what the test asserts, not the table.

This continues finding 7 rather than repeating it: round 16 is where the block is
fully consumed, and from there the schedule ties the two halves together one word
at a time until no split survives.

`verify/mitm.py` checks it by evaluating the real `message_schedule` and flipping
bits, and the two paths **agree exactly** at every word below 24 — consumption is
an upper bound in principle and tight in fact here.

**Scope:** a split is necessary for a meet-in-the-middle attack and nowhere near
sufficient. Nothing models matching, memory, partial matching or bicliques.
PREREG-M5 registers that 256 bits of balanced freedom sits *above* the 63.1-bit
feasibility ceiling, so this is reported as structure and never as an attack.

### 11. Seven blindness classes, each naming what the measure cannot see

| class | structure the measure misses |
|---|---|
| `inverse_map` | one quadratic relation *xy* = 1 — degree *n*−1, one inversion to solve |
| `saturated_power` | univariate tractability under Boolean saturation |
| `multiplicative_coset` | non-affine structure: a distinguisher on **7** inputs where the degree measure demands **2⁹** |
| `landscape_geometry` | hierarchical organisation of the search landscape |
| `cancellation` (M2) | terms that cancel: full reachability with constant outputs |
| `impossible` (M3) | the low side of a one-sided threshold: **50%** of an APN table is exactly impossible |
| `cancellation` (M5) | a split hidden by a cancelling term: wiring finds **0** cuts where truth finds **3** |

Their union is the honest description of what remains unexamined.

Two candidate classes for M3 were tried and **abandoned because they were not
true**, and are recorded as dead ends rather than near misses: modular addition
is not XOR-differentially flat (measured median maximum ≈ 2^-3.4 against a random
level of 2^-10), and a product-rule/composition deviation search found the
deviation to be **exactly 0**. A blindness class has to *have* the structure
being searched for, and `structure_predicate` enforces that in code.

---

## Scope

| target | family | state |
|---|---|---|
| `sha256-compression-parametrised` | ARX | **measured, GO** — E-03 authorised 2026-09-22 |
| `mimc-gf2n` | arithmetisation-oriented | measured, gate-blocked on E-04 |
| `keccak-f[25]` | bit-oriented (AND/XOR/rotate) — *not* ARX | measured, gate-blocked on E-04 |
| linear / power / inverse / random | synthetic controls | measured, GO |

**5 of 7 targets are GO, including the primary one.** Until E-03 was authorised,
every ARX target in this repository was SHA-256 and it had never been available,
so the README had demoted ARX. It is back, and it is now the only target with all
three arms — Tier P bound, Tier E lower bound, Tier P witness — reported.

A note kept from review, because it still holds: degree analysis for ARX is
mature and well-tooled (division property, monomial prediction), while the live,
repeatedly-revised degree claims are in AO land. Findings 1 and 7 below are this
instrument's own measurements of both sides.

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
| `stats/` — BH, power, Clopper–Pearson, censored regression | implemented, tested; Clopper–Pearson **load-bearing for M3's Tier S path**, the rest unexercised |
| `provenance/` — commit embedding, prereg hashing, hash chain, audit | implemented, tested |
| `harness/` — registry, regime router, calibration gate, promotion gate, sweeps | implemented, tested |
| `core/` — control targets, Keccak-f, MiMC, energy landscapes | implemented, validated |
| `core/sha256.py` — the ARX target | **implemented, validated, measuring**; bit-identical to `hashlib` at 64 rounds |
| `verify/` — independent exhaustive paths: ANF, packed ANF, landscape, dependence, DDT | implemented, tested |
| `modules/degree/` — Module 1 | built, measuring; **PARTIAL** (11/11 module gates, **5/7** targets GO) |
| `modules/reach/` — Module 2 | **built**, 10/11 gates, calibration-blocked (E-05) |
| `modules/differential/` — Module 3 | **built**, **11/11 module gates**, **first Tier S path**; NO-GO on its one target, blocked on a named but unreachable anchor (E-04 class) |
| `modules/mitm/` — Module 5 | **built**, **10/11** gates; NO-GO on its one target, blocked on a named but unreachable anchor (E-04 class) |
| `modules/hod/` — Module 4 | built, **9/11** gates, calibration-blocked (E-05) |
| Module 6 | not started; no longer blocked on a missing target, only unwritten |

### Verification at this commit

```
814 tests, 0 failed in 8m04s (whole suite, slow lane included)
6 structural CI checks, 0 failed
135 mutants across 15 layers, 0 survivors (>=5 per layer)
compliance audit: 9 runs, chains unbroken; 1 compliant, 8 carrying a
  reported deviation -- 7 of those reference a pre-registration text that was
  later edited (D-054), which is the auditor working as designed
```

---

## Running it

```bash
cd algebraic-probe
pytest -q                                # 814 passed (whole suite)
python scripts/ci_checks.py              # checks=6 failed=0
python scripts/mutation_test.py          # mutants=135 survivors=0
python scripts/readiness_report.py       # per-target go/no-go
python scripts/execute.py --preview      # what would run; writes nothing
python scripts/execute.py                # run what the gates authorise, and log it
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

**Six of the eleven escalations were closed on 2026-09-22** when the operator
delegated the decisions (D-047). No gate was relaxed and no threshold moved to
reach any of them. What is left:

| # | Blocker | What it holds up |
|---|---|---|
| **E-04** | ground-truth citations unreachable (egress) | M1 on `keccak-f[25]` and `mimc-gf2n`, **M3** and **M5** on SHA-256 — four module-target pairs, one act |
| **E-05** | no published anchor exists for M2/M4/M6 | those modules ship calibration-blocked |
| **E-01** | the Tier S closure is unconfirmed | whether the statistical layer has any purpose |
| **E-09** | may exhaustive in-repo truth substitute for a published anchor? | recommendation: no, in the general form |
| **E-11** | the enlarged blindness statement | accept it, or commission a landscape module |

Eleven items, with the arithmetic for each, are in `ESCALATIONS.md`. Every
judgement call is in `DECISIONS.md` (57 entries), including the ones where a
measurement refuted something I had written, and the ones where a control
expectation turned out to be a number I had guessed rather than computed.

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
checkpoints/  per-stage findings, A through L
REPORT.md     the single operator-facing report; contains judgement
DECISIONS.md  every judgement call, with reasoning
ESCALATIONS.md  what waits on the operator, and what each item blocks
```
