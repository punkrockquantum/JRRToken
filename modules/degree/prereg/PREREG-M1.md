# PREREG-M1 — Algebraic degree growth versus round count

Committed before any data collection. Every number below is either declared with
its reason or computed by `modules/degree/prereg/derive_thresholds.py`
(computation id `M1-DERIVE-001`). `tests/test_prereg_m1.py` asserts that the
derived block in this document is byte-equal to that script's output, so the
document cannot drift from its derivation.

## 1. Identity

- `prereg_id`: PREREG-M1
- `module`: modules.degree
- `title`: Algebraic degree growth versus round count
- `declared_tiers`: P,E,S
- `runner_path`: harness/runner.py
- `primary_metric`: k_HO
- `alpha`: 0.05
- `family_size`: 64
- `effect_floor`: 1.0
- `seeds_per_cell`: 50

## 2. Target and scope

- `primary_target`: sha256-compression-parametrised
- `primary_target_variables`: the 512-bit message block, chaining value fixed to
  the FIPS 180-4 initial value
- `primary_target_rounds`: r in [1, 64], round count a runtime parameter
- `secondary_targets`: MiMC and MiMCSponge over BN254 and BLS12-381; Poseidon
  over KoalaBear

Scope statement that every Module 1 result inherits: results bound the algebraic
degree over GF(2) of the stated output bits in the stated input variable set, at
the stated round count, for the stated target. They bound nothing about degree
over any other field, about differential or meet-in-the-middle structure, or
about any variable set other than the declared one.

## 3. Blocking preconditions

Module 1 does not run until all of the following hold. Each is a hard block, not
a warning.

- `precondition_target`: the parametrised SHA-256 core from sha256-testbed is
  vendored into `core/` and its FIPS 180-4 validation run is committed in this
  repository. Presently unmet — `core/sha256.py` raises `NotAuthorised`.
- `precondition_ground_truth`: every calibration case of kind
  `published-ground-truth` carries a citation whose claimed numbers have been
  checked against the primary source. Presently unmet — see section 11.
- `precondition_calibration`: `modules/degree/calibration/suite.py` reports
  `calibration_satisfied=True` for every case.
- `precondition_measurement`: a measurement implementation is registered for
  `modules.degree`. Presently unmet — `ModuleSpec.measure` is `None`.

## 4. Quantities

For a target T with `n` free input bits, `m` output bits, at round count `r`:

- `d_ub(r)` — certified upper bound on the algebraic degree over GF(2) of any
  output bit of T restricted to the declared free variables. Tier P.
- `d_exact(r)` — exact degree, by complete enumeration over a declared input
  subspace. Tier E; the space, its cardinality, and its fraction of the full
  input space are printed with every value.
- `d_lb(r)` — witnessed lower bound. A single non-zero k-th order derivative is
  a deductive proof that the degree is at least k, so a witness is Tier P. The
  absence of a witness across seeds is Tier S.
- `r_sat` — the least r with `d_ub(r) >= n - 1`. Tier P, derived from `d_ub`.
- `k_HO(r) = d_ub(r) + 1` — the order of a higher-order differential that
  vanishes identically. Primary metric. Lower is better.

## 5. Hypotheses

- `H1_primary`: there exists r in [1, 64] with `k_HO(r) <= feasibility_ceiling`,
  i.e. a provably vanishing higher-order differential whose data complexity is
  at or below the pre-registered ceiling of section 6.
- `H1_gap`: there exists r with `d_ub(r) - d_lb(r) >= effect_floor`, i.e. the
  certified upper bound overstates the true degree by at least one bit.
- `H0` for each Tier S cell C(r): the true degree equals the probe dimension
  `k`, under which the per-draw witness probability is at least `2^-k`.

Under `H1_gap` at probe dimension `k`, every k-dimensional derivative vanishes
and the witness probability is exactly zero; the alternative is therefore a
point alternative, not a shifted distribution.

## 6. Thresholds, with derivations

- `T1_existence`: `k_HO(r) <= existence_ceiling_k`. Derivation: a k-th order
  derivative requires a k-dimensional subspace of the input space; for
  `k > n` no such subspace exists, so a bound above `n` is vacuous. Structural,
  needs no citation.
- `T2_feasibility`: `k_HO(r) < feasibility_ceiling_log2`. Derivation: the
  implied distinguisher costs `2^k` target evaluations; the ceiling is set at
  the largest published practical hash computation, `2^63.1` SHA-1 compression
  calls (citation `CITE-SHATTERED`). A candidate above the ceiling is recorded
  but does not promote.
- `T3_advantage`: the cost comparison of section 9 must show
  `advantage_log2 > 0` after memory-access costing. Derivation: for an ideal
  m-bit-output function a fixed k-dimensional affine subspace sums to zero with
  probability `2^-m`, so a generic search for the same zero-sum costs about
  `2^(m+k)` evaluations against the candidate's `2^k`, giving a nominal
  advantage of `generic_zero_sum_advantage_log2` bits before memory costs are
  charged. Memory-access cost is measured on the run host by
  `scripts/measure_memory_cost.py`, not assumed.

## 7. Effect floor

- `effect_floor`: 1.0, in bits of algebraic degree, applied to
  `d_ub(r) - d_lb(r)`. Derivation: the degree is integer-valued, so 1 is the
  smallest representable non-zero gap; one bit of gap halves the data complexity
  of the implied distinguisher. A cell that clears statistical significance but
  not this floor is recorded as a pass-fail and does not promote.

## 8. Family size and multiple-comparison control

- `family_size`: 64 — one Tier S cell per round of the primary target,
  r = 1..64. Fixed here and asserted at analysis time by
  `stats.bh.benjamini_hochberg`, which raises if the number of tests presented
  differs.
- `alpha`: 0.05, Benjamini-Hochberg step-up over the family.
- `seeds_per_cell`: 50 independent seeds, above the mandatory minimum of 30.
- Acceptance is two-part: BH significance AND the effect floor of section 7.
  Both, or the cell does not promote.

## 9. Power analysis, before the run

Model: at probe dimension `k`, each seed draws an independent uniformly random
k-dimensional affine subspace and computes the derivative sum. Under `H0` the
per-draw witness probability is at least `2^-k`, by Schwartz-Zippel over GF(2)
applied to the non-zero multilinear form of degree `k` given by the top-degree
homogeneous part. Under `H1_gap` it is exactly 0.

<!-- BEGIN DERIVED computation_id=M1-DERIVE-001 -->
- `seeds_per_cell`: 50
- `alpha`: 0.05
- `family_size`: 64
- `power`: 0.8
- `confidence`: 0.95
- `n_free_bits_primary`: 512
- `n_out_bits_primary`: 256
- `effect_floor_degree_bits`: 1
- `feasibility_ceiling_log2`: 63.1
- `bh_smallest_critical_value`: 0.00078125
- `min_detectable_p_at_power80`: 0.03167621427
- `zero_witness_p_upper_bound_95`: 0.05815507912
- `max_probe_dim_with_power80`: 4
- `max_probe_dim_reaching_bh_significance`: 2
- `worked_probe_dim`: 8
- `worked_meaningful_p`: 0.00390625
- `worked_meaningful_over_detectable`: 0.1233180823
- `existence_ceiling_k`: 512
- `generic_zero_sum_advantage_log2`: 256
- `seeds_required_power80_k4`: 25
- `seeds_required_bh_significant_k4`: 111
- `seeds_required_power80_k8`: 412
- `seeds_required_bh_significant_k8`: 1829
- `seeds_required_power80_k16`: 105476
- `seeds_required_bh_significant_k16`: 468882
- `seeds_required_power80_k32`: 6912483199
- `seeds_required_bh_significant_k32`: 30728838970
<!-- END DERIVED -->

Detectable versus meaningful, stated numerically as section 3 of the brief
requires. At 50 seeds the smallest per-draw probability detected at 80% power is
`min_detectable_p_at_power80` = 0.03167621427. The guaranteed-under-H0
probability at the worked probe dimension `k` = 8 is `2^-8` = 0.00390625. The
ratio meaningful/detectable is 0.1233180823: the effect the design is required
to detect is 8.1 times smaller than the smallest effect 50 seeds can detect at
80% power. The design has 80% power only for `k <= 4`, and reaches BH
significance at the family's smallest critical value only for `k <= 2`.

### 9.1 Pre-registered consequence

Because of the figures above, and committed before any data exists:

- `tier_s_promotion_closed_above_k`: 2. A Tier S cell at probe dimension
  `k >= 3` has no promotion path at 50 seeds. Its null is pre-registered as
  INCOMPLETE-by-design and is recorded as such in the log; it does not enter a
  report as a NEGATIVE.
- Module 1's promotion path runs through Tier P (`d_ub`, `d_lb` witnesses,
  `r_sat`) and Tier E (`d_exact` over a declared, fully enumerated subspace).
- Raising `seeds_per_cell` to reopen the Tier S path at dimension `k` requires
  `seeds_required_bh_significant_k`, tabulated above; at `k` = 16 that is
  468882 seeds per cell and at `k` = 32 it is 30728838970.

## 10. Censoring, criterion changes, and reproduction

- Runs are wall-clock budgeted. Every censored cell is flagged in the sweep
  store and analysed with `stats.censored.fit_both`, which reports the Tobit fit
  and the naive OLS fit side by side together with the percentage shift between
  their slopes. Reporting either alone is a deviation the audit will flag.
- `criterion_change_policy`: a criterion may not be switched after seeing data.
  A new criterion is locked in a superseding pre-registration and evaluated on
  rounds not used to choose it, making it an out-of-sample test. The rounds
  reserved for this purpose are declared as `holdout_rounds`.
- `holdout_rounds`: 53,54,55,56,57,58,59,60,61,62,63,64
- `reproduction_policy`: one factor per reproduction run, named in the run
  header and validated against `harness.runner.REPRODUCIBLE_FACTORS`.

## 11. Calibration

Defined in `modules/degree/calibration/suite.py`; the manifest of exactly what
it asserts is rendered by `python -m modules.degree.calibration.suite`. Summary:

- `published-ground-truth` — degree growth values from the literature, one for
  an iterated permutation with published per-round degree bounds and one for a
  low-degree-round-function design. Both citations are presently UNVERIFIED in
  this environment and therefore block the module.
- `positive-control` — g(x) = Ax over GF(2), A random invertible. Asserts
  measured degree == 1 for every output bit.
- `intermediate-control` — x -> x^d over GF(2^n) with wt(d) = k. Asserts
  measured degree == wt(d), a value strictly inside (1, n-1).
- `negative-control` — an i.i.d. random-oracle stand-in. Asserts measured degree
  >= n-1, an assertion that fails with probability 2^-(n+1) by chance alone.
- `blindness` — x -> x^(-1) over GF(2^n). Asserts measured degree == n-1, the
  same null a degree-saturated round function produces, on a function that is
  described exactly by one quadratic relation.

## 12. Null-result requirements

Every negative Module 1 result must carry, per section 6 of the brief:

- `mechanism`: the structural derivation of the value from the round function
  and message schedule, together with the predicted value and the observed
  value, and an explicit flag when they disagree.
- `blindness_statement`: the multiplicative inverse over GF(2^n) has maximal
  algebraic degree n-1 and is inverted by one field inversion; algebraic degree
  over GF(2) does not bound the degree of the implicit multivariate system over
  the extension field, so a degree-saturated measurement is compatible with
  complete algebraic tractability.
- `blindness_test`: `modules/degree/blindness/inverse_map.py`, which runs the
  measure on that class and requires it to return the same null.

A negative without all three is logged as INCOMPLETE.

## 13. Promotion gate, instantiated

A Module 1 candidate promotes only on all four criteria of section 7 of the
brief:

1. `gate_threshold`: metric `k_HO`, direction less-is-better, threshold
   `feasibility_ceiling_log2` = 63.1, derivation as in section 6 above.
2. `gate_verification`: the value must be re-derived by a path under `verify/`
   that shares no code with `modules/`, checked by
   `scripts/ci_checks.py::check_verify_does_not_import_modules`. For round
   counts where exhaustive re-derivation exceeds
   `verify.anf.MAX_EXHAUSTIVE_VARS`, an independently implemented bounding path
   in `verify/` is required; without one, the candidate does not promote.
3. `gate_cost`: `harness.promotion.CostComparison` with the candidate at `2^k`
   evaluations, a generic zero-sum baseline at `2^(k+256)`, and brute force
   always present as a baseline; memory-access cost measured on the run host.
   Requires `advantage_log2 > 0`.
4. `gate_falsification`: pre-registered artefact hypotheses, each with the test
   that rules it out —
   - the target is not bit-identical to the reference at 64 rounds
     (ruled out by the committed FIPS 180-4 validation run);
   - the declared free-variable set overstates the true degrees of freedom
     (ruled out by cross-check against Module 2's reachability result);
   - the bound is vacuous because `k` exceeds `n`
     (ruled out by `T1_existence`);
   - the transform has an orientation or indexing defect
     (ruled out by the positive control returning degree 1 and the
     intermediate control returning wt(d)).

## 14. Citations

Full references, and the state of verification of the numbers relied on, are
held in `modules/degree/citations.py` and rendered by the calibration manifest.
A citation whose numbers have not been checked against the primary source blocks
every calibration case that depends on it.
