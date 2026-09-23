# PREREG-M6 — Rotational-XOR propagation

Registered before the measurement path was run against anything beyond its
controls. Section 9 declares this module's quantity as "rotational-pair
propagation probability" and its tiers as **P and S**.

## 0. Identity

- `prereg_id`: PREREG-M6
- `module`: modules.rx
- `title`: Rotational-XOR propagation
- `declared_tiers`: P,S
- `runner_path`: harness/runner.py
- `primary_metric`: additions_to_random_level
- `alpha`: 0.05
- `family_size`: 31
- `effect_floor`: 1.0
- `seeds_per_cell`: 50
- `target`: sha256-compression-parametrised
- `feasibility_ceiling_log2`: 63.1

Unlike Modules 2 and 5 this module *does* sample, so `seeds_per_cell` is a real
declaration rather than a schema placeholder. `family_size` is 31: one Tier S
cell per non-zero rotation amount at width 32.

## 1. The quantity

A rotational pair is `(x, x <<< r)`. A function propagates it when rotating the
input rotates the output: `f(x <<< r) == f(x) <<< r`.

- **XOR and rotation propagate it with probability exactly 1.** Rotation
  distributes over XOR and rotations compose, so a circuit of those two is
  completely transparent to a rotational pair at any depth. Tier P.
- **Modular addition does not.** The two sides differ whenever the carry
  crossing the rotation boundary differs. The exact probability is computed
  from the carry cases, as an exact rational.

So a rotational characteristic's probability is governed by **how many modular
additions a design performs**, not by how many rounds it runs. The reported
quantity is `additions_to_random_level`: the smallest number of additions after
which the characteristic has fallen to the output's random level.

The Tier S path samples a stated function directly and reports a rate with an
exact Clopper-Pearson interval, for targets too wide to enumerate.

## 2. What is declared before running

<!-- BEGIN DERIVED computation_id=M6-DERIVE-001 -->
- `width`: 32
- `rotation_amount`: 1
- `n_out_bits_primary`: 256
- `linear_propagation_probability`: 1
- `addition_probability_numerator`: 6442450947
- `addition_probability_denominator`: 17179869184
- `addition_probability_log2`: -1.415037499
- `additions_to_random_level`: 181
- `seeds_per_cell`: 50
- `confidence`: 0.95
- `alpha`: 0.05
- `family_size`: 31
- `power`: 0.8
- `bh_smallest_critical_value`: 0.001612903226
- `min_detectable_rate_at_power80`: 0.03167621427
- `zero_hit_rate_upper_bound_95`: 0.07112173646
- `effect_floor_additions`: 1
- `feasibility_ceiling_log2`: 63.1
- `feasibility_ceiling_provenance`: declared-project-budget
<!-- END DERIVED -->

## 3. Hypotheses, stated so they can fail

**H1 (the closed form is right).** The probability computed from carry cases
equals the probability counted over every `(x, y)` pair, at every width and
rotation amount small enough to enumerate. Falsified by any disagreement, which
would mean the derivation is wrong. Checked continuously against
`verify/rotational.py`, which shares no code with this module.

**H2 (rotation amount matters, and 1 is the best case).** The propagation
probability is highest at `r = 1` and `r = width - 1` and lowest near
`r = width / 2`. Falsified by any amount beating `r = 1`. Registered because it
is a claim about shape, not a definition, and could be wrong.

**H3 (independence is an assumption, not a fact).** `additions_to_random_level`
multiplies the single-addition probability, which assumes the additions are
independent. This is registered as an assumption so that a measured composition
disagreeing with the product is reported as a finding about the assumption
rather than as an error in the arithmetic. The Tier S path exists precisely
because it does not need this assumption.

## 4. What this module will not claim

The plain rotational relation is the **special case `offset = 0`** of the
rotational-XOR relation. A design whose round constants are not
rotation-invariant makes the plain relation fail at every input while leaving a
rotational-XOR characteristic of probability 1 intact -- see section 6.

So: a null from the plain measure is not evidence that no rotational structure
exists, and no output of this module is a claim that any design resists
rotational cryptanalysis. `additions_to_random_level` says when the *plain*
characteristic has decayed, and nothing about the generalised one.

This module also does not model key or constant injection schedules, does not
search for RX characteristics, and does not evaluate any attack's cost.

## 5. Calibration

Section 5 names **no** published anchor for this module. The suite is built with
`allow_missing_ground_truth` and the module ships **calibration-blocked** under
E-05 -- the same terminal state as Modules 2 and 4.

That is a different block from M1, M3 and M5, which are blocked because an
anchor exists and this environment cannot reach it (E-04). The remedies differ:
transcribe a number, versus confirm that no anchor exists.

## 6. Blindness

`core.targets.RotateXorConstant`: `f(x) = (x <<< r) XOR C` with `C` not
rotation-invariant. The plain measure returns propagation at **no input** --
probability exactly 0, the strongest null it can emit -- while the offset
between the two sides is the same constant at every input, a rotational-XOR
characteristic of probability exactly **1**.

Both numbers are exact rather than elevated or reduced, which makes this the
sharpest blindness class in the repository. It is also why the technique is
named for both halves.

## 7. Promotion gate

1. `gate_threshold`: metric `additions_to_random_level`, direction
   more-is-better. A candidate must exceed the anchor's value by at least
   `effect_floor_additions` = 1. No anchor exists, so this gate cannot be
   reached until E-05 is answered; it is stated so that it is not invented
   afterwards.

2. `gate_verification`: the probability must be re-derived by a path under
   `verify/` sharing no code with this module --
   `verify.rotational.addition_propagation_fraction`, which counts every pair
   rather than arguing about carries. For a Tier S cell, the interval and not
   the point estimate is what must clear the threshold.

3. `gate_cost`: the implied distinguisher's data complexity must sit below
   `feasibility_ceiling_log2` = 63.1 **and** below the generic cost it
   displaces. A characteristic whose probability is above the random level but
   whose data requirement exceeds the ceiling is reported as structure and
   never as an attack.

4. `gate_falsification`: two artefact hypotheses with the test that settles
   each. **A1** — the characteristic is an artefact of the independence
   assumption in H3, so the composed probability is measured by sampling and
   reported beside the product, never multiplied into a claim. **A2** — the
   characteristic exists only for this implementation's rotation amounts,
   tested by re-deriving at every amount and reporting the profile.
