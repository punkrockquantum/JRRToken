# Checkpoint F — the brute-force exhaustive arm

Instruction: convert the escalations into results by brute-force probabilistic
exhaustion.

## What was built

Two files in `verify/`, the exhaustive verification path, both independent of
`modules/` (enforced by `scripts/ci_checks.py`):

- `verify/packed.py` — a truth table held one bit per input in a single integer,
  so the Möbius transform is n mask-shift-XOR operations over the whole table at
  once instead of 2^n list updates. Guard `MAX_PACKED_VARS = 26`, derived from
  what the computation holds live rather than picked (D-034).
- `verify/keccak_columns.py` — Keccak-f[25] evaluated on all 2^25 inputs
  simultaneously, with the step wiring written out a second time so it is a
  second reading of the specification rather than a call into the first.

And `scripts/exhaust.py`, which runs the exhaustion and emits the committed table
`modules/degree/calibration/exhaustive_truth.py`.

## What the method can and cannot reach

The instruction named one method for eight items. Two facts bound it, and both
are arithmetic rather than judgement.

**"Probabilistic exhaustion" is two tiers.** Exhaustion is Tier E, sampling is
Tier S, and `tiers/result.py` raises on combining them. The two arms were run
separately. Where the space is exhaustible, probability adds nothing; where it is
not, D-010 caps the sampled probe dimension at 2.

**Exhaustion reaches 2^26 and not past it.** Keccak-f[25] has 25 free bits and is
inside that. MiMC over GF(2^9) has 512 inputs. SHA-256's compression function has
512 free bits, so E-03 is not reachable by exhaustion, by sampling, or by the two
together.

Conversion tally: E-04 partly (both targets now measured exactly; the citations
are still untranscribed, so its gate is unchanged), the other seven not at all.
E-10 records the per-item arithmetic.

## Results

Exact algebraic degree over the complete input space. Tier E, nothing sampled.
Reproduce with `python scripts/exhaust.py`; ~25 s.

```
keccak-f[25]    rounds  exact  module_bound  gap
                1       2      2             0
                2       4      4             0
                3       8      8             0
                4       16     16            0
                5       22     24            2
                6       24     24            0    saturated at width-1
```

All 25 output lanes carry the same degree at every round (`profile_min` equals
`profile_max` throughout).

```
mimc-gf2n[9]    mean gap, naive doubling bound    1.333
                mean gap, derived support bound   0.444
                soundness at every round          both bounds
```

Two things follow, and neither needs a citation:

1. **The Tier P propagation is sound at every round measured.** This is
   falsifiable and had never been tested — the exact degree is computed without
   reusing any part of the bounding argument, so a rule that undercharged a
   non-linear step would produce a bound below the truth. It does not.
2. **The bound is exactly tight at rounds 1–4, loose by 2 at round 5, tight again
   at 6.** First measurement of this instrument's tightness against exact truth
   on a real primitive.

The Stage A derived bound for MiMC also holds against exact truth at every round,
which is the check Stage A could not make: a bound that has been tightened is a
bound that can have been tightened too far.

## What was not done

The published-ground-truth cases `CAL-M1-GT-KECCAK-R1..R3` and
`CAL-M1-GT-MIMC-R1..R3` are still `PENDING_PRIMARY_SOURCE`. The gate blocks on
`CITE-BCD11` and `CITE-EGLORSW20` with the same reasons as before. Module 1's
status is unchanged and nothing was promoted.

Writing a value computed here into a case whose provenance names a paper is what
Class 2 forbids. The refusal is enforced rather than documented: mutant `EXHT-02`
swaps the published-anchor requirement for the exhaustive one and is killed, and
`tests/test_exhaustive_truth.py` asserts the gate's blocking citations and reasons
are identical to before these cases existed.

The 15 exhaustive cases run under `run_controls`, which already excluded only the
published cases, so no gate logic was changed to let them execute. All 15 pass.

Whether the gate should ever recognise such a substitution is E-09, with three
options and a recommendation against the general form.

Module 4 got no exhaustive arm. It would need the packed path, which lives in
`verify/`, and `modules/` must not import `verify/`. Duplicating the machinery
into `modules/hod/` would satisfy the letter of that rule and defeat its purpose.

## Verification

```
tests            553 collected, 541 in the fast lane, 0 failed
ci_checks        5 checks, 0 failed
mutants          layer verify 12/12 killed, layer exhaustive 5/5 killed
```

Three mutants needed follow-up. `VRFY-08` as first written was semantically
equivalent — removing the zero-coefficient guard leaves the loop falling through
to the same return — so it was changed to mutate the returned value.
`EXHT-03` and `EXHT-05` were real gaps of the same shape: both mutate a check
that only fires when something is wrong, and nothing was wrong. Fixed by making
something wrong on purpose (D-036).
