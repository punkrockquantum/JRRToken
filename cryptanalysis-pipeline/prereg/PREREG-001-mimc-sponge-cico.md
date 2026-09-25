# PREREG-001 — MiMC-sponge CICO degree ladder

Written before any run that stamps it. **It does not govern the calibration
ladders already in `runs/`**: those were run before this document existed, and
a pre-registration cannot be applied backwards. They stand as what they are —
calibration, run to find out whether the pipeline measures anything at all —
and this document governs every run from its committing commit onwards.

## What is being measured

- `prereg_id`: PREREG-001
- `target`: MiMC-sponge shape, width 2, capacity 1, S-box exponent 3, round
  constants derived by the SHAKE extraction in `spec._derive_constants`, MDS
  the Cauchy matrix from `spec._derive_mds`. Not a deployed parameter set, and
  no claim here transfers to one.
- `observable`: the dimension of the quotient ring `F_p[x]/I` for the CICO
  ideal `I`, as reported by Singular's `vdim` — the number of solutions over
  the algebraic closure, with multiplicity. Wall-clock is recorded but is not
  the observable.
- `prediction`: `vdim = 3^r` at `r` rounds. One free variable enters one S-box
  per round, so the eliminated univariate polynomial's degree multiplies by the
  S-box exponent each round. This is a Bézout-style upper bound, stated as the
  prediction because a measurement *below* it is the only direction an
  algebraic attack can live in.

## What counts as a result

- `break_criterion`: all four, and any one missing means no break is claimed.
  1. a rung at Tier E — decisive status *and* the observable present;
  2. `ideal_degree < 3^r` strictly, at that rung;
  3. both solvers agree on the solution count at that rung (`solvers_agree`);
  4. a candidate recovered from that rung passes all three L4 gates —
     recovery against `reference.py`, cost below the measured generic
     baseline, and scope.

  A rung satisfying 1–3 but not 4 is recorded as **structure**, which is the
  word `verify_claim.Verdict.word` already returns for it. Structure is a
  result and is logged as one; it is not an attack and the log must not call it
  one.

- `wall_criterion`: a rung where either solver exceeds `timeout_seconds`, or
  exits for want of memory. The wall is recorded as data at the round count
  where it falls — "rounds 1..n closed exactly, round n+1 exceeded the budget"
  is the expected output of most cells and is a complete result.

- `negative_criterion`: a ladder whose solved rungs all satisfy
  `ideal_degree == 3^r` is a **no-deviation** record. Every such record carries
  a blindness statement naming the round counts never reached, the single
  monomial ordering tried, and the fact that a degree matching the bound
  excludes nothing about attacks that do not proceed by degree collapse.

## Budget, fixed in advance

- `max_rounds`: 14
- `timeout_seconds`: 900
- `brute_force_limit`: 200000
- `solvers`: msolve 0.6.5 and Singular 4.3.2, both required; a rung carried by
  one solver alone is not Tier E.
- `planted`: runs on planted instances are labelled planted and can support no
  statement about the zero-target instance. This is a refusal in
  `verify_claim.check_scope`, not a caveat.

## What this cannot establish

Stated here so it cannot be added later as a softening:

- nothing about deployed Poseidon, Poseidon2, Rescue-Prime, Griffin or Anemoi
  parameter sets. The egress block that holds `algebraic-probe`'s E-04 open
  means no official test vector has been transcribed, so no run here is
  validated against a designer's own output;
- nothing about round counts beyond the solved rungs. Past the divergence round
  reported by `Ladder.divergence_round`, the two growth models disagree by more
  than a bit and the experiment does not choose between them;
- nothing about a prime other than the one a run names. `vdim` is a property of
  an ideal over a stated field.
