# algebraic-probe — full report

**Commit** `1fc7af1` · **Date** 2026-08-24 · **Autonomous completion run: stages A–E complete**

An instrument for bounding the algebraic attack surface of ARX and
arithmetisation-oriented hash functions. Output is bounds, distributions and
scope statements; it claims neither a break nor an impossibility.

This is the single operator-facing report and it contains judgement. It is
deliberately **not** in `reports/out/` — those are instrument output and carry no
prose, enforced in CI. Judgement calls are itemised in `DECISIONS.md`.

---

## 0. Run outcome

Stages A–E complete. **Promoted set empty.** Every module either passes its
gates or is recorded calibration-blocked with the reason. Compliance audit run
with every deviation reported; provenance chain verified.

| Stage | Outcome |
|---|---|
| A — MiMC divergence | bound path **sound but loose**, not defective; derived bound added, mean gap 3.71 → 0.86 |
| B — composition | naive doubling **provably cannot track** a composed target; gap up to 10 bits |
| C — blockers | C1, C2 confirmed environmental; C3 has no anchor. All escalated, none worked around |
| D — M2–M6 | M4 built and calibration-blocked; M2/M3/M5/M6 blocked on E-03 |
| E — synthesis | 0 candidates eligible, 0 promoted; 1 of 3 runs compliant; chains unbroken |
| F — exhaustion | Keccak-f[25] and MiMC/GF(2^9) exhausted; bound **sound at every round**, tight at 1–4, gap 2 at round 5. No gate changed, nothing promoted |
| G — witness | Probe calibrated against known truth: **0 witnesses in 750 draws** above the exact degree; measured rate exceeds the worst-case model by 2×–2540×. D-010 not reopened |
| H — landscape | The null **was** incomplete. Degree separates **0 of 5** hierarchical landscapes; a local-minimum count separates 5 of 5. Fourth blindness class added; nothing promoted |

Per-stage detail in `checkpoints/`. Operator items in `ESCALATIONS.md` (10).

### Stage A — the divergence was a loose bound, not a defect

`d_ub ≥ d_exact` at every measured point (n ∈ {9,11,13}, r ∈ [1,7]). Both models
stated in advance were refuted: MODEL-P predicted a drop at r=4 that **did not
occur** (measured 4, predicted 3), so it is not even an upper bound; MODEL-C is
sound but overshoots by 1–3 bits. `mimc_derived_bound` implements the sound one.

### Stage B — what composition exposed

Iterated cube map over GF(2^9): the exact degree **decreases** at r=4 and r=6. A
doubling bound is monotone and cannot reproduce a decrease at any round.
Block-restricted map at n=12: the naive bound breaches a ceiling that is a
theorem about the target from r=3, reaching 11 against a true degree of 1.

The prior gap=0 controls were validating the implementation, not the instrument.

### Stage D — M4's substantive result

The round at which the implied higher-order distinguisher stops being useful:

| n | naive doubling | derived | exact | rounds given up by doubling |
|---|---:|---:|---:|---:|
| 9 | 2 | 5 | 5 | **3** |
| 11 | 3 | 6 | 6 | **3** |
| 13 | 3 | 7 | 8 | **5** |

Checked empirically: the order-(d+1) derivative vanishes and the order-d one does
not, at every round.

### Stage E — combined blindness

**Four** implemented, run and passing blindness classes. Their union is the
honest description of what remains unexamined: anything expressible as a small
implicit relation system over the extension field; anything over multiplicative
or non-affine subsets (a distinguisher on **7** inputs where the degree measure
demands **2^9**); **any hierarchical organisation of the search landscape, which
the degree measure fails to see in 5 of 5 cluster counts tested**; all of
SHA-256; differential, MITM and rotational structure; and degree over prime
fields, where the metric is undefined.

The fourth was added after the run, in response to an outside challenge that the
null might be incomplete. It was — see Stage H.

---

## 1. Decision

Computed, not asserted. Gates are checks against the repository; the rule is
fixed before evaluation (`GO iff every blocking gate passes`, no weighting, no
partial credit — a weighting would itself be a judgement about which of the
brief's requirements matter more).

Decisions are per **(module, target)**. A monolithic verdict blocked measuring
degree on Keccak-f because SHA-256 was absent, which is the opposite of acting on
the evidence; `PARTIAL` names a module whose own machinery is sound and whose
targets differ.

| Module | Title | Module gates | Targets GO | Decision |
|---|---|---:|---:|---|
| **M1** | Algebraic degree growth vs round count | **11/11** | **4/7** | **PARTIAL** |
| M2 | Dependency-graph reachability, free-round budget | 1/11 | — | NO-GO |
| M3 | Differential characteristic search | 2/11 | — | NO-GO |
| M4 | Higher-order differentials, integral distinguishers | 0/11 | — | NO-GO (+ depends on M1) |
| M5 | Meet-in-the-middle and biclique structure | 2/11 | — | NO-GO |
| M6 | Rotational-XOR propagation | 1/11 | — | NO-GO |

### M1 per-target

| Target | Decision | Blocking gate |
|---|---|---|
| linear-map-gf2 | **GO** | — |
| power-map-gf2n | **GO** | — |
| inverse-map-gf2n | **GO** | — |
| random-function-sha256-prf | **GO** | — |
| keccak-f[25] | NO-GO | T02 ground truth rests on unverified `CITE-BCD11` |
| mimc-gf2n[9] | NO-GO | T02 ground truth rests on unverified `CITE-EGLORSW20` |
| sha256-compression-parametrised | NO-GO | T01 target absent |

Every M1 module-level gate now passes: pre-registration committed and matching
its derivation, runner-precedes-prereg ancestry intact, calibration suite
defined, published anchor named, controls recomputing, blindness test passing,
independent verify path present, **measurement path registered**, promotion gate
instantiated, dependencies clear.

Rerun: `python scripts/readiness_report.py` (exit 1 while anything is NO-GO).

---

## 2. Execution

`scripts/execute.py` runs exactly what the gates authorise, through the
provenance runner, and records refusals in the same append-only hash-chained log
as the results — so the log says what was withheld as well as what was measured.

```
authorised_runs=4
refused  sha256-compression-parametrised   T01:target-available
refused  keccak-f[25]                      T02:target-ground-truth-verified
refused  mimc-gf2n[9]                      T02:target-ground-truth-verified
```

| Target | Instance | `d_ub` (P) | `d_exact` (E) | gap | `d_lb` witnessed | space |
|---|---|---:|---:|---:|---|---|
| linear-map-gf2 | n=12 | 1 | 1 | 0 | yes | 2^12 |
| power-map-gf2n | n=11, d=3 | 2 | 2 | 0 | yes | 2^11 |
| power-map-gf2n | n=11, d=31 | 5 | 5 | 0 | yes | 2^11 |
| inverse-map-gf2n | n=11 | 10 | 10 | 0 | yes | 2^11 |
| random-function | n=12 | no bound path | 12 | — | yes | 2^12 |

The bound is exact on every control. The random-oracle stand-in has no round
structure to propagate through and the measure refuses rather than inventing
one; that refusal is recorded, not skipped.

Run log: `runs/PREREG-M1/…jsonl`, 20 records, content-addressed, carrying the
commit and the pre-registration digest.

---

## 3. The measurement path

Three quantities, three code paths, three tiers.

**`degree_upper_bound` — Tier P.** A per-bit degree bound propagated through the
target's *own code* by a symbolic word type, so Keccak-f is measured by running
`core.keccak.permute` rather than by re-implementing it. Two details make the
bound tight rather than vacuous:

- structural zeros are tracked separately from degrees, so the rotation idiom
  (OR of two disjoint shifted copies) is not charged as a product;
- squaring is charged as GF(2)-linear (Frobenius), so square-and-multiply over
  an exponent returns **exactly wt(d)** on power maps.

**`exact_degree` — Tier E.** ANF coefficients from their definition: the
coefficient on variable set S is the XOR of f over every subset of S, scanning
monomial weights downward. A different algorithm from the in-place Möbius
butterfly in `verify/`, which is what makes one a check on the other rather than
a restatement.

**`witness_lower_bound` — Tier P when it witnesses.** A non-zero k-th order
derivative *proves* degree ≥ k. The seed that found it is provenance, not
evidence. Failure to witness is Tier S and, per PREREG-M1 §9.1, has no promotion
path above probe dimension 2.

### Soundness

The load-bearing property: a certified bound that ever falls below the true
degree is wrong in the dangerous direction, and everything downstream inherits
the error. Checked against the independent exhaustive path on every supported
target, and pinned by six mutants (XOR taking min, AND not summing, cap off by
one, Frobenius resetting, wrong coefficient branch, vanishing derivative
reported as a witness).

### Measured behaviour

| Target | Bound by round |
|---|---|
| Keccak-f[25] | 2, 4, 8, 16, **24, 24** — doubling until the permutation cap at width−1 |
| MiMC GF(2^9) `d_ub` | 2, 4, 8 |
| MiMC GF(2^9) `d_exact` | 2, **2**, **4** |

The MiMC divergence is the arithmetisation-oriented degree-growth phenomenon —
naive doubling overstating the real degree — as a number this instrument
produces rather than a claim it repeats. It is also exactly why the ground-truth
citations matter: the literature's bound is tighter than mine, and until those
values are transcribed I cannot show mine is competitive.

### Measured tightness — the exhaustive arm

Added after the run, on the instruction to convert the escalations by
brute-force exhaustion. Keccak-f[25] has 25 free bits, which is exhaustible: the
truth table is held one bit per input in a single integer, so the Möbius
transform is 25 mask-shift-XOR operations over the whole space at once
(`verify/packed.py`, `verify/keccak_columns.py`, D-034). Tier E, ~25 s,
`python scripts/exhaust.py`.

| Rounds | Exact degree | Tier P bound | Gap |
|---|---|---|---|
| 1 | 2 | 2 | 0 |
| 2 | 4 | 4 | 0 |
| 3 | 8 | 8 | 0 |
| 4 | 16 | 16 | 0 |
| 5 | **22** | 24 | **2** |
| 6 | 24 | 24 | 0 — saturated at width−1 |

All 25 output lanes carry the same degree at every round. For MiMC over GF(2^9),
the mean bound gap against exact truth is 1.333 for naive doubling and 0.444 for
the derived support bound, and both are sound at every round.

Two things this establishes, neither requiring a citation. The soundness
property above was previously checked only where `verify/anf.py` could reach
(≤ 24 variables, and not Keccak-f[25] at all); it now holds against exact truth
on a real primitive at every round measured. And the bound is **exactly tight at
rounds 1–4, loose by 2 at round 5, tight again at 6** — the first measurement of
this instrument's tightness rather than an argument about it.

### Measured probe behaviour — the witness arm

The exhaustive arm made a second thing possible: targets of *known* exact degree,
against which the sampled probe can be calibrated. `scripts/witness_calibration.py`,
52 cells at the pre-registered 50 seeds.

**The deductive half.** Degree exactly *d* means every derivative of order *d+1*
vanishes identically, so above *d* the probe must never witness. 15 cells, 750
draws, **0 witnesses**. First check of the Tier S machinery against ground truth,
and it is falsifiable — a single witness there contradicts a theorem.

**The sampled half.** §9 models the per-draw witness probability by its
Schwartz–Zippel worst case, 2^−k. Measured at *k* equal to the exact degree:

| Target | rate | worst case | ratio |
|---|---|---|---|
| linear-map-gf2 n=13 | 1.00 | 0.5 | 2× |
| power-map-gf2n d=31 | 1.00 | 0.03125 | 32× |
| power-map-gf2n d=4095 | 0.62 | 0.000244 | 2540× |
| keccak-f[25] r=3 | 1.00 | 0.00390625 | 256× |

In all 37 cells at or below the degree, the Clopper–Pearson lower bound excludes
the worst case.

**D-010 stays closed regardless.** These rates were measured on targets whose
degree was already known; promotion concerns a target whose degree is unknown,
which is the whole reason a probe exists. The targets are also far from
saturation, while the closure was drawn for the sparse top-form regime where the
probe is weakest. And revising a pre-registered threshold on seeing data that
favours revising it is the prohibited act, whatever the margin. Recorded as
evidence under E-01 — it licenses a better-informed answer, not the answer
(D-037).

### Is the null complete? — the landscape arm

Put to me from outside: statistical mechanics describes landscapes that are
locally indistinguishable from random while globally organised, so "no local
signal" may have been recorded as "no structure".

**The premise needed one correction.** The objection was framed around lag-1
autocorrelation. This instrument computes no autocorrelation and no lag
statistic — the only grep hit is prose describing the *prior* tool that the
linear-map control exists to expose. But the structural point transfers intact,
and it was right.

Module 1's three blindness classes all named *algebraic* structure the Boolean
degree cannot see. None named *geometric* structure in the search landscape.
`core/landscape.py` builds the pair that exposes it: one energy construction,
E(x) = √a·z_outer(block) + √(1−a)·z_inner(x), with the Boolean view being the
energy pushed through its own CDF, so the output's marginal law — and hence the
degree — is identical whether or not the hierarchy is there.

`python scripts/landscape.py`, n = 14, six cluster counts from 1 to 1024, Tier E:

| Statistic | Cells separated |
|---|---|
| **algebraic degree** | **0 of 5** — profile (14,13) throughout |
| local minima | 5 of 5 — 32–47% below the i.i.d. prediction |
| overlap P(q) | 4 of 5 — blind at 1024 clusters |
| density of states | 1 of 5 — a finite-cluster artefact |

The prediction 2^n/(n+1) is derived in-repo from exchangeability alone
(`M1-LAND-DERIVE-001`) and tested by enumerating *every* ordering of the energies
at n = 1, 2, 3 and asserting the mean as an exact rational — no citation, which
matters because the spin-glass literature sits behind the same egress block as
E-04.

**So the answer is yes: the null was incomplete.** A fourth blindness class now
records it (`CAL-M1-BLIND-LANDSCAPE`), which makes every negative this instrument
emits *weaker*, not stronger.

**Two claims of mine the measurement refuted**, recorded because I made them
before testing them. I wrote that the density of states cannot separate the
regimes since both are standard normal — true of the marginal, false of the
empirical density over one hypercube, where the outer level supplies only
2^n_outer draws and the mean fluctuates by √(a/2^n_outer). And I wrote that the
overlap stays separated at every cluster count; at 1024 clusters of 16 states the
low-energy sample spans many clusters and it returns to baseline.

**The general finding is the stronger one.** Every statistic measured here has a
regime where it reports "no structure" about a landscape that has structure by
construction. The degree measure is blind in all five cells; each proposed
replacement is blind in some. A landscape module would not remove blindness — it
would move it. That is an argument against building one, and it is E-11.

### Neither arm changed a gate

The published-ground-truth cases remain `PENDING_PRIMARY_SOURCE`,
`python scripts/execute.py` still refuses Keccak-f[25] and MiMC at
`T02:target-ground-truth-verified`, and nothing was promoted.
Substituting a value computed here for a value attributed to a paper is what
Class 2 forbids; the refusal is enforced by `CaseKind.EXHAUSTIVE_GROUND_TRUTH`
not satisfying the anchor requirement, pinned by mutant `EXHT-02` (D-035). The
open question is E-09.

---

## 4. What exists

| Package | Lines | Role |
|---|---:|---|
| `tiers/` | 1028 | tier labels, provenance, spaces, distributions, findings — enforced |
| `harness/` | 1419 | registry, regime router, calibration and promotion gates, sweeps, runner, readiness |
| `provenance/` | 771 | commit embedding, prereg hashing, hash chain, append-only store, audit |
| `modules/` | 1213 | Module 1: pre-registration, calibration, blindness, **measurement** |
| `core/` | 795 | control targets, Keccak-f, MiMC; SHA-256 absent by design |
| `stats/` | 716 | BH, power analysis, Tobit censored regression, p-value formatting |
| `verify/` | 160 | exhaustive Möbius ANF, independent path |
| `reports/` | 151 | prose lint |
| `scripts/` | 1683 | CI checks, mutation harness, readiness, execution, renderers, benchmark |
| `tests/` | 3703 | 425 tests |

101 files, ~11.6k lines of Python, **no third-party dependencies**.

### Verification at this commit

```
checks=5 failed=0          scripts/ci_checks.py
425 passed in 66.55s       pytest -q
mutants=67 survivors=0     scripts/mutation_test.py  (9 layers, ≥5 each)
```

Mutants per layer: core 8, harness 11, measure 6, modules 7, provenance 9,
reports 6, stats 6, tiers 9, verify 5.

Structural checks: `verify/` does not import `modules/`; `modules/` does not
import `verify/` (so a module cannot verify itself); `reports/out/` holds no
prose conclusions; PREREG-M1's derived numbers are byte-equal to their
derivation; the provenance runner was committed **before** the pre-registration
it stamps (git ancestry, not timestamps).

### Independent reproduction

The documented sequence was run against a fresh clone of the published branch,
not the working tree. Output compared byte-for-byte: derived block identical,
calibration manifest identical, instrument reports identical apart from commit
identifiers, which the subtree split legitimately rewrote.

### Primitives validated

- **Keccak-f** — ρ offsets from the `(x,y) ← (y, 2x+3y)` recurrence, ι constants
  from the 8-bit LFSR, no tabulated constants. Bit-exact against
  `hashlib.sha3_256` and `shake_128` over 11 committed input lengths.
- **MiMC** over GF(2^n) — permutation property verified exhaustively at n=9.
- **GF(2^n)** — moduli *searched* by Rabin's test, "lowest" verified against
  every smaller candidate.
- **Power map** — degree = wt(d) verified for **all 510 exponents** at n=9.

---

## 5. Module 1 pre-registration

- primary metric `k_HO = d_ub + 1`, the order of a provably vanishing
  higher-order differential; lower is better
- family size **64**, asserted at analysis time — `benjamini_hochberg` raises if
  the tests presented differ
- effect floor **1.0 degree bits**, from the representable quantum
- promotion gate with numbers: ceiling 2^63.1, generic zero-sum baseline
  2^(k+256), brute force always a baseline, memory-access cost *measured* on the
  run host
- twelve holdout rounds (53–64) reserved before any run

Every number is emitted by `derive_thresholds.py`; a CI check asserts the
document is byte-equal to that output, so it cannot drift.

### The power-analysis finding

| Quantity | Value |
|---|---|
| Detectable at 80% power, 50 seeds | 0.0317 |
| Guaranteed under H0 at probe dimension k | 2^−k |
| Highest k with ≥80% power | **4** |
| Highest k reaching BH's smallest critical value | **2** |
| Seeds to reopen k=16 / k=32 | 468,882 / 3.07×10^10 |

The sampled probe has no promotion path above dimension 2 at 50 seeds. §9.1
closes it in advance and routes M1 through Tier P and Tier E. `DECISIONS.md`
D-010 — the judgement I would most want overruled.

### Calibration — 11 cases

Five controls now execute **through the module's own measurement path** and
pass: degree 1 → 5 → 2 → ≥11 → 10, spanning the range rather than the endpoints.
Six published-ground-truth cases carry `PENDING_PRIMARY_SOURCE` and still block.
Running the controls does not lift that gate, and a test asserts it does not.

### The blindness demonstration

`x → x^(2^n−2)` has degree n−1 — maximal for a permutation — and is inverted by
one field inversion, being described exactly by `x·y = 1`. The demonstration runs
against the **exact** reference measure, so the blindness is a property of the
quantity: no future bounding argument can remove it.

---

## 6. Defects found and closed — 10

Nine surfaced by adversarial probing **after** the suite was green and every
mutant died; the tenth only by running the documented commands from a fresh
clone. Common cause: an integrity rule stated in a docstring and enforced only
along the paths the tests happened to walk.

| # | Defect | Consequence if unfixed |
|---|---|---|
| 1 | Cross-tier `==` returned `False` while `<`/`>` raised | answered a question §3 forbids |
| 2 | A "frozen" result's payload was editable in place | recorded results mutable after the fact |
| 3 | **Hash chain could not detect truncation** | records deleted from the end left a chain that verified perfectly |
| 4 | NaN seed value corrupted every order statistic | one failed run poisoned median and IQR silently |
| 5 | `PowerMap.create(n, 0)` stated expected degree n | a calibration control with a wrong expected value |
| 6 | Target arity was a field defaulting to 0 | a measurement over zero variables returning a confident answer |
| 7 | Targets silently truncated out-of-range inputs | a complete, self-consistent, wrong degree, nothing raising |
| 8 | Prose lint missed phrases wrapped across a line break | banned conclusions passing into reports |
| 9 | Part-finished sweep cell returned as complete | 40-of-50 seeds clearing the 30-seed floor, looking planned |
| 10 | Documented `-m` command double-imported and warned | suite built twice; would fail under `filterwarnings=["error"]` |

Defect 3 is the serious one, closed twice over: `run_end` declares the run's
total length and must be last, and `seal()` registers length and head hash in the
run index. The declared-count check earns its keep against a *re-chained* forgery
— every hash recomputed after a deletion, but the closing record still declaring
the original length.

Each has a regression test and a mutant. Detail: `DECISIONS.md` D-028.

Three findings from the mutation runs about themselves: two proposed mutants were
semantically **equivalent** (not undetected defects) and were replaced; a
same-length mutant poisoned later runs through CPython's mtime-granularity `.pyc`
cache, so the harness now purges `__pycache__` on both sides of each mutation.

---

## 7. Outstanding

**Operator**

1. **Vendor the parametrised SHA-256 target.** Unblocks T01 on every module — the
   highest-leverage single action. `core/sha256.py` lists its four preconditions.
2. **Transcribe two ground-truth values** — per-round Keccak-f degree bounds
   (ePrint 2010/589) and MiMC degree growth (ePrint 2020/182), with table or
   theorem numbers. Both hosts are blocked by this environment's egress proxy;
   the failed fetches are logged. No plausible numbers were written from memory.
   Unblocks M1 on Keccak-f and MiMC.
3. **Choose published anchors for M2, M4, M6.** §5 makes an anchor a blanket
   precondition and names one for M1, M3, M5 only.
4. **Confirm or overrule** the Tier S closure (D-010) and the promotion
   threshold's dependency on an unverified citation (D-013).
5. **Decide E-09** — whether an exhaustive in-repo ground truth may ever stand in
   for a published anchor. Three options, recommendation against the general
   form. Nothing turns on it unless you want Keccak-f[25]'s gate opened without
   item 2.

**Build**

6. Modules 2–6.
7. A `d_Fp` metric for the prime-field targets — see below.

**What exhaustion could and could not reach.** On the instruction to convert
these by brute force: it converts item 2 partially (both targets are now measured
exactly in-repo, though the citations remain untranscribed) and touches nothing
else. Item 1 is 2^512 and out of reach of exhaustion, of sampling, and of both
together; items 3, 4, 5 and 7 are decisions or definitions rather than
computations. `ESCALATIONS.md` E-10 carries the per-item arithmetic.

---

## 8. Requirement conflict

§4 defines Module 1's quantity as algebraic degree **over GF(2)**; §9 names
Poseidon over KoalaBear and MiMC over BN254/BLS12-381 — prime fields, where
Boolean algebraic degree is not defined. There is no ANF over GF(2) for a map
F_p → F_p, and bit-embedding gives a quantity that is not the one the AO
literature disputes. MiMC over GF(2^n) is unaffected and is what is implemented.

Related gap: `tiers/` refuses cross-*tier* comparison but not cross-*metric*
comparison — `d_ub` and a future `d_Fp` would both be Tier P and would compare
without complaint. Closing it is a `metric_family` field with the same refusal
semantics.

---

## 9. Reproduction

```bash
git clone -b algo-games https://github.com/punkrockquantum/JRRToken.git
cd JRRToken
pytest -q -m "not slow"                      # 638 passed, 13 deselected
python scripts/ci_checks.py                  # checks=5 failed=0
python scripts/mutation_test.py              # mutants=104 survivors=0
python scripts/readiness_report.py           # per-target go/no-go
python scripts/execute.py                    # run what the gates authorise
python scripts/exhaust.py                    # exhaustive exact degree, ~25s
python scripts/witness_calibration.py        # probe vs known truth, ~28s
python scripts/landscape.py                  # what the degree measure cannot see, ~1s
python -m modules.degree.calibration         # what Module 1 asserts
python modules/degree/prereg/derive_thresholds.py
python scripts/render_reports.py
```

`pytest -q` runs the slow lane too, which includes the mutation suite and the
regeneration check on `exhaustive_truth.py`; budget several minutes.

Full history is required: the runner-precedes-prereg check is a claim about git
ancestry, so `fetch-depth: 0` is load-bearing in CI.

Branches — `algo-games` (project at repository root) and
`claude/algebraic-probe-skeleton-2uaojo` (under `algebraic-probe/`). Identical
content.

---

## 10. Position

The instrument is built, calibrated on its controls through its own measurement
path, independently reproducible, and it has executed everything its gates
authorise while refusing the rest with reasons recorded in the log.

M1 is PARTIAL: sound machinery, four of seven targets clear. The three that are
not are blocked on inputs only you can supply — one absent target and two
untranscribed literature values. M2–M6 have no package and remain NO-GO.

Nothing has been run against SHA-256. The ten defects — nine of them found after
the suite was green and every mutant had died — are the strongest evidence
available that the enforcement here is real rather than documentary.

The two brute-force arms added two properties the instrument did not previously
have evidence for. Its certified bound is sound at every round of a real
primitive, measured against exact truth over the complete input space rather than
argued from the propagation rules. And its sampled probe never witnesses above
the exact degree — 750 draws, 0 witnesses — which is the first check of the
Tier S machinery against ground truth rather than against its own model.

Between them they added no promotions, opened no gate, and moved one escalation.
They also produced the one result that argues against its own convenience: the
worst-case witness model is loose by up to 2540× on everything measured, and
D-010 stays closed anyway, because a rate measured on targets of known degree is
not evidence about a target of unknown degree. That combination is the result,
and it is reported as such because the run was instructed to terminate on
completion rather than on success.
