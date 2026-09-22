# PREREG-M3 — Differential characteristic search

Committed before the measurement path was trusted on anything new. Every number
in section 2 is computed by `modules/differential/prereg/derive_thresholds.py`
(computation id `M3-DERIVE-001`); `tests/test_prereg_m3.py` asserts the derived
block is byte-equal to that script's output.

## 0. Identity

- `prereg_id`: PREREG-M3
- `module`: modules.differential
- `title`: Differential characteristic search
- `declared_tiers`: E,S
- `runner_path`: harness/runner.py
- `primary_metric`: characteristic_steps
- `alpha`: 0.05
- `family_size`: 32
- `effect_floor`: 1.0
- `seeds_per_cell`: 50
- `target`: sha256-compression-parametrised
- `feasibility_ceiling_log2`: 63.1

**This is the first module whose declared tiers include S**, and therefore the
first place the statistical layer has anything to do. Every earlier module is
Tier P or E, where a correction has nothing to correct. That is stated here
rather than discovered later: if this module produces no Tier S cell either, the
statistical layer has still never been exercised on a result, and the honest
conclusion is the one E-01 already reached.

## 1. The quantity

**Differential probability.** For a target `f` and a stated pair `(din, dout)`
with `din` non-zero, the fraction of inputs satisfying
`f(x) ^ f(x ^ din) == dout`. Two paths:

- Tier E where the input space is exhaustible: counted, not estimated. The guard
  is `max_exact_differential_vars`; above it the path refuses.
- Tier S otherwise: one draw per seed, reported as a rate with an exact
  Clopper-Pearson interval. Never a bare point estimate.

**Characteristic steps.** The number of rounds a characteristic covers while its
probability stays strictly above the random level `2^-m`. Counting stops at the
first round that reaches the floor, because a characteristic that has decayed to
the random level has stopped being one.

## 2. What is declared before running

<!-- BEGIN DERIVED computation_id=M3-DERIVE-001 -->
- `seeds_per_cell`: 50
- `alpha`: 0.05
- `family_size`: 32
- `power`: 0.8
- `confidence`: 0.95
- `n_out_bits_primary`: 256
- `effect_floor_steps`: 1
- `feasibility_ceiling_log2`: 63.1
- `feasibility_ceiling_provenance`: declared-project-budget
- `max_exact_differential_vars`: 18
- `bh_smallest_critical_value`: 0.0015625
- `min_detectable_rate_at_power80`: 0.03167621427
- `zero_hit_rate_upper_bound_95`: 0.07112173646
- `one_hit_rate_lower_bound_95`: 0.000506227983
- `random_level_primary_log2`: -256
- `one_hit_clears_primary_random_level`: True
- `exact_path_ceiling_inputs_log2`: 18
<!-- END DERIVED -->

`one_hit_clears_primary_random_level` is worth reading rather than skipping. The
primary target's output is 256 bits, so the random level is `2^-256`, and a
single hit in fifty draws has a 95% lower bound of about `5.06e-4` — vastly
above it. **A sampled cell on the primary target is therefore not
power-limited**: one hit is decisive. That is the opposite of Module 1's
situation, where `2^-k` made sampling hopeless above probe dimension 2, and it is
the reason this module has a real Tier S path where Module 1 does not.

## 3. Hypotheses, stated so they can fail

**H1 (soundness of the exact path).** The count returned for a pair equals the
count an independently written table computation returns.
`verify/differential.py` builds whole rows in one pass rather than counting per
pair; a disagreement means one of them is wrong. Checked on every target small
enough for both.

**H2 (the floor is the random level).** On an i.i.d. random-oracle stand-in, the
count for a fixed pair stays within the binomial tail of its expectation.
Falsified by a count far above it, which would be the counting method reporting
itself rather than the target.

**H3 (the family correction binds).** With `family_size` = 32 declared, the
smallest critical value is `alpha / 32`, and a cell must clear that rather than
`alpha`. Falsified by any promoted cell whose uncorrected p-value alone carried
it.

## 4. What this module will not claim

A differential probability is for *one* stated pair. Three things follow, and
none of them is a hedge:

- The threshold is **one-sided**. It asks whether a probability exceeds the
  random level. An impossible differential — probability exactly zero — is as
  exploitable as a probable one and lies on the other side.
  `blindness/impossible.py` exhibits a target whose best differential is one bit
  above random while **half** its table is impossible.
- A probability for a pair says nothing about a *set* of output differences.
- A probability under XOR differences says nothing about another difference
  operation.

No result from this module is reported as "the target has no exploitable
differential".

## 5. Calibration

Section 5 names an anchor for this module: reduced-round SHA-256 collision and
semi-free-start results. Unlike Modules 2, 4 and 6 this suite therefore *has* a
published-ground-truth case, and it is `PENDING_PRIMARY_SOURCE` because the
source is unreachable from this environment (E-04). **The distinction matters**:
M2, M4 and M6 are blocked because the brief names no anchor, which is a gap in
the brief; M3 is blocked because this environment cannot fetch one, which two
transcribed numbers repair.

## 6. Promotion gate

1. `gate_threshold`: metric `characteristic_steps`, direction more-is-better. A
   candidate must cover strictly more steps than the published anchor at the
   same round count and attack model, by at least `effect_floor` = 1 step. A
   characteristic matching the anchor is a successful calibration, not a result.

2. `gate_verification`: the probability must be re-derived by a path under
   `verify/` that shares no code with this module —
   `verify.differential.ddt_row`. For a Tier S cell, the interval and not the
   point estimate is what must clear the threshold.

3. `gate_cost`: the implied attack needs about `2^-log2(p)` chosen pairs, and
   that must sit below `feasibility_ceiling_log2` = 63.1 **and** below the
   generic cost it displaces. Steps alone never promote: a longer
   characteristic at an infeasible probability is not an attack.

4. `gate_falsification`: two artefact hypotheses with the test that settles
   each. **A1** — the characteristic is an artefact of assuming rounds are
   independent, so the measured multi-round probability is compared against the
   product of the single-round probabilities and the two are reported
   separately, never multiplied into a claim. **A2** — the characteristic exists
   but only for the fixed constants this implementation uses; tested by
   re-deriving under a second constant set and reporting both.
