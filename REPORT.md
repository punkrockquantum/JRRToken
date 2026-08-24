# algebraic-probe — status report

**Commit** `7b86060` · **Date** 2026-08-24 · **Scope** first deliverable (brief section 11) plus execution-readiness assessment

Outcomes of every run are recorded separately in `OUTCOMES.md`.

This is an operator-facing status report and it contains judgement. It is
deliberately **not** in `reports/out/` — those files are instrument output and
carry no prose, enforced by `scripts/ci_checks.py`. See DECISIONS.md D-018.

---

## 1. Decision

**NO-GO on all six modules.** The decision is computed, not asserted: thirteen
gates per module, each a check against the repository, combined by a rule fixed
before evaluation (`GO iff every blocking gate passes`, no weighting, no partial
credit — a weighting would itself be a judgement about which of the brief's
requirements matter more).

| Module | Title | Gates | Blocking | Blocked on |
|---|---|---|---|---|
| **M1** | Algebraic degree growth vs round count | **10/13** | 3 | operator, build |
| M2 | Dependency-graph reachability, free-round budget | 1/13 | 12 | operator, build |
| M3 | Differential characteristic search | 2/13 | 11 | operator, build |
| M4 | Higher-order differentials, integral distinguishers | 0/13 | 13 | operator, build, **dependency (M1)** |
| M5 | Meet-in-the-middle and biclique structure | 2/13 | 11 | operator, build |
| M6 | Rotational-XOR propagation | 1/13 | 12 | operator, build |

Rerun with `python scripts/readiness_report.py`; full output in
`reports/out/readiness.txt`.

### Root causes, by number of modules blocked

| Gate | Modules blocked | Class |
|---|---|---|
| G01 primary-target-present | **6/6** | operator |
| G07 ground-truth-verified | **6/6** | operator |
| G11 measurement-registered | **6/6** | build |
| G02–G05, G08–G10, G12 | 5/6 each | build |
| G06 published-anchor-named | 3/6 | operator |
| G13 dependencies-are-go | 1/6 | dependency |

Three gates block every module. That is a fact about the dependency structure,
not a priority call — but it means vendoring the SHA-256 target clears one gate
on all six simultaneously, and is the highest-leverage single action available.

---

## 2. What exists

| Package | Lines | State |
|---|---:|---|
| `tiers/` | 1028 | tier labels, provenance, spaces, distributions, findings — enforced |
| `harness/` | 1302 | registry, regime router, calibration gates, promotion gate, sweeps, runner, readiness |
| `provenance/` | 771 | commit embedding, prereg hashing, hash chain, append-only store, audit |
| `stats/` | 716 | BH, power analysis, Tobit censored regression, p-value formatting |
| `core/` | 795 | control targets, Keccak-f, MiMC; SHA-256 **absent by design** |
| `modules/` | 702 | Module 1: pre-registration, calibration suite, blindness class |
| `verify/` | 160 | exhaustive Moebius-transform ANF, independent path |
| `reports/` | 151 | prose lint |
| `scripts/` | 1338 | CI checks, mutation harness, readiness, renderers, memory-cost benchmark |
| `tests/` | 3517 | 377 tests |

89 files tracked, ~10.3k lines of Python. No third-party dependencies
(DECISIONS.md D-004).

### Verification evidence, this commit

```
checks=5 failed=0          scripts/ci_checks.py
377 passed in 68.33s       pytest -q
mutants=61 survivors=0     scripts/mutation_test.py  (8 layers, ≥5 each)
```

Mutants per layer: core 8, harness 11, modules 7, provenance 9, reports 6,
stats 6, tiers 9, verify 5.

The structural checks are:

- `verify/` does not import `modules/` — the separation that stops a
  verification restating what it verifies
- `modules/` does not import `verify/` — the same in reverse, so a module
  cannot verify itself (my addition, D-006)
- `reports/out/` contains no prose conclusions
- PREREG-M1's derived numbers are byte-equal to their derivation script
- the provenance runner was committed **before** the pre-registration it
  stamps — `runner=84ca87e` is a strict git ancestor of `prereg=d84c096`

Regenerating the instrument reports changes only the embedded commit stamp,
which is the intended evidence of determinism.

### Primitives validated

- **Keccak-f**, parametrised by lane width and round count. Rho offsets derived
  from the `(x,y) ← (y, 2x+3y)` recurrence, iota constants from the 8-bit LFSR —
  no tabulated constants. Bit-exact against `hashlib.sha3_256` and
  `hashlib.shake_128` over eleven committed input lengths.
- **MiMC** over GF(2^n) with the cube map; permutation property verified
  exhaustively at n=9.
- **GF(2^n)** with field moduli *searched for* by Rabin's irreducibility test
  rather than copied from a table, and the "lowest" verified by checking every
  smaller candidate.

---

## 3. Module 1 — the only module near GO

Passes 10 of 13 gates. Blocks on exactly three, two of which are yours.

### Pre-registration (`modules/degree/prereg/PREREG-M1.md`)

- primary metric `k_HO = d_ub + 1`, the order of a provably vanishing
  higher-order differential; lower is better
- family size **64**, one Tier S cell per round, asserted at analysis time —
  `stats.bh.benjamini_hochberg` raises if the tests presented differ
- effect floor **1.0 bits of algebraic degree**, derived from the representable
  quantum (degree is integer-valued) rather than chosen
- promotion gate instantiated with numbers: threshold 2^63.1, generic zero-sum
  baseline 2^(k+256), brute force always a baseline, memory-access cost measured
  on the run host by `scripts/measure_memory_cost.py` rather than assumed
- twelve holdout rounds (53–64) reserved before any run, so a criterion changed
  after seeing data becomes an out-of-sample test

Every number in it is emitted by `derive_thresholds.py`, and a CI check asserts
the document is byte-equal to that script's output. It cannot drift.

### The power-analysis finding

This is the most decision-relevant thing in the pre-registration, and it was
computed before any data exists:

| Quantity | Value |
|---|---|
| Smallest witness probability detectable at 80% power, 50 seeds | 0.0317 |
| Guaranteed-under-H0 probability at probe dimension k | 2^-k |
| Highest k with ≥80% power | **4** |
| Highest k reaching the BH family's smallest critical value | **2** |
| Seeds needed to reopen k=16 | 468,882 |
| Seeds needed to reopen k=32 | 3.07 × 10^10 |

The sampled witness probe therefore has no promotion path above probe dimension
2 at the brief's preferred 50 seeds. PREREG-M1 §9.1 closes it in advance and
routes Module 1 through Tier P and Tier E. Reasoning in DECISIONS.md D-010 —
this is the judgement call I would most want overruled if you disagree.

### Calibration suite — 11 cases

| Kind | Case | Asserts | State |
|---|---|---|---|
| positive control | `Ax` over GF(2), n=12 | degree == 1 | ✅ recomputes |
| intermediate | `x^31` over GF(2^11) | degree == wt(d) == 5 | ✅ recomputes |
| intermediate | `x^3` over GF(2^11) | degree == 2 | ✅ recomputes |
| negative | random-oracle stand-in, n=12 | degree ≥ 11 | ✅ recomputes |
| blindness | `x^(-1)` over GF(2^11) | degree == n-1 | ✅ recomputes |
| ground truth ×3 | Keccak-f[25], r=1,2,3 | per-round bound from CITE-BCD11 | ⛔ pending source |
| ground truth ×3 | MiMC/GF(2^9), r=1,2,3 | degree growth from CITE-EGLORSW20 | ⛔ pending source |

The controls span the range rather than the endpoints — 1, then 5, then n-1 —
and the power map is checked for **all 510 exponents** at n=9, not a sample.

### The blindness demonstration

The null Module 1 can emit is "degree saturated, no higher-order differential of
feasible order". The multiplicative inverse over GF(2^n) has degree n-1 — the
maximum for a permutation — and is inverted by **one field inversion**, being
described exactly by the quadratic relation `x·y = 1`.

The demonstration runs against the *exact* reference measure in `verify/`, not
against an approximation. So the blindness is a property of the quantity itself:
no future bounding argument in Module 1 can remove it. That is the strongest
form section 6(c) can take.

---

## 4. Nine integrity defects found and closed

Found by adversarial probing **after** the suite was green and every mutant
died. They shared one cause: an integrity rule stated in a docstring and
enforced only along the paths the tests happened to walk.

| # | Defect | Why it mattered |
|---|---|---|
| 1 | Cross-tier `==` returned `False` while `<`/`>` raised | answered a question section 3 forbids |
| 2 | A "frozen" result's payload was editable in place | `frozen=True` protects the binding, not the dict |
| 3 | **The hash chain could not see truncation** | records deleted from the *end* left a shorter chain that verified perfectly |
| 4 | A NaN seed value corrupted every order statistic | one failed run silently poisoned median and IQR |
| 5 | `PowerMap.create(n, 0)` stated expected degree n | a *calibration control* with a wrong expected value |
| 6 | Target arity was a field defaulting to 0 | a measurement over zero variables returns a confident answer about nothing |
| 7 | Targets silently truncated out-of-range inputs | an exhaustive walk with wrong n gives a complete, self-consistent, wrong degree, with nothing raising |
| 8 | The prose lint missed wrapped phrases | "as expected" split across a line break — exactly how a report wraps — passed |
| 9 | A part-finished sweep cell was returned as complete | 40 of 50 seeds cleared the 30-seed floor and looked planned |

Defect 3 is the serious one. It is closed twice over: `run_end` declares the
run's total length and must be the last record, and `seal()` registers length
and head hash in the run index for `verify_against_index()`. The declared-count
check earns its keep against a *re-chained* forgery — every hash recomputed
after a deletion, but the closing record still declaring the original length.

Each has a regression test and a mutant pinning it. Full write-up: DECISIONS.md
D-028.

---

## 5. Blockers, by owner

### Yours (operator)

1. **Vendor the parametrised SHA-256 target.** `sha256-testbed` is unreachable
   from this session. `core/sha256.py` raises `NotAuthorised` listing four
   preconditions: vendor without modification, re-run FIPS 180-4 vectors here,
   assert bit-identity with `hashlib` at 64 rounds, record the upstream commit.
   Clears gate G01 on **all six** modules.
2. **Transcribe two ground-truth values.** `eprint.iacr.org` and `hal.science`
   are blocked by this environment's egress proxy — logged with the exact failed
   fetches. Needed: per-round Keccak-f degree bounds from Boura–Canteaut–De
   Cannière (ePrint 2010/589) and the MiMC degree-growth statement from
   Eichlseder et al. (ePrint 2020/182), with table or theorem numbers. I did not
   write plausible numbers from memory. Clears G07 for M1.
3. **Choose published anchors for M2, M4, M6.** Section 5 requires a published
   calibration anchor for every module and names one for only M1, M3 and M5. The
   requirement is blanket, so those three cannot reach GO until you pick one.
4. **Confirm or overrule the Tier S closure** (D-010) and the promotion
   threshold's dependency on an unverified citation (D-013).

### Mine (build)

5. Module 1's measurement path (division property / monomial prediction) —
   deliberately unwritten; the brief's stop point.
6. Modules 2–6 in full.

---

## 6. One requirement conflict I believe is technically wrong

Section 4 defines Module 1's quantity as algebraic degree **over GF(2)**.
Section 9 then names Poseidon over KoalaBear and MiMC over BN254/BLS12-381 —
prime fields — as secondary targets.

Boolean algebraic degree is not defined for a function on F_p with p not a power
of two. There is no ANF over GF(2) for a map F_p → F_p, and bit-embedding yields
a quantity that is not the one the AO literature disputes — which is the
univariate degree over F_p, the degree of the Gröbner-basis system, or the
degree after the exponent map.

MiMC over GF(2^n) is unaffected and is what `core/mimc.py` implements. But
Module 1 as specified cannot be pointed at the prime-field targets without a
second, separately pre-registered metric. Proposed, not built: a companion
`d_Fp(r)` sharing the harness and nothing else.

Related gap: `tiers/` refuses cross-*tier* comparison but not cross-*metric*
comparison. `d_ub` and `d_Fp` would both be Tier P and would compare without
complaint. If you want that closed it is a `metric_family` field with the same
refusal semantics.

---

## 7. Reproduction

```bash
git clone -b algo-games https://github.com/punkrockquantum/JRRToken.git
cd JRRToken
pytest -q                                    # 377 passed
python scripts/ci_checks.py                  # checks=5 failed=0
python scripts/mutation_test.py              # mutants=61 survivors=0
python scripts/readiness_report.py           # go/no-go per module (exit 1: NO-GO)
python -m modules.degree.calibration   # what Module 1 will assert
python modules/degree/prereg/derive_thresholds.py
python scripts/render_reports.py
```

Full history requires an unshallow clone: the runner-precedes-prereg check is a
claim about git ancestry and `fetch-depth: 0` is load-bearing in CI.

**Branches** — `algo-games` (project at repository root) and
`claude/algebraic-probe-skeleton-2uaojo` (under `algebraic-probe/`, alongside the
unrelated simulator). Identical content.

---

## 8. Position

The instrument is built, tested and calibrated as far as the available inputs
allow, and it says NO-GO on everything. That is the instrument working: two of
Module 1's three blockers are missing inputs rather than missing code, and it
refuses to run rather than substituting something plausible for them.

No module has been executed. Nothing has been run against a real target. The
brief's stop point stands until you have reviewed PREREG-M1 and the calibration
suite.
