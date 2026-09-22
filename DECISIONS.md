# DECISIONS

Every judgement call made in building the first deliverable, with the reasoning,
so it can be audited and overridden. Prime directive 2.2: judgement is not buried
in code.

Format: decision, what was chosen, why, what it costs, and how to reverse it.

Open questions for the operator are collected at the end, in section Q. Four of
them (Q1, Q2, Q3, Q7) block work that has already been specified.

---

## D-001 — Location: a subdirectory of an unrelated repository

The repository this session was given (`punkrockquantum/JRRToken`) contains an
unrelated project (an AI-infrastructure simulator). The brief specifies a
top-level package layout. Putting `core/`, `tiers/`, `modules/` and the rest at
the repository root would collide with that project's files and would make the
CI checks ambiguous about what they are scanning.

Chosen: everything lives under `algebraic-probe/`, with the section 10 layout
reproduced verbatim inside it. `algebraic-probe/` is the rootdir for pytest and
for `scripts/ci_checks.py`.

Cost: import paths are relative to `algebraic-probe/`, not the repository root.
Reverse: move the directory contents up one level and delete the `pythonpath`
entry in `pyproject.toml`.

---

## D-002 — The primary target is absent, and says so rather than being rewritten

Section 9 directs that the validated parametrised SHA-256 implementation from
`sha256-testbed` be reused and not rewritten, and that its validation suite be
re-run here. That repository is not reachable from this session: GitHub access is
scoped to `punkrockquantum/jrrtoken` only.

Chosen: `core/sha256.py` exists and raises `NotAuthorised`, listing the four
things that must happen before a SHA-256 target may be used (vendor the core,
re-run the FIPS 180-4 vectors here, assert bit-identity with `hashlib` at 64
rounds, record the upstream commit id). PREREG-M1 lists this as a blocking
precondition.

Rejected: writing a fresh parametrised SHA-256 here. A second implementation
would have to be validated from scratch, and the brief explicitly says not to.

Reverse: vendor the code, delete the stub, and satisfy the precondition.

---

## D-003 — Literature citations are UNVERIFIED and hard-block their cases

Prime directive 2.1 requires that a cited number be traceable to the source. The
network egress policy of this environment blocks the hosts carrying the relevant
papers. Attempts made on 2026-08-24, all returning `EGRESS_BLOCKED`:

- `https://eprint.iacr.org/2010/589.pdf` (Boura-Canteaut-De Cannière)
- `https://eprint.iacr.org/2020/182.pdf` (Eichlseder et al.)
- `https://inria.hal.science/inria-00537741` (the same paper's HAL record)

Search-engine result pages were reachable and were used to establish the
*bibliographic* records (authors, titles, venues, ePrint numbers). They were not
used for any numeric claim; a search snippet is not a primary source.

Chosen: `tiers.provenance.Citation` carries a `verification` field with three
states, and the state describes the *number relied on*, not the paper's
existence. `Verification.UNVERIFIED` on a citation blocks every calibration case
whose expected value depends on it, through
`harness.calibration.CalibrationSuite.gate`. Module 1 is therefore blocked, by
design, until the numbers are transcribed.

Rejected: writing plausible values from memory and marking them as citations.
That is exactly the failure the brief was written to prevent, and a model's
recollection of a table is not a source.

Reverse: read the values from the papers, set `verification` to
`PRIMARY_SOURCE`, and replace `PENDING_PRIMARY_SOURCE` with the numbers (D-009).

---

## D-004 — Standard library only; no numpy, scipy, or any third-party package

The build host has neither numpy nor scipy. Installing them is possible (PyPI is
reachable) but every added dependency is a reproducibility surface: a result that
depends on a BLAS version is a result whose provenance includes a number nobody
recorded.

Chosen: `stats/` is written out — normal pdf/cdf/quantile via `math.erfc` plus a
refined rational approximation, BH step-up, exact binomial power formulas, OLS in
closed form, and Tobit maximum likelihood over a deterministic Nelder-Mead
implemented in `stats/optimize.py`. Each is pinned against hand-computable values
or against a simulation with known generating parameters.

Cost: the Tobit fit is slower and less robust than a library optimiser, and the
Nelder-Mead has no gradient information. Mitigated by a fixed two-pass simplex
schedule (deterministic, no random restarts) and by
`tests/test_stats_power_censored.py`, which recovers a known slope from censored
data and shows naive OLS attenuated relative to it.

Reverse: swap the internals of `stats/censored.py`; the public shape
(`fit_both` reporting both fits and their percentage divergence) does not change.

---

## D-005 — An exact ANF utility exists; Module 1's measurement path does not

The brief says not to write attack code yet, and also asks to be shown a
calibration suite and what it will assert. Those pull against each other: a
calibration case whose expected value is "wt(d)" is only provenance-carrying if
something in the repository actually recomputes it.

Chosen: `verify/anf.py` implements the exhaustive path — truth table, Moebius
transform, degree, higher-order derivative — under a size guard of 24 variables.
It is used by the control-validation tests and by the blindness demonstration.
Module 1's own measurement path (division property, monomial prediction,
round-parametrised bound propagation) is **not** implemented:
`modules/degree/spec.py` registers `measure=None`, and
`CalibrationSuite.run(None)` raises `NotAuthorised`.

The line drawn: a generic exhaustive reference measure is instrument
infrastructure; a bounding argument specialised to a target's round function is
the module, and that is what is deferred.

Reverse: none needed; implementing Module 1 means adding
`modules/degree/measure.py` and setting `SPEC.measure`.

---

## D-006 — The import ban between `verify/` and `modules/` runs both ways

Section 10 asks for a CI check that `verify/` does not import `modules/`. That
alone leaves the circularity open in the other direction: if a module calls
`verify.anf` for its own measurement, then "verified by `verify.anf`" is a
restatement, not a verification.

Chosen: `scripts/ci_checks.py` enforces both directions.
`modules/degree/blindness/inverse_map.py` therefore takes its measure as an
injected callable, and `tests/test_blindness_inverse.py` supplies
`verify.anf.algebraic_degree`.

Cost: a small amount of plumbing at every point where a module wants a reference
value.

---

## D-007 — The forbidden-term list is longer than the six words in the brief

Section 2.2 names `unlikely`, `as expected`, `promising`, `negligible`,
`confirms`, `suggests`. Those six leave `likely`, `indicates`, `clearly`,
`we conclude` and about twenty near neighbours doing the same work.

Chosen: `reports.lint.BRIEF_FORBIDDEN` holds the brief's six exactly;
`EXTENDED_FORBIDDEN` holds the additions, separately, so the extension is visible
and can be deleted in one edit. The lint scans generated files under
`reports/out/` only.

---

## D-008 — Keccak-f and MiMC are implemented; they are targets, not attacks

Section 5 requires a calibration target "with published exact degree values — a
small-state AO permutation or a reduced block cipher where the literature states
degree per round". A calibration suite that names a target it cannot construct is
a placeholder.

Chosen: `core/keccak.py` implements Keccak-f parametrised by lane width and round
count, with the rho offsets derived from the (x,y) <- (y, 2x+3y) recurrence and
the iota constants derived from the 8-bit LFSR — no tabulated constants. Its
bit-exactness is established by a SHA-3 sponge asserted equal to
`hashlib.sha3_256` and `hashlib.shake_128` over eleven committed input lengths.
`core/mimc.py` implements MiMC over GF(2^n) with the cube map.

This is the same category as the control functions: a primitive under
measurement, not a technique applied to one.

---

## D-009 — `PENDING_PRIMARY_SOURCE` rather than a placeholder number

A calibration case can be fully specified — target, quantity, comparator,
assertion text, rationale — before its expected value has been read from the
source. Writing `expected=42` "to be corrected later" puts an unattributed number
into the repository.

Chosen: a sentinel. `CalibrationSuite.gate()` blocks on it with the reason
"must be transcribed from the primary source", and the manifest prints the
sentinel where the number will go.

---

## D-010 — Module 1's Tier S probe is pre-registered as non-promoting above k = 2

This is the largest judgement call in the deliverable, and the one most worth
overriding if the reasoning is wrong.

The natural Tier S cell for a degree module is: draw N random k-dimensional
affine subspaces, sum the target over each, and look for a non-zero sum. A
non-zero sum is a deductive proof that the degree is at least k, so a witness is
Tier P, not Tier S. The Tier S object is the *absence* of a witness.

Under the null (true degree = k) the per-draw witness probability is at least
2^-k, by Schwartz-Zippel over GF(2) applied to the non-zero degree-k multilinear
form. Under the alternative (degree < k) it is exactly 0. So the design's power
is governed by 2^-k, and at the brief's preferred 50 seeds:

- smallest per-draw probability detectable at 80% power: 0.0317
- so 80% power holds only for k <= 4 (2^-4 = 0.0625, 2^-5 = 0.03125)
- reaching the BH family's smallest critical value 0.05/64 needs p >= 0.133,
  so only k <= 2
- reopening k = 16 would need 468882 seeds per cell; k = 32 needs 3.07e10

Chosen: PREREG-M1 section 9.1 states, before any data exists, that a Tier S cell
at probe dimension 3 or above has no promotion path at 50 seeds, and that its
null is recorded as INCOMPLETE-by-design rather than as a NEGATIVE. Module 1's
promotion path is Tier P and Tier E.

Rejected: raising the seed count until the probe has power. The seed counts
required are outside any budget, and pretending otherwise would manufacture
exactly the false-positive machinery section 3.1 warns about.

Rejected: quietly running the probe and reporting "no witness found" as a
negative. Without the mechanism and a blindness test that is an INCOMPLETE, and
with the power figures above it would be an INCOMPLETE that looks like a result.

This is Q2 below: the brief mandates the Tier S apparatus per module, and for
Module 1 the honest answer is that the apparatus has no reach. Confirm or
override.

---

## D-011 — Effect floor: one bit of algebraic degree

Applied to `d_ub(r) - d_lb(r)`, the gap between the certified upper bound and the
best witnessed lower bound. Degree is integer-valued, so 1 is the smallest
representable non-zero gap, and one bit of gap halves the data complexity of the
implied higher-order differential. No power calculation chose this number; the
representable-quantum argument did.

---

## D-012 — Family size: 64

One Tier S cell per round of the primary target, r = 1..64. Fixed in PREREG-M1
and asserted at analysis time — `stats.bh.benjamini_hochberg` raises if the
number of tests presented differs from the declared family size, rather than
correcting across whatever happened to finish.

Alternative considered: a family per (round, probe dimension) pair, which would
put the family size in the thousands and make the smallest critical value smaller
still. Rejected as making D-010 worse without adding information.

---

## D-013 — Feasibility ceiling 2^63.1, and its dependency

`T2_feasibility` says an implied distinguisher does not promote if its data
complexity exceeds the largest published practical hash computation, taken as the
2^63.1 SHA-1 compression calls of the SHAttered collision.

The number depends on `CITE-SHATTERED`, whose verification state is UNVERIFIED
(D-003). Until it is checked, the threshold is a declared budget with a named
source rather than a sourced number.

If the operator prefers a threshold that needs no citation, the alternative is a
declared compute budget for this project, stated in the same units. That is a
policy choice, not a measurement, which is why it is here rather than in code.

---

## D-014 — Memory-access cost is measured on the run host, not assumed

Section 7.3 requires memory-access cost in every comparison.
`harness.promotion.CostComparison` therefore takes `access_cost_in_ops` as a
parameter and refuses to be constructed without a derivation string for it;
`scripts/measure_memory_cost.py` measures it as the ratio of one uncached random
read to one SHA-256 compression on the host.

Known limitation, recorded in the script's own output: the access loop is written
in Python and carries interpreter overhead, so the measured ratio is an artefact
of the harness as much as of the memory hierarchy. A promotion that turns on this
ratio needs a measurement in a compiled harness. Flagged rather than hidden.

---

## D-015 — Ordering by git ancestry, and the two-commit structure

Section 8 requires that the runner performing the commit-embedding was itself
committed before the pre-registration it references, and that the ordering be a
hash chain rather than a timestamp claim.

Chosen: `PreRegistration.assert_runner_precedes` takes the commit that *added*
`harness/runner.py` (`git log --diff-filter=A`) and the commit that added the
pre-registration, and requires the first to be a strict ancestor of the second
via `git merge-base --is-ancestor`. Same-commit introduction is refused
explicitly, because an ordering claim about two files in one commit is empty.

The deliverable is therefore committed in two commits: infrastructure first
(including the runner), then Module 1's pre-registration and calibration.

Limitation: ancestry is a property of the history as it currently stands. A
rebase or a filter-branch rewrites it. The check detects a *missing* ordering,
not a rewritten one.

`PREREG-M1.md` was edited once after the commit that introduced it, to stop the
field parser reading the same key from two places. No run existed at that point,
so no result's embedded `prereg_sha256` refers to the earlier text. Any edit
after the first run would be a different matter: the auditor would report a
`prereg_sha256` deviation on every earlier run, which is the intended behaviour
and not something to work around.

---

## D-016 — What content-addressing does and does not prove

`ResultsLog.seal()` registers each run log's SHA-256 in a per-prereg index and
refuses to seal a log byte-identical to a different run's. Combined with the
per-record hash chain, this catches a log copied wholesale and re-labelled, and
catches any post-hoc edit to a record.

It does not catch a copied log with one byte perturbed. Nothing content-based
can. The check is worth having because the failure it catches is the one that
actually happened before; it is not a proof of independence.

---

## D-017 — `reports/` is both the package and the output directory

Section 10 describes `reports/` as generated output. It also has to hold the
lint. Generated files go in `reports/out/`; the lint scans that subtree only, so
a docstring in `reports/lint.py` explaining why a word is banned does not trip
the check on itself.

---

## D-018 — Pre-registrations and this file are not lint-scanned

`PREREG-M1.md` states hypotheses and derivations in words, and this file is
entirely reasoning. Section 2.2 bans prose conclusions in *reports* — statements
about what the measurements mean. A pre-registration is written before any
measurement exists and cannot contain a conclusion about one.

If the operator wants the ban to extend to pre-registrations, `lint_paths` takes
an arbitrary file list and `scripts/ci_checks.py` is one line from enforcing it.

---

## D-019 — Exhaustive verification guard at 24 variables

`verify.anf.MAX_EXHAUSTIVE_VARS = 24` (2^24 truth-table entries). Above it the
functions raise `ExhaustionRefused` rather than falling back to sampling: a
verifier that silently degrades to an estimate is worse than one that stops.
Raising the guard is a deliberate edit, and this line is the record that it was
24 to begin with.

---

## D-020 — Control sizes

`n` between 9 and 12 for the controls. Large enough that an intermediate degree
(5) is genuinely intermediate and that the negative control's by-chance failure
probability is small (2^-13 per output bit at n = 12); small enough that every
control's expected value is checked by full exhaustive ANF inside a test suite
that runs in under a minute. `tests/test_core_targets.py` checks *every* exponent
at n = 9 for the power map rather than a sample.

---

## D-021 — Intermediate control: the power map, deg(x^d) = wt(d)

Section 5 asks for an intermediate control where possible. The power map over
GF(2^n) gives an exact, analytically known, tunable degree anywhere in
[1, n-1] by choosing the Hamming weight of the exponent, and x^3 is also the MiMC
round function, so the control sits on the path to the section 9 secondary
targets rather than off to one side.

The prior work's intermediate control recovered known correlation lengths to
within 3%; this one is exact, and is checked for all 510 exponents at n = 9.

---

## D-022 — Blindness class: the multiplicative inverse over GF(2^n)

Section 6(b) needs a concrete function class with the property being searched for
that still produces the null. For a degree instrument the null is "degree
saturated, no higher-order differential of feasible order".

`x -> x^(2^n - 2)` has algebraic degree n-1, the maximum for a permutation, so
the instrument returns the saturated null. The same function is described exactly
by the single quadratic relation `x*y = 1` and inverted by one field inversion.
The blindness is a property of the quantity, not of any approximation to it,
which is the strongest form the demonstration can take: it holds even against the
exact reference measure.

A second blindness class is available and not yet implemented: any prime-field
design (MiMC or Poseidon over F_p) where the Boolean degree is not the operative
notion at all. That one is Q7 below.

---

## D-023 — A witnessed lower bound is Tier P, not Tier S

A single non-zero k-th order derivative proves the degree is at least k
deductively; nothing about it is sampled, even though a random search found it.
The seed that found it is provenance, not evidence. The *failure* to find one is
the sampled object. Routing these to different tiers is what makes D-010's
analysis possible at all.

---

## D-024 — Mutation testing as a scripted, committed harness

Section 8 requires at least five deliberate defects per module, each confirmed
caught. `scripts/mutation_test.py` holds the mutant catalogue as explicit
source-text substitutions with the test selection expected to kill each one,
applies them one at a time, runs the selected tests, and restores the file. The
catalogue is committed, so a mutant that stops being caught is visible in a diff.

Per-mutant test selection rather than the whole suite: the suite takes ~40
seconds, and 48 mutants at full-suite cost would make the check something nobody
runs.

Current state: 48 mutants across 8 layers, at least five per layer, all killed.

Two things the first run turned up, recorded because they are the kind of thing
that silently degrades a validation harness:

*Two proposed mutants were semantically equivalent, not undetected defects.*
Truncating the Keccak iota LFSR feedback from `0x171` to `0x71` leaves the low
eight bits of the register evolving identically, because the dropped bit never
feeds back; and widening the modulus search from odd tails to every tail changes
nothing, because a polynomial with zero constant term is rejected by the
divisibility guard one line later. Both were replaced with mutants that alter
behaviour. A test suite cannot kill an equivalent mutant, and counting one as a
survivor would have sent someone hunting for a missing test that does not exist.

*A same-length mutant poisoned later runs through the bytecode cache.* Replacing
`result ^= a` with `result |= a` restores to a file of identical size, and
CPython validates a cached `.pyc` on source mtime with one-second granularity, so
a stale `.pyc` compiled from the mutated source survived the restore and made
every subsequent run fail in unrelated places. `apply_mutant` now purges
`__pycache__` on both sides of the mutation and runs pytest with
`PYTHONDONTWRITEBYTECODE=1`. Without that, a mutation harness silently corrupts
the results of everything that follows it.

*One survivor was a real gap.* Dropping the censored-observation term from the
Tobit likelihood was not caught, because the original fixture censored only at
the top of the x range: the surviving uncensored subsample was barely truncated,
so a fit that discarded censored rows still recovered the slope. The fixture now
censors across the whole range (86 of 120 observations), where discarding them
attenuates the slope from 0.51 to 0.25, and a test asserts that difference
directly. This is the mutation harness doing the job it exists for.

---

## D-025 — A single global registry

`harness.registry.REGISTRY` is a module-level singleton, populated by import side
effect in each module's `spec.py`. Registration is idempotent for the same object
and raises on a conflicting re-registration. Tests that need isolation construct
their own `Registry()`.

---

## D-026 — Holdout rounds 53-64

Section 8 requires that a criterion changed after seeing data be evaluated
out-of-sample. That is only possible if unseen cells are reserved before the
first run. The last twelve rounds are reserved in PREREG-M1 as `holdout_rounds`;
they are the rounds furthest from where reduced-round results exist, so reserving
them costs the least information in the region the instrument is most likely to
say something about.

---

## D-027 — Run logs and generated reports are committed

Section 8: "Run logs are committed, not gitignored." `.gitignore` covers
`__pycache__`, `.pytest_cache` and `*.sqlite-journal` only. `runs/` and
`reports/out/` are tracked.

---

---

## D-028 — Nine integrity defects found by adversarial probing, and closed

The test suite passed and every mutant died while nine real holes were open.
They shared one cause: an integrity rule stated in a docstring and enforced only
along the paths the tests happened to walk. Recorded because the *pattern*
matters more than the individual fixes.

1. **Cross-tier equality answered a forbidden question.** `<` and `>` raised
   across tiers; `==` returned `False`. Comparing a Tier P result to a Tier E
   one is refused now, including through `in`, which uses `__eq__`. Non-Result
   operands still compare normally so collections behave.
2. **A "frozen" result's payload was editable in place.** `frozen=True` protects
   the field binding, not the dict behind it. Payloads are `MappingProxyType`
   over a deep copy, and `to_dict()` hands out a copy rather than the live
   mapping.
3. **The hash chain could not see truncation.** Each record commits to its
   predecessor, so removing records from the *end* leaves a shorter chain that
   verifies perfectly — a result and the `run_end` marker could both be deleted
   silently. Closed two ways: `run_end` declares the run's total length and must
   be the last record, and `seal()` registers length and head hash in the run
   index, which `verify_against_index()` cross-checks. The auditor now calls it.
   The declared-count check earns its place on a re-chained forgery, where every
   hash was recomputed after a deletion but the closing record still says four.
4. **A NaN seed value corrupted every order statistic.** `sorted()` places NaN
   arbitrarily and `min`/`max` propagate it, so one failed run silently poisoned
   the median and the IQR. Non-finite values are refused, naming the seed: a run
   that produced no number is censored or failed, not a sample.
5. **A control stated a wrong expected value.** `PowerMap.create(n, 0)` reported
   expected degree `n` — the reduction that handles exponents which are
   multiples of `2^n - 1` maps `0` to `2^n - 1` — while `x^0` is the constant 1,
   of degree 0. A control with a wrong expected value is worse than no control,
   so the zero exponent is refused.
6. **Target arity was a stored field defaulting to zero.** Only the `create`
   factories set it, so a hand-constructed target declared `n_in = 0` and a
   measurement over zero variables would have returned a confident answer about
   nothing. Arity is a derived property on every target now.
7. **Targets silently truncated out-of-range inputs.** Keccak-f masked a 26-bit
   input onto 25 bits. An exhaustive walk of `range(2**n)` with a wrong `n`
   would have produced a complete, self-consistent, wrong degree with nothing
   raising anywhere — the worst failure mode this instrument has. Every target
   validates its input; `RandomFunction` already did, and the inconsistency was
   the tell.
8. **The prose lint missed wrapped phrases.** Multi-word terms matched a single
   literal space, so `as expected` split across a line break — exactly how it
   would appear in a generated report — passed. Terms now join on `\s+` and the
   text is scanned across line boundaries as well as line by line.
9. **A part-finished sweep cell was returned as complete.** `results()` returned
   whatever had finished; a cell with 40 of 50 seeds cleared the 30-seed floor
   and became a Tier S sample that looked planned. Reading an incomplete cell is
   now a deliberate act (`require_complete=False`).

Each has a regression test in `tests/test_integrity_regressions.py` and a mutant
in the catalogue: 58 mutants, all killed; 357 tests.

The general lesson for the modules still to be built: an invariant is only as
strong as the narrowest path that enforces it, and a test suite written
alongside the code tends to walk the paths the author had in mind.

---

# Q — Open questions and flagged requirements

## Q1 — BLOCKING. The published ground truth for Module 1 needs transcribing

Two calibration cases (`CAL-M1-GT-KECCAK-*`, `CAL-M1-GT-MIMC-*`) are declared,
their targets are implemented and validated, and their expected values are
`PENDING_PRIMARY_SOURCE` because the sources are unreachable from here (D-003).

What is needed: the per-round algebraic degree bounds for Keccak-f from
Boura-Canteaut-De Cannière (ePrint 2010/589), and the degree-growth statement for
r-round MiMC over GF(2^n) from Eichlseder et al. (ePrint 2020/182), read from the
papers, with the table or theorem number.

Until then Module 1 is blocked by section 5's hard block, and correctly so.

## Q2 — BLOCKING-ish. Module 1 has no Tier S reach; is the pre-registered closure accepted?

See D-010. The full apparatus (BH over a declared family, effect floor, censored
regression, 50 seeds) is implemented and tested, and the power analysis run
before any data says it cannot reach the regime Module 1 operates in. The
pre-registration commits to that in advance rather than discovering it later.

Confirm the closure, or specify a different Tier S cell for Module 1 that has
power at achievable seed counts.

## Q3 — BLOCKING. The primary target is not present

D-002. Nothing in this deliverable touches SHA-256. The four preconditions are
listed in `core/sha256.py` and in PREREG-M1 section 3. This needs either access
to `sha256-testbed` or an explicit instruction to vendor a fresh implementation
and validate it here.

## Q4 — The brief's calibration pointers for Modules 3 and 5 are unverified

Section 5 gives 31-step collisions and 38-39-step semi-free-start collisions for
SHA-256, and 45-52-step preimages, as pointers rather than authority. They have
not been checked here, for the same egress reason. When those modules are built
their citations will start in the same UNVERIFIED state.

## Q5 — Requirement I believe is technically wrong as stated, for the secondary targets

Section 4, Module 1 defines the quantity as "the algebraic degree of output bits
in the input variables over GF(2)". Section 9 then names Poseidon over KoalaBear
(a prime field, p = 2^31 - 2^24 + 1) and MiMC over BN254 and BLS12-381 (prime
fields) as secondary targets.

Boolean algebraic degree is not defined for a function on F_p with p not a power
of 2. There is no ANF over GF(2) for a map F_p -> F_p; embedding it in a bit
representation gives a quantity that is not the one the AO literature disputes,
which is the univariate degree over F_p, the degree of the Groebner-basis system,
or the degree of the polynomial representation after the exponent map.

This does not affect the GF(2^n) instances (MiMC over GF(2^n) is fine, and is what
`core/mimc.py` implements). It does mean Module 1 as specified cannot be pointed
at Poseidon over KoalaBear or at MiMC over BN254/BLS12-381 without a second,
differently-defined metric.

Proposal, not yet built: a companion metric `d_Fp(r)` — the degree of the
univariate polynomial representation over F_p, and the degree of the lowest-degree
implicit polynomial system — pre-registered separately, with its own tier routing
and its own calibration. It would share the harness and share nothing else with
`d_ub`, and results in the two metrics must not be compared, which the tier system
does not currently prevent because they are both Tier P.

That last point is a gap: `tiers/` prevents cross-tier comparison but not
cross-metric comparison. If you want that too, say so and it becomes a
`metric_family` field with the same refusal semantics.

## Q6 — Section 8's byte-identity test has a narrow reach

D-016. Worth knowing what it does not catch.

## Q7 — Ordering claims survive only an unrewritten history

D-015. If the workflow involves rebasing feature branches, the
runner-precedes-prereg assertion becomes a claim about the rebased history rather
than about when things were actually written. Squash-merging this branch would
collapse both commits into one and break the check outright. Recommend a merge
commit, or moving the ordering assertion to a signed, dated record outside git.

## Q8 — The prior work's numbers quoted in the brief are treated as context, not data

Section 1's figures (0.062 per round, the 239% censoring shift, the 10,000x
SAT/brute-force ratio, the 3% intermediate-control agreement) are not reproduced
in this repository and are not cited anywhere in it. They shaped the design; they
are not numbers this instrument emits. If any of them should appear in an output,
they need a citation key pointing at `sha256-testbed` with a commit id.

---

## D-029 — Stage A: the MiMC bound path is sound and loose, not defective

The autonomous completion brief ordered Stage A first on the hypothesis that the
d_ub/d_exact divergence might be a defect invalidating everything above it. It is
not. Each step of the propagation is a valid inequality (Frobenius is linear;
deg(a·b) ≤ deg a + deg b), and `d_ub ≥ d_exact` holds at every measured point
across n ∈ {9,11,13}, r ∈ [1,7]. Class 1 does not apply.

Both models stated in advance were refuted as predictors. MODEL-P (pure power,
`wt(3^r mod 2^n−1)`) predicted a non-monotonic drop at r=4 which did not occur —
measured 4, predicted 3 — so MODEL-P is not even an upper bound. MODEL-C
(constant contamination) is sound but overshoots by 1–3 bits. Measured values lie
strictly between at every point. The data separates them, so Class 4 does not
apply.

`mimc_derived_bound` implements MODEL-C as a certified path: the exponent support
after r rounds lies in [1, min(3^r, 2^n−1)], deg(x^e) = wt(e), and the degree of a
sum is at most its largest term's. Mean gap at n=13 falls from 3.71 to 0.86.

Both paths are retained and reported per round. The naive one is not deleted: it
is the bound a reader would expect, and showing the derived one beside it is what
makes the improvement checkable rather than asserted.

## D-030 — the derived bound is not substituted for the published anchor

Stage A produced a sound MiMC bound in-repo. It is not used to satisfy
`CITE-EGLORSW20`. The completion brief's Class 2 forbids substituting a
self-derived value for a published anchor, and the original brief's §5 requires
the module to reproduce a *published* value before it is trusted on anything new.
`mimc-gf2n[9]` therefore remains T02-blocked despite the repository now
containing a better bound than the naive one. That is the gate working.

## D-031 — Stage D order deviates from the completion brief

The completion brief §5 orders M2 first. M2's subject is SHA-256's message
schedule, which is unavailable (ESCALATIONS E-03). Taking M4's AO arm first, and
recording M2/M3/M5/M6 as blocked, delivers work that is actually reachable
instead of idling. Deviation recorded here as the brief instructs; the ordering
is a sequencing choice and changes no result.

## D-032 — where the two briefs conflict, the original wins

The completion brief restates several rules loosely ("no prose conclusions",
"nulls require a blindness proof"). Where wording differs, the original brief's
formulation is the one enforced in code, and the code was not changed to match
the restatement. One substantive conflict: the completion brief §0 forbids
characterising a result as "negative", while the original §6 defines NEGATIVE as
a formal status with mechanism, blindness statement and passing blindness test.
Resolution: the formal status label `NEGATIVE` in `tiers/finding.py` is retained,
since it is a structured epistemic state and not a characterisation; the *prose*
word remains banned in reports by the lint. Recorded rather than silently
reconciled.

## D-033 — a test must not corrupt the provenance of what runs after it

Found by re-running the documented reproduction on 2026-09-17.

`test_the_report_renderer_writes_every_declared_report` ran the real renderer,
which wrote into the tracked `reports/out/`. Three committed files were rewritten
with a fresh commit stamp, so the working tree was dirty from that point on, and
any provenance run executed afterwards recorded `working_tree_clean=False` and
was reported non-compliant by the auditor.

Diagnosed by bisecting the suite file by file: exactly one test file dirtied the
tree, and it dirtied exactly three files.

Chosen: `render_reports.py` and `synthesis.py` take `--out-dir`, and the suite
renders into a temporary directory. Three guard tests were added — one asserting
the tracked directory is byte-identical before and after rendering elsewhere, one
for the synthesis script, and one that the registry report lists every registered
module. A mutant (`RPRT-07`) pins the switch by making the renderer ignore it.

Rejected: leaving it and treating `working_tree_clean` as advisory. The field
exists to say whether the embedded commit describes the code that ran, and a
suite that falsifies it makes every later run unattributable.

Two things worth recording about the repair itself. An early draft of the
registry-report guard wrote into `reports/out/` and re-introduced the very defect
it sat beside; it was caught by re-running the dirty-tree check rather than by
reading the diff. And a `git checkout -- .` used to reset state mid-repair
reverted the uncommitted fix, which had to be reapplied — the fix is now
committed before any further git operation.

Also fixed in passing: `render_reports.py` imported only Module 1's spec, so the
registry report said `modules=1` while two modules were registered. It now
imports both and reports `modules=2`. That was a reporting gap introduced when
Module 4 was added in Stage D and not caught because nothing asserted the count.

---

## D-034 — a second exhaustive path, with a higher guard, rather than a raised guard

`verify/anf.py` stores one Python integer per truth-table entry and refuses above
`MAX_EXHAUSTIVE_VARS = 24`. Keccak-f[25] has 25 free bits. Raising that constant
would not have worked: 2^25 boxed integers per output bit, over 25 output bits,
is on the order of 7 GB.

Chosen: a second file, `verify/packed.py`, holding one bit per input in a single
integer, with its own guard `MAX_PACKED_VARS = 26`. The same mathematics — a
Moebius transform and a maximum Hamming weight — carried out on 4 MB integers
instead of Python lists. The guard's value is derived from what the computation
holds live, not picked: a column is 2^n bits, a full evaluation needs on the
order of 60 live columns plus n+1 weight masks, so n = 26 is about 700 MB.

Rejected: raising `anf.py`'s guard and rewriting it to be packed. `anf.py` is the
reference path that the module is calibrated against, and rewriting it for speed
would mean the reference and the thing under test were both new. The old path is
untouched, and `tests/test_verify_packed.py` pins the new one against it on
eleven targets, per output bit rather than on the maximum.

The Keccak evaluation needed its own file for the same reason. `verify/keccak_columns.py`
writes the step wiring out a second time rather than importing `permute`, so it
is a second reading of the specification; the rho offsets and iota constants are
imported, because those are already anchored by `core.keccak.sha3_256` matching
`hashlib.sha3_256`, and re-deriving them would add a derivation to check rather
than a check. `tests/test_verify_keccak_columns.py` asserts the two agree at
every input of a fixed sample, at five round counts, and that zero rounds is the
identity.

## D-035 — an exhaustive ground truth is not a published anchor, and is not accepted as one

`CaseKind.EXHAUSTIVE_GROUND_TRUTH` is a new calibration case kind: the exact
value over the target's complete input space, computed in this repository.
Fifteen such cases now run for Module 1 and all fifteen pass.

The question this decision settles is whether such a case may stand in for the
`PUBLISHED_GROUND_TRUTH` case that section 5 requires, which would unblock
Module 1's calibration gate without the two citations.

Chosen: no, and the refusal is enforced rather than documented. The two kinds
answer different questions. A published anchor asks whether this repository
agrees with an independent party. An exhaustive computation asks whether the
instrument agrees with the truth about the function *as this repository
implements it* — and cannot detect an error shared by the instrument and the
target implementation, which is the failure the published anchor exists to
catch. `CalibrationSuite.__post_init__` still requires a published case, mutant
`EXHT-02` pins that by swapping the requirement for the exhaustive kind, and
`tests/test_exhaustive_truth.py` asserts the gate blocks on exactly the same two
citations, with the same reasons, as before these cases existed.

What the cases are worth despite that. They are the first falsifiable check on
the symbolic propagation rules that does not depend on a citation: the exact
degree is computed without reusing any part of the bounding argument, so a rule
that undercharges a non-linear step produces a bound below the truth and fails.
The comparator is `AT_LEAST` against the exact degree — soundness — and not
equality, because a sound bound is permitted to be loose, and a case demanding
gap = 0 would assert a result rather than check one.

They run under `run_controls`, which already excludes only the published cases,
so no gate logic changed to let them execute.

Whether the gate should ever recognise such a substitution is not mine to
decide: ESCALATIONS.md E-09.

## D-036 — two identified equivalent mutants, and two real gaps they exposed

`VRFY-08` was first written as replacing the zero-coefficient guard in
`degree_of_column` with `if False`. It survived, and it survived because it is
semantically equivalent: with the early return gone, the weight loop falls
through to the same `return -1`. The redundancy is real and the guard only
avoids building the weight masks, so the mutant was changed to alter the returned
*value* — the part that carries behaviour — and is killed. This is the third
equivalent mutant identified in this repository rather than treated as a test
gap; the pattern each time has been a guard whose removal is covered by a later
path.

`EXHT-03` and `EXHT-05` survived for the opposite reason, and were real gaps. Both
mutate a check that only fires when something is wrong: the cross-check of the
bitsliced evaluation against `core.keccak.permute`, and the computation of the
recorded `sound` field. Nothing was wrong, so disabling either was invisible.
Fixed by making something wrong on purpose — the runner is imported in-process,
its evaluation is replaced with a function that returns the wrong answer, and its
bound is replaced with a deliberately unsound one. Both mutants are now killed.

The general point, worth keeping: a guard with no negative test is unexamined
code that happens never to trigger, and a mutation run is how that becomes
visible.

---

## D-037 — the witness probe is calibrated against known truth, and D-010 is not reopened by it

The exhaustive arm (D-034) produced something this repository did not previously
have: targets whose exact algebraic degree is known over their complete input
space. That makes the sampled witness probe measurable against truth rather than
against its own model. `scripts/witness_calibration.py`, computation
`M1-WITNESS-CAL-001`, 52 cells, 50 seeds each.

**The deductive arm.** Degree exactly d means every derivative of order d+1
vanishes identically, so at k > d the probe must never witness, for any seed.
15 cells sit above the exact degree, 750 draws in total, and the witness count is
0 in every one. This is falsifiable — a single witness there would contradict a
theorem, not represent an unlucky draw — and it is the first check of the Tier S
machinery against ground truth.

**The sampled arm, and what it shows.** PREREG-M1 section 9 models the per-draw
witness probability by its Schwartz-Zippel worst case, 2^-k. Measured, at
k equal to the exact degree:

| Target | rate | worst case | ratio |
|---|---|---|---|
| linear-map-gf2 n=13 | 1.00 | 0.5 | 2× |
| power-map d=7 | 1.00 | 0.125 | 8× |
| power-map d=31 | 1.00 | 0.03125 | 32× |
| power-map d=4095 | 0.62 | 0.000244 | 2540× |
| keccak-f[25] r=2 | 1.00 | 0.0625 | 16× |
| keccak-f[25] r=3 | 1.00 | 0.00390625 | 256× |

In all 37 cells at or below the exact degree, the Clopper-Pearson lower bound
exceeds the worst case.

**Chosen: change nothing.** D-010 closes the Tier S promotion path above probe
dimension 2, and it stays closed. Three reasons, in order of how much they
matter:

1. These rates were measured on targets whose degree I already knew. The
   promotion case is a target whose degree is unknown — that is the entire reason
   a probe is needed — and a rate measured under knowledge is not evidence about
   a rate measured without it.
2. The targets here are structured: power maps and Keccak at one to three
   rounds, all far from saturation. The regime D-010 was drawn for is the
   opposite one, where the top-degree part is sparse and the probe is at its
   weakest. Nothing measured here samples that regime.
3. Revising a pre-registered threshold after seeing data that favours revising it
   is the prohibited act, whatever the margin. The completion brief's route for a
   changed analysis is to pre-register it first and evaluate it on cells not yet
   examined.

**Rejected: treating the measured rate as the new model.** A bound has to hold
for the function being measured, not for the functions that were convenient to
measure. 2^-k is loose here and remains the only value that is *safe* here.

Recorded as evidence under E-01, which is the operator's decision, not mine. What
the measurement licenses is a better-informed answer to that escalation; it does
not license the answer.

**One methodological note.** The gap is wide enough that the worst-case model is
plausibly loose in general and not merely on these targets. Establishing that
would need its own derivation and its own pre-registration, and a tighter model
would need to hold for the sparse top-form case rather than the dense one. That
is unbuilt, and is named here rather than half-done.

**Statistics added.** `stats.clopper_pearson_interval` and
`stats.binomial_tail_at_most`, exact and standard-library only (D-004), solved by
bisection on the binomial tail rather than an inverse incomplete beta. The
existing closed form `zero_witness_upper_bound` covered only zero successes;
reporting a non-zero rate without an interval would be the single point section 3
forbids. Pinned against textbook values, against the closed form at zero
successes, and by the identity that relabelling success and failure mirrors the
interval.

---

## D-038 — the degree null was incomplete, and the missing blindness class is geometric

Raised by an objection from outside this repository: that a landscape can have
no local correlation and still carry exploitable hierarchical structure, so "no
local signal" may have been recorded as "no structure".

**First, the premise as stated does not apply here.** The objection was framed
around lag-1 autocorrelation. This instrument computes no autocorrelation and no
lag statistic of any kind; a grep for them returns one hit, in a rationale string
describing the *prior* instrument that the linear-map positive control exists to
expose. The objection came from a different tool.

**The structural criticism does apply, and it was right.** Module 1's null is
"the algebraic degree has saturated", a statement about the algebraic normal
form. Three blindness classes already stood against it, and all three name
*algebraic* structure the Boolean degree cannot see: a small implicit relation
system over the extension field, univariate tractability under saturation,
multiplicative structure. None names *geometric* structure in the associated
search landscape. That was a gap in the blindness map, not a gap in the
measurement.

**What was built.** `core.landscape.HierarchicalEnergy`: one construction,
E(x) = sqrt(a)*z_outer(block) + sqrt(1-a)*z_inner(x), with the Boolean view being
the energy pushed through its own CDF and quantised. At a = 0 it is a
structureless landscape; above it, states sharing a block share an offset. The
marginal law of the output is uniform either way, so the degree saturates in
both. `verify/landscape.py` measures local minima, the overlap distribution and
the density of states, exhaustively.

**The result** (`scripts/landscape.py`, n = 14, six cluster counts from 1 to 1024):

| statistic | cells where it separates |
|---|---|
| **algebraic degree** | **0 of 5** |
| local minima | 5 of 5 |
| overlap P(q) | 4 of 5 |
| density of states | 1 of 5 |

The degree profile is (14, 13) for every landscape in the sweep. A local-minimum
count departs from its structureless prediction by 32 to 47 per cent in every
hierarchical cell. So the answer to "has no degree deficiency been mistaken for
no structure" is **yes, it had been**, and the gap is now measured rather than
argued.

**Two claims of mine that the measurement refuted, recorded because I made them
before testing them.** I wrote that the density of states cannot separate the two
regimes, because both are standard normal by construction. That is true of the
marginal under a random seed and false of the empirical density over one
exhausted hypercube: the outer level supplies only `2^n_outer` draws, so the
empirical mean fluctuates by about `sqrt(a / 2^n_outer)`, which is 0.42 at four
clusters and 0.03 at 1024. The separation is a finite-cluster artefact that fades,
not a signature. And I wrote that the overlap distribution stays separated at
every cluster count; it does not. At 1024 clusters of 16 states the 64
lowest-energy states are drawn from many different clusters, so pairs share no
block and the mean overlap returns to baseline while the hierarchy is still there
by construction.

**The general finding is stronger than the specific one.** Every statistic
measured here has a regime in which it reports "no structure" about a landscape
that has structure by construction. The degree measure is blind in all five
cells; the others are each blind in some. That is the honest shape of the result
and it is what the sweep is for.

**What did not change.** No gate, no promotion, no threshold. A section 6
blindness class has no promotion path by construction. The separation criteria in
`scripts/landscape.py` were fixed after the sweep was run and are labelled in its
own output as descriptive rather than a pre-registered test.

## D-039 — three defects in the mutation harness, found by testing the harness

Running the full catalogue left five committed reports rewritten. Diagnosed:
mutant `RPRT-07` exists to make the renderer ignore `--out-dir` and write into
the tracked directory, and `apply_mutant` restored the mutated *source* but not
the files that mutant caused to be written. A dirty tree falsifies the provenance
of everything run afterwards, which is D-033 arriving by another route. Fixed
with a snapshot and restore around the run, reported as
`side_effect_files_restored=` rather than done silently.

Writing tests for that turned up two more, both pre-existing:

**Three duplicate mutant ids.** `MEAS-07`, `MEAS-08` and `MEAS-09` each appeared
twice. `MEAS-08` and `MEAS-09` were byte-identical copies, costing a test run
each for no coverage. The second `MEAS-07` was a genuinely different mutation
wearing a colliding id, so a survivor report naming `MEAS-07` would have been
ambiguous about which defect survived. The duplicates are deleted and the
distinct mutant is renumbered `MEAS-12`. The catalogue is 104 entries with 104
unique ids, asserted by a test rather than by counting.

**The harness cannot mutate itself.** `LAND-09` was written to pin the new
restoration logic, and its anchor matched twice: once in the code and once inside
its own catalogue entry, since both live in `scripts/mutation_test.py`. This is
structural — any anchor naming a line of that file also appears in the entry
quoting it — so the mutant was removed and the behaviour is covered directly by
`tests/test_mutation_harness.py`. Recorded as a limitation of the mechanism
rather than worked around.

A new fast test also asserts every anchor still matches exactly once. A drifted
anchor was previously visible only by running the whole catalogue, which takes
tens of minutes; it is now caught in a second.

---

## D-040 — three corrections from outside review, all accepted, all checked first

Outside review made three claims about this repository. Each was verified against
the code before anything was changed, because a criticism of my own work is not
self-evidently right and accepting one uncritically is the same failure as
rejecting it.

### 1. "The statistics are calibrated for a failure mode that is not the field's"

**Verified, and the numbers are worse than the claim.** The committed run logs
carry **35 Tier P results, 19 Tier E, and 0 Tier S**. Benjamini-Hochberg appears
outside its own tests in exactly one place — `provenance/audit.py`, which
*recomputes* a declared correction to check a run against its pre-registration,
not to correct a family of findings. The Tobit censored regression appears
nowhere outside its tests. The entire statistical layer has produced no result.

The reviewer's framing is right: a degree bound is deductive and a distinguisher
either runs or it does not. Tier P and Tier E need none of this machinery. And
the layer's only customer, Tier S, is closed above probe dimension 2 by
PREREG-M1 §9.1 (D-010).

**Chosen: say so in the README, prominently, and leave the code in place.**
Removing it would be a scope change the operator has not authorised, and D-037's
measurement is a live reason the closure might be revisited. But the README now
states that the statistical layer is unexercised, that Tier S has produced
nothing, and that on the current pre-registration it has almost no promotion
path. Whether to keep carrying it is E-01.

**Rejected: deleting `stats/`.** It is tested, mutation-checked, and would have
to be rebuilt if E-01 resolves the other way. Carrying unexercised code is a cost
to be disclosed, not concealed by deletion.

### 2. "The mint-token pattern is a discipline aid, not a guarantee"

**Verified by reproducing it.** `object.__new__(Result)` followed by
`object.__setattr__` produces a fully-formed Tier P result that never went near a
derivation, and relabels a sampled result as proven. The patched `__setattr__`
and the mint check both go through the normal attribute protocol, and
`object.__setattr__` goes around it. There is no way to close this from inside a
CPython process.

**Chosen: pin the limitation as passing tests.** `tests/test_tiers_bypass.py`
asserts that each bypass *succeeds*. If someone later hardens `tiers/result.py`,
those tests fail, and the failure is the prompt to update the README rather than
a regression to fix. A further test asserts that neither bypass appears anywhere
in the repository outside that file and the frozen-dataclass machinery itself, so
the claim "not by accident" is checked rather than asserted.

**Rejected: a keyed digest over the fields, verified at serialisation.** It raises
the cost of forgery slightly and would let the README keep a stronger word. But
the key is module-private and therefore readable in-process, so it would be
theatre — a guarantee-shaped object that is not a guarantee. Better to state the
bound honestly.

Also accepted: the README now argues the construction-time-versus-review-time
distinction against IACR artifact evaluation at FSE/ToSC and CHES, rather than
implying no comparable practice exists. The argument is stated *with* its
counter-argument, which is item 2 itself.

### 3. "Drop or demote ARX"

**Verified, and the mismatch was total.** Of the seven declared M1 targets, the
only ARX one is `sha256-compression-parametrised`, which has never been available
(E-03). Keccak-f is bit-oriented — AND, XOR, rotate, no modular addition — so it
is not ARX either. **100% of what this instrument has measured is
arithmetisation-oriented, bit-oriented, or synthetic.** The title claimed a scope
the work did not have.

**Chosen: demote ARX to a blocked secondary target and name AO as primary.**

The positive reason is this repository's own Tier E data, which is the substantive
cross-reference. Exact MiMC degree over GF(2^n), exhaustive:

```
n=9    2, 2, 4, 4, 6, 8, 8, 8, 8, 8        doubling: 2, 4, 8, 8, ...
n=11   2, 2, 4, 4, 6, 8, 10, 10, 10, 10    doubling: 2, 4, 8, 10, ...
n=13   2, 2, 4, 4, 6, 8, 10, 10, 12, 12    doubling: 2, 4, 8, 12, ...
```

Per-round increments never exceed 2 and average below 2 before the permutation
cap, where a doubling process is unbounded. Doubling saturates at round 3-4; the
exact degree needs 6 to 9. The growth prefix is identical across field size until
the cap bites. Pinned in `tests/test_mimc_degree_growth.py`, computed twice by
independent code paths.

That is sub-exponential, approximately linear growth, measured here. It is
**not** reported as agreement with any published result: the papers are behind
E-04's egress block and Class 2 forbids substituting a value I derived for a
published anchor. What it does establish is that the AO side is where this
instrument's own measurements have something to say, which is the reviewer's
point arrived at independently.

**Not done:** the brief's text still says "ARX and arithmetisation-oriented".
Changing a brief is the operator's act, not mine. The README states the narrowed
scope and the reason; the discrepancy with the brief is recorded here.

---

## D-041 — the SHA-256 target, authorised and implemented here

The operator authorised a fresh implementation on 2026-09-22, the target having
been blocked since Stage C (E-03). The brief's instruction was to vendor
`sha256-testbed` and not rewrite it; that repository is unreachable from this
session, and the authorisation supersedes the instruction for this one target.

**Three of the four preconditions `core/sha256.py` declared apply unchanged and
are met. The fourth does not apply and is recorded as superseded:**

| precondition | state |
|---|---|
| FIPS 180-4 validation runs here, outcome committed | met — `tests/test_core_sha256.py`, 37 tests |
| bit-identity with `hashlib.sha256` at 64 rounds over a committed vector set | met — every length 0–200 bytes, the padding boundaries either side of 56 and 120, a 300-case fixed pseudo-random set, and a 1 MB input |
| no constant transcribed | met — see below |
| upstream commit id of vendored code | n/a; superseded by this entry |

**Constants are derived, not copied.** FIPS 180-4 defines K[i] as the first 32
bits of the fractional part of the cube root of the i-th prime, and H[i] the same
for the square root. Both are computed in exact integer arithmetic — an integer
cube root and `math.isqrt`, no floating point — so there is no rounding to argue
about, exactly as `core/keccak.py` derives its rho offsets and iota LFSR rather
than tabling them. `hashlib` then validates the derivation: a wrong constant
cannot survive a digest comparison, and a mutant (`ARX-05`) that takes the wrong
32 bits of the scaled root is killed.

**Parametrisation.** The round count is a runtime parameter in [0, 64], and the
message schedule is computed for as many words as that count needs and no more,
so a reduced-round target cannot silently depend on schedule words it never
consumes. A `free_bits`/`free_offset` window restricts the input for the
exhaustive arm, and the target reports `space_fraction` so a Tier E result over a
window prints what fraction of the 2^512 universe it covers.

**One parametrisation detail that changed a result.** The free window initially
defaulted to block offset 0, which lands in W[15] — a word no round below 15
consumes. Every reduced-round measurement therefore read a constant and returned
degree 0: true, sound, and useless. The window now sits at offset 480, in W[0],
which round 0 consumes. This is recorded because the first run of the exhaustive
arm produced eighteen cells of zeros and they were correct.

## D-042 — the naive ARX degree bound is vacuous, and support tracking fixes it

`SymbolicWord` carries one number per bit. Adding modular addition to it is
straightforward — `z_i = x_i ^ y_i ^ c_{i-1}`, `c_i = maj(x_i, y_i, c_{i-1})`,
both sound — and the result is worthless. Traced through
`core.sha256.compress`, the propagated value is

```
1 round    4,526
2 rounds   253,776,261
3 rounds   15,901,022,549,468
```

Only the free-variable ceiling keeps it finite, so the reported bound is 512 at
every round count from 1 to 64. Sound, and it says nothing.

**Chosen: track each bit's variable support alongside its degree, and cap at
`popcount(support)` after every operation.** The missing fact is elementary — a
Boolean function of a variable set S has degree at most |S| — and applying it at
each step rather than once at the end is what stops the product terms
compounding. `SupportWord` implements it and the bound becomes

```
rounds    1    2    3    4    8   12   16   17+
naive   512  512  512  512  512  512  512  512
capped   31   63   95  127  255  383  511  512
```

which is exactly 32r − 1 through round 16: each round consumes one 32-bit message
word, and the top bit's degree comes from a carry spanning all but one of the
variables below it.

**Both bounds are recorded, not just the better one.** This follows MiMC's
precedent (`mimc_bound` beside `mimc_derived_bound`): the run log carries `d_ub`
and `d_ub_derived`, and their difference — up to 481 bits — is the measurement of
what the extra argument bought. A log showing only the tighter number would hide
that.

**Rejected: replacing `SymbolicWord` with `SupportWord` everywhere.** The
Keccak and MiMC paths are validated and their bounds are already tight (gap 0 at
rounds 1–4 on Keccak-f[25]). Rewriting them for a benefit they do not need would
put the validated reference and the thing under test in the same new code. The
ARX path uses the new type; the others are untouched.

**What the arms cannot establish, stated rather than left implied.** The
round-dependence of 32r − 1 is not exhaustively checkable here. A restricted
target saturates at its own free-variable count — the exhaustive arm found exact
degree equal to the window width in 18 of 18 cells, at every round count from 1
to 64 — so the restriction ceiling bites before the round count does. Seeing
round-dependence would need a window wider than 32 bits, at least 4.3×10^9
evaluations. The round-dependence is Tier P only, and the exhaustive arm
establishes soundness and a lower bound rather than tightness.

---

## D-043 — Module 2 built; one registered hypothesis confirmed, one refuted

E-03's resolution unblocked M2, whose subject is SHA-256's message schedule and
which the completion brief ordered first. Section 9 declares its quantity as
"input bits reachable to each output bit at round r; degrees of freedom" and its
tier as **P only** — both parts are properties of the wiring, so nothing in the
module enumerates or samples.

**Two granularities, and its own propagation.** A transitive closure over the
schedule recurrence at word level, and a reachable-set propagation through
`core.sha256.compress` itself at bit level. `ReachWord` is written fresh rather
than reusing `modules.degree.measure.SupportWord`: the two answer different
questions — that one carries degree bounds and caps them, this one carries only
sets — so a mistake in either is not shared.

**PREREG-M2 registered two predictions before the measurement path existed.**

**H3 confirmed.** The *union* of reachable bits is complete at round **16**, the
round that consumes the last block word. But *every output bit individually*
reaches every input bit only at round **21**. The five-round gap is where some
output bits still cannot see some input bits, which is the regime a
dependency-based distinguisher would have to live in.

**H2 refuted.** The prediction was that bit-level propagation would be strictly
tighter than the word-level closure somewhere, since rotations and shifts move
bits rather than merging them. It never is: `word_level_overstatement` is **0 at
every round count**. Modular addition's carry chain unions every operand bit at
or below each position, and there are enough additions per round that every bit
of a consumed word becomes reachable anyway. This is a fact about ARX mixing, not
about the implementation — a design whose mixing were rotation-only would
separate the two. The test asserts the refutation rather than being deleted, and
the module docstring's original claim was corrected to match.

**Freedom budget.** 512 bits, saturating at round 16 and never growing again:
from round 16 the schedule determines each word from words already committed, so
a later round spends what the first sixteen committed rather than adding freedom.
The last directly settable round is 15. Mutant `RCH-03` makes the budget keep
accumulating, which is wrong in the direction that flatters an attack.

**Reachability is not dependence, and the module never says it is.** Section 6
needs the blindness class, and `core.targets.CancellingXor` is it:
`f(x) = (A x) XOR (B x)` presents every input bit as reaching every output, while
on rows where A and B agree the sum is the zero row and the output bit is
identically zero. Verified exhaustively by `verify/dependence.py`, which is also
gate G10's independent path.

**Calibration.** Section 5 requires a published anchor; neither brief names one
for M2, so the suite is built with `allow_missing_ground_truth` and the module
ships calibration-blocked (E-05), exactly as M4 does. Its five controls pass and
the gate is not lifted by their passing. M2 stands at **9 of 11 gates**, the two
outstanding being the untracked pre-registration (resolves on commit) and the
absent anchor.

## D-044 — two readiness gates were hard-coded to Module 1's quantity

Adding a second module with a measurement path exposed this, which is the useful
kind of discovery: G08 (controls-recompute) called `verify.anf.algebraic_degree`
on every control, and G09 (blindness-test-passes) imported
`blindness.inverse_map` by name. Both are Module 1 facts and neither is a
property of "a module".

**Chosen: the module declares, the gate dispatches.**

`SpecSheet` gains `control_strategy`, naming how a control's stated value is
recomputed independently of the module's own measure — `exhaustive-anf` for M1,
`schedule-closure` for M2, which re-derives the reachability controls from the
word-level closure rather than from the bit-set propagation `measure` uses. Two
genuinely different computations, so one checks the other; it is *not* an external
anchor, which is what G06 is for and why M2 remains calibration-blocked
regardless.

For G09, each module's blindness package now exposes a zero-argument
`readiness_check()`. The classes take whatever measures their own demonstration
needs and do not share a signature — M1's takes one measure, M2's takes two — so
a uniform contract is the only thing the gate can call. The gate now knows no
class name.

Also fixed while here: `verify_symbol` is parsed as `module:symbol` and M2's was
written with a dot, and `SpecSheet`'s new field was inserted before an
undefaulted one.

**One equivalent mutant identified rather than treated as a gap.** `RCH-08` was
first written to remove the unordered-pair guard in `dependence_matrix`. It
survived because the accumulator is `|=`, so the second visit to a pair
contributes `f(x) ^ f(x) = 0` — the mutant is slower and identical. Replaced with
one that assigns instead of accumulating, which *did* survive against the
existing tests because every function they used happens to differ at its last
input too. Fixed by adding `f(x) = x0 AND NOT x1`, whose dependence on bit 0 is
invisible at the final comparison. Fourth equivalent mutant identified in this
repository; the pattern each time is a guard or a step whose removal is masked by
a later one.
