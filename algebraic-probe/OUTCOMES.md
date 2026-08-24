# algebraic-probe — outcomes

Record of everything executed, and what came back. Commit `7b86060`,
2026-08-24. Companion to `REPORT.md` (project state and decision) and
`DECISIONS.md` (judgement calls). Instrument output lives in `reports/out/` and
carries no prose; this file is operator-facing and contains judgement.

---

## 1. Headline outcomes

| | Outcome |
|---|---|
| Modules executed against a target | **0** — the brief's stop point, and the readiness gates independently say NO-GO |
| Go/no-go | **NO-GO on all six modules**, computed from 13 gates each |
| Test suite | **377 passed**, 0 failed |
| Mutation testing | **61 mutants, 0 survivors**, 8 layers, ≥5 each |
| Structural checks | **5 passed, 0 failed** |
| Defects found and closed | **10** (9 by adversarial probing, 1 by reproduction) |
| Reproduction from published branch | **byte-identical** apart from commit identifiers |

---

## 2. Execution log

Every command run, and its result. All from a clean checkout at `7b86060`.

| Command | Outcome |
|---|---|
| `pytest -q` | 377 passed in 68.33s |
| `scripts/ci_checks.py` | `checks=5 failed=0`, exit 0 |
| `scripts/mutation_test.py` | `mutants=61 survivors=0`, exit 0 |
| `scripts/readiness_report.py` | `go=[] no_go=[M1…M6]`, exit 1 |
| `python -m modules.degree.calibration` | exit 0, stderr empty, 48 lines |
| `modules/degree/prereg/derive_thresholds.py` | exit 0, stderr empty, 29 lines |
| `scripts/render_reports.py` | 3 files written |

### Independent reproduction

The same sequence was run against a **fresh `git clone` of the published
branch**, not the working tree:

```
clone -b algo-games   ->  8 commits, 91 files
pytest                ->  377 passed in 69.17s
ci_checks             ->  checks=5 failed=0
mutation_test         ->  mutants=61 survivors=0
readiness_report      ->  go=[] no_go=['M1','M2','M3','M4','M5','M6']
calibration manifest  ->  exit=0  stderr_bytes=0
derive_thresholds     ->  exit=0  stderr_bytes=0
render_reports        ->  3 files written
```

Output compared byte-for-byte against the working tree:

| Artefact | Result |
|---|---|
| Derived threshold block | **identical** |
| Calibration manifest | **identical** |
| Readiness report | identical but for one line — see below |
| Regenerated instrument reports | identical but for commit identifiers |

The single differing line is gate G04, which reports
`runner=64bfa51 precedes prereg=6b39bb6` in the clone against
`runner=84ca87e precedes prereg=d84c096` locally. The `git subtree split` that
put the project at the repository root rewrote commit hashes, so the *ids*
differ while the *ancestry relation* holds in both. The provenance layer is
reporting the history it is actually in, which is the intended behaviour.

---

## 3. Go/no-go outcomes

Decision rule, fixed before evaluation: **GO iff every blocking gate passes.**
No weighting, no partial credit — a weighting would be a judgement about which
of the brief's requirements matter more.

| Module | Title | Gates | Blocking | Outcome |
|---|---|---:|---:|---|
| **M1** | Algebraic degree growth vs round count | **10/13** | 3 | **NO-GO** |
| M2 | Dependency-graph reachability, free-round budget | 1/13 | 12 | NO-GO |
| M3 | Differential characteristic search | 2/13 | 11 | NO-GO |
| M4 | Higher-order differentials, integral distinguishers | 0/13 | 13 | NO-GO |
| M5 | Meet-in-the-middle and biclique structure | 2/13 | 11 | NO-GO |
| M6 | Rotational-XOR propagation | 1/13 | 12 | NO-GO |

### M1 gate detail — the only module near GO

| Gate | Outcome |
|---|---|
| G01 primary-target-present | ❌ `core/sha256.py` raises `NotAuthorised` |
| G02 prereg-committed | ✅ `PREREG-M1`, sha256 `640a2469…` |
| G03 prereg-matches-derivation | ✅ byte-equal to derivation script |
| G04 runner-precedes-prereg | ✅ `84ca87e` is a strict ancestor of `d84c096` |
| G05 calibration-suite-defined | ✅ 11 cases, 5 kinds |
| G06 published-anchor-named | ✅ per-round degree values |
| G07 ground-truth-verified | ❌ `CITE-BCD11`, `CITE-EGLORSW20` unverified |
| G08 controls-recompute | ✅ 5 controls by exhaustive ANF |
| G09 blindness-test-passes | ✅ `x^(2^n−2)` returns the saturated null |
| G10 independent-verify-path | ✅ `verify.anf:algebraic_degree` |
| G11 measurement-registered | ❌ `ModuleSpec.measure is None` |
| G12 promotion-gate-instantiated | ✅ all four criteria with numbers |
| G13 dependencies-are-go | ✅ none |

Two of M1's three blockers are missing **inputs**, not missing code.

### Root causes, by modules blocked

| Gate | Blocks | Class |
|---|---:|---|
| G01 primary-target-present | **6/6** | operator |
| G07 ground-truth-verified | **6/6** | operator |
| G11 measurement-registered | **6/6** | build |
| G02–G05, G08–G10, G12 | 5/6 each | build |
| G06 published-anchor-named | 3/6 | operator |
| G13 dependencies-are-go | 1/6 | dependency |

Three gates block every module. Vendoring the SHA-256 target clears one of them
across all six at once.

---

## 4. Verification outcomes

### Test suite — 377 tests

| Area | Tests |
|---|---:|
| `core/` — GF(2^n), Keccak, MiMC, control targets | 92 |
| integrity regressions (the 10 defects) | 35 |
| `harness/` — calibration, registry, promotion, sweep, readiness | 59 |
| `tiers/` — labels, spaces, distributions, findings | 34 |
| `provenance/` — store, runner, audit, ordering | 38 |
| `modules/degree` — spec, prereg, blindness | 46 |
| `stats/` — BH, power, censored regression, p-values | 25 |
| `verify/` — exhaustive ANF | 12 |
| `reports/` lint, CI checks, documented commands | 28 |

### Mutation testing — 61 mutants, 0 survivors

core 8 · harness 11 · modules 7 · provenance 9 · reports 6 · stats 6 ·
tiers 9 · verify 5. Every layer meets the brief's minimum of five.

Three findings from the mutation runs themselves, worth recording because they
are how a validation harness silently degrades:

1. **Two proposed mutants were semantically equivalent**, not undetected
   defects — truncating the Keccak iota LFSR feedback leaves the low eight bits
   evolving identically because the dropped bit never feeds back; widening the
   modulus search to even tails changes nothing because those candidates are
   rejected one line later. Both replaced. Counting an equivalent mutant as a
   survivor would have sent someone hunting a test that cannot exist.
2. **A same-length mutant poisoned later runs through the bytecode cache.**
   `result ^= a` → `result |= a` restores to a file of identical size, and
   CPython validates a cached `.pyc` on source mtime at one-second granularity,
   so a stale `.pyc` survived the restore and failed unrelated tests afterwards.
   The harness now purges `__pycache__` on both sides of each mutation.
3. **One survivor was a real gap** — the Tobit likelihood dropping its censored
   term went undetected because the fixture censored only the top of the x
   range. Fixed by censoring across the whole range, where discarding censored
   rows attenuates the slope from 0.51 to 0.25.

### Structural checks — 5 passed

- `verify/` does not import `modules/`
- `modules/` does not import `verify/` (my addition — otherwise a module can
  verify itself)
- `reports/out/` contains no prose conclusions
- PREREG-M1's derived numbers are byte-equal to their derivation
- the provenance runner was committed **before** the pre-registration it stamps

### Primitive validation

| Primitive | Outcome |
|---|---|
| Keccak-f | bit-exact against `hashlib.sha3_256` and `shake_128` over 11 input lengths |
| Rho offsets, iota constants | derived from their definitions, no tabulated constants |
| GF(2^n) moduli | searched by Rabin's test; "lowest" verified against every smaller candidate |
| MiMC over GF(2^9) | permutation property verified exhaustively |
| Power map `x^d` | degree = wt(d) verified for **all 510 exponents** at n=9 |

### Control outcomes

| Control | Expected | Measured |
|---|---|---|
| `Ax` over GF(2), n=12 | 1 | **1** in every output bit |
| `x^31` over GF(2^11) | wt(d) = 5 | **5** |
| `x^3` over GF(2^11) | 2 | **2** |
| Random-oracle stand-in, n=12 | ≥ 11 | **≥ 11** |
| `x^(−1)` over GF(2^11) | n−1 = 10 | **10** |

The controls span the range rather than the endpoints: 1 → 5 → n−1.

---

## 5. Defects found and closed — 10

Nine surfaced by adversarial probing **after** the suite was green and every
mutant died. They shared one cause: an integrity rule stated in a docstring and
enforced only along the paths the tests happened to walk.

| # | Defect | Consequence if unfixed |
|---|---|---|
| 1 | Cross-tier `==` returned `False` while `<`/`>` raised | answered a question section 3 forbids |
| 2 | A "frozen" result's payload was editable in place | recorded results mutable after the fact |
| 3 | **Hash chain could not detect truncation** | records deleted from the end left a chain that verified perfectly |
| 4 | A NaN seed value corrupted every order statistic | one failed run silently poisoned median and IQR |
| 5 | `PowerMap.create(n, 0)` stated expected degree n | a calibration control with a wrong expected value |
| 6 | Target arity was a field defaulting to 0 | a measurement over zero variables returning a confident answer |
| 7 | Targets silently truncated out-of-range inputs | a complete, self-consistent, wrong degree, nothing raising |
| 8 | Prose lint missed phrases wrapped across a line break | banned conclusions passing into generated reports |
| 9 | A part-finished sweep cell was returned as complete | 40-of-50 seeds clearing the 30-seed floor, looking planned |
| 10 | Documented `-m` command double-imported and warned | the suite built twice; would fail under `filterwarnings=["error"]` |

Defect 3 is the most serious: a hash chain detects edits and insertions but not
truncation, because each record commits only to its predecessor. Closed twice
over — `run_end` declares the run's total length and must be the last record,
and `seal()` registers length and head hash in the run index for
`verify_against_index()`. The declared-count check earns its keep against a
re-chained forgery, where every hash was recomputed after a deletion but the
closing record still declares the original length.

Defect 10 was found only by running the documented reproduction sequence against
a fresh clone. It had been present since the first commit, invisible because
nothing tested the documentation. `tests/test_documented_commands.py` now runs
every documented command as a subprocess under `-W error` with stderr asserted
empty.

Each defect has a regression test and a mutant pinning it.

---

## 6. Substantive findings

Findings about the *problem*, not the code.

### The Tier S probe has no reach for Module 1

Computed before any data exists, from the pre-registered design:

| Quantity | Value |
|---|---|
| Detectable at 80% power, 50 seeds | 0.0317 |
| Guaranteed under H0 at probe dimension k | 2^−k |
| Highest k with ≥80% power | **4** |
| Highest k reaching BH's smallest critical value | **2** |
| Seeds to reopen k=16 | 468,882 |
| Seeds to reopen k=32 | 3.07 × 10^10 |

At the brief's preferred 50 seeds the sampled witness probe has no promotion
path above probe dimension 2. PREREG-M1 §9.1 closes it in advance and routes
Module 1 through Tier P and Tier E. This is DECISIONS.md D-010, and the
judgement I would most want overruled if you disagree.

### Section 5 requires an anchor the brief does not supply for three modules

Section 5 makes published ground truth a blanket precondition, and names an
anchor for M1, M3 and M5 only. M2, M4 and M6 have none anywhere in the brief.
Gate G06 fails for those three until you choose one.

### A requirement conflict for the prime-field targets

Section 4 defines Module 1's quantity as algebraic degree **over GF(2)**;
section 9 names Poseidon over KoalaBear and MiMC over BN254/BLS12-381 — prime
fields, where Boolean algebraic degree is not defined. There is no ANF over
GF(2) for a map F_p → F_p, and bit-embedding gives a quantity that is not the
one the AO literature disputes. MiMC over GF(2^n) is unaffected. The prime-field
targets need a separately pre-registered `d_Fp` metric.

Related gap: `tiers/` refuses cross-*tier* comparison but not cross-*metric*
comparison — `d_ub` and `d_Fp` would both be Tier P and would compare without
complaint.

### The blindness of the degree measure is structural

The multiplicative inverse over GF(2^n) has algebraic degree n−1 — the maximum
for a permutation — and is inverted by one field inversion, being described
exactly by `x·y = 1`. The demonstration runs against the **exact** reference
measure, not an approximation, so no future bounding argument in Module 1 can
remove it. Degree over GF(2) does not bound the degree of the implicit system
over the extension field.

---

## 7. Outstanding, by owner

**Operator**

1. Vendor the parametrised SHA-256 target — clears G01 on all six modules.
2. Transcribe two ground-truth values from ePrint 2010/589 and 2020/182, with
   table or theorem numbers. Both hosts are blocked by this environment's egress
   proxy; the failed fetches are logged. No plausible numbers were written from
   memory.
3. Choose published anchors for M2, M4, M6.
4. Confirm or overrule the Tier S closure (D-010) and the promotion threshold's
   dependency on an unverified citation (D-013).

**Build**

5. Module 1's measurement path — deliberately unwritten; the brief's stop point.
6. Modules 2–6.

---

## 8. Net position

The instrument is built, tested, calibrated as far as the available inputs
allow, and independently reproducible from its published branch. It returns
NO-GO on all six modules.

That outcome is the instrument working rather than failing: two of Module 1's
three blockers are absent inputs, and it refuses to run rather than substituting
something plausible for them. The ten defects found — nine of them after the
suite was green and every mutant had died — are the strongest available evidence
that the enforcement is real rather than documentary.

No module has been executed. Nothing has been run against a real target. The
brief's stop point stands until PREREG-M1 and the calibration suite have been
reviewed.
