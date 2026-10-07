# PREREG-002 — Poseidon-shaped ladders with partial rounds

A second document rather than an edit to PREREG-001. PREREG-001 names a width-2
all-full MiMC-sponge shape and states its prediction as `3^r`; that is not the
prediction for a spec with partial rounds, and rewriting a committed
pre-registration to cover a new target is the move the whole layer exists to
prevent. Results are append-only, and so are the documents that govern them.

## What is being measured

- `prereg_id`: PREREG-002
- `target`: the Poseidon shape as `spec.poseidon_like` generates it — widths 2
  and 3, capacity 1, S-box exponent 3, `rounds_full` full rounds split across
  the two ends with `rounds_partial` partial rounds between. Round constants
  from `spec._derive_constants`, MDS from `spec._derive_mds`. The shape only.
  No deployed Poseidon or Poseidon2 parameter set is instantiated here and no
  statement below transfers to one.
- `observable`: Singular's `vdim` for the CICO ideal — solutions over the
  algebraic closure with multiplicity. Wall-clock, peak memory and the maximum
  degree reached are recorded and are not the observable.
- `prediction`: `reference.predicted_ideal_degree`, which propagates a degree
  bound through the declared round kinds: capacity and pinned rate elements
  start at degree 0 because they are constants, free rate elements at 1; an
  S-box multiplies a non-zero degree by the exponent and leaves 0 unchanged;
  the Cauchy MDS layer gives every output the maximum degree present. This
  equals `d^r` whenever the free variable reaches an S-box in round 1 and is
  lower by a factor of `d` per leading partial round when it does not. It is
  fixed here, before the runs, because `d^r` would overstate it on exactly the
  shapes this document covers and an overstated prediction manufactures a
  deficit where nothing collapsed.

## What counts as a result

- `break_criterion`: all four, and any one missing means no break is claimed.
  1. a rung at Tier E — decisive status *and* the observable present;
  2. `ideal_degree` strictly below `predicted_ideal_degree` at that rung;
  3. both solvers agree on the solution count at that rung;
  4. a candidate recovered from that rung passes all three L4 gates —
     recovery against `reference.py`, cost below the generic baseline measured
     on the same machine, and scope.

  A rung satisfying 1–3 but not 4 is **structure**, is logged as structure, and
  is not an attack.

- `wall_criterion`: a rung where either solver exceeds `timeout_seconds` or
  exits for want of memory. The round count where the wall falls is the result.

- `negative_criterion`: a ladder whose solved rungs all meet the prediction is
  a no-deviation record and carries the blindness statement
  `Ladder.blindness()` assembles from the run.

- `partial_round_hypothesis`: the one thing worth stating in advance about this
  target, because it is where the family's security argument lives. Partial
  rounds are cheap to arithmetise, and the argument that they nonetheless buy
  security rests on the degree continuing to multiply through them. The
  propagation above says it does, via the MDS layer. **If a measured `vdim`
  comes in below the propagated bound at a partial round and at no full round,
  that is the deviation this ladder is looking for.** Stated now so that
  finding it is a confirmation and not a story told afterwards.

## Budget, fixed in advance

- `max_rounds`: 10
- `timeout_seconds`: 900
- `brute_force_limit`: 200000
- `widths`: 2 and 3
- `shapes`: `rounds_full` in {2, 4} crossed with `rounds_partial` in {1, 2, 3},
  plus `rounds_full` = 1 with `rounds_partial` = 2, which is the leading-partial
  case that the previous hardcoded prediction got wrong.
- `solvers`: msolve 0.6.5 and Singular 4.3.2, both required. A rung carried by
  one solver alone is not Tier E.
- `exclusivity`: one ladder at a time. A rung measured while another solver was
  running lands in `contended_rounds` and cannot carry a cost claim.
- `planted`: planted runs are labelled planted and support no statement about
  the zero-target instance.

## What this cannot establish

- nothing about any deployed parameter set. No official test vector has been
  transcribed, because `eprint.iacr.org` is unreachable from this environment —
  the same egress block that holds `algebraic-probe`'s E-04 open. A spec that
  cannot be checked against its designers' own output is a shape, and this
  document calls it one throughout;
- nothing about round counts beyond the solved rungs, or beyond the divergence
  round the two growth models report;
- nothing about the security of the Poseidon family. A ladder over a
  script-generated shape at a 30-bit prime measures solver behaviour on systems
  of that shape. The published parameter sets use 255-bit primes and round
  counts an order of magnitude higher, and no extrapolation here reaches them.
