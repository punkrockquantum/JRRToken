# PREREG-003 — the solving degree across the Poseidon-shape grid

A third document. PREREG-002 governs a `vdim` ladder and its observable is the
ideal degree; this one governs a different observable on the same grid, so it
is a new document rather than an edit, for the same reason PREREG-002 was.

## Disclosure, before anything else

**Some of the data this document predicts has already been seen.** While fixing
the parser that reads msolve's F4 round table, the solving degree was measured
on one shape — `poseidon-like-t2` with `rounds_full=4, rounds_partial=3` — at
rounds 1 to 5, giving 1, 3, 5, 7, 9. The `s(r) = 2r - 1` prediction below was
read off those five points. It is therefore **a model fitted to diagnostic
data, not a prior**, and this document exists to test it out-of-sample on the
other thirteen cells of the grid and at higher round counts.

Saying so is the point. A prediction fitted on data and then presented as
though it preceded it is the failure this whole layer is built against, and it
is invisible unless the person who did the fitting writes it down.

## What is being measured

- `prereg_id`: PREREG-003
- `target`: the same fourteen-cell grid PREREG-002 declares, same prime, same
  planted instances, same two solvers.
- `observable`: `solving_degree` — the highest degree at which msolve's F4
  reduced a matrix, taken from **block 0** of its verbose round table, which is
  the computation in the variable order the model declared. msolve runs F4
  repeatedly under permuted orders; a maximum over all of them belongs to no
  single computation and is not this observable. Recorded alongside it: the
  zero-reduction profile per degree, `matrix_cells` for block 0, and the number
  of F4 blocks.
- `reference`: the Macaulay bound for a zero-dimensional system,
  `1 + sum(d_i - 1)` over the generators, which for `c` cubic generators and
  any number of linear ones is `1 + 2c`. This is computed from the system, not
  fitted, and is stated as the reference a solving degree is compared against.
- `prediction`: `solving_degree(r) = 2r - 1` for shapes whose **first round is
  full**. For leading-partial shapes (`rounds_full = 1`) no prediction is made:
  the degree lag that `predicted_ideal_degree` propagates has no established
  counterpart for the solving degree, and inventing one after seeing three data
  points would be fitting twice. Those cells are recorded and not predicted.

## What counts as a result

- `break_criterion`: **unchanged from PREREG-002, and deliberately so.** A
  solving degree is never a break on its own. All four clauses still apply: a
  Tier E rung, a measured quantity below its prediction, both solvers agreeing,
  and a candidate passing all three L4 gates including the cost gate against
  the generic baseline measured on the same machine.

- `structure_criterion`: a solving degree **below the Macaulay bound is
  expected and is not a finding.** Every structured system is below it; that is
  what structure means, and reporting it as a result would be reporting that an
  iterated cipher is an iterated cipher. What would be a finding is a solving
  degree that is **constant or bounded in `r`** while `vdim` continues to grow
  as `3^r`, because then the Gröbner step stops being the cost and the entire
  cost of the attack moves into the final univariate solve — a qualitatively
  different situation from one where both grow. Stated as: three or more
  consecutive rungs in one cell with the same `solving_degree` while
  `ideal_degree` triples at each.

- `model_criterion`: the out-of-sample test. `s(r) = 2r - 1` either holds on
  the thirteen cells it was not fitted on, or it does not. Both outcomes are
  recorded. A model fitted on one cell and confirmed on thirteen is worth more
  than the same model asserted; a model that fails out-of-sample is worth
  recording precisely because it was written down first.

- `wall_criterion`: a rung where either solver exceeds `timeout_seconds` or
  exits for want of memory. A walled rung has **no solving degree**: msolve
  that is killed mid-computation has printed the rounds it completed, and the
  highest of those is the degree it got to, not the degree it needed. Such a
  rung is Tier `-` and its partial round table is not an observable.

- `negative_criterion`: a grid meeting the prediction everywhere is a
  no-deviation record carrying `Ladder.blindness()`.

## Budget

- `max_rounds`: 10
- `timeout_seconds`: 900
- `widths`: 2 and 3
- `shapes`: the fourteen cells of PREREG-002, unchanged
- `solvers`: msolve and Singular, both required; the solving degree comes from
  msolve alone, because Singular's protocol output is not parsed and claiming a
  corroborated solving degree would overstate what is measured.

## What this cannot establish

- **The solving degree is measured from one solver.** `solvers_agree` still
  covers the conclusion — whether solutions exist — but no second
  implementation corroborates the degree itself. A claim resting on the solving
  degree rests on msolve's F4 and on this parser.
- Nothing about deployed parameter sets, for the reasons PREREG-002 gives: no
  official test vector has been transcribed, the prime is 30-bit, and the round
  counts are an order of magnitude below deployed ones.
- Nothing about orderings other than degrevlex, or about what msolve's
  permuted-order retries would give: every observable is from block 0.
- **The first zero reduction degree is reported, not interpreted.** A zero
  reduction at the generators' own degree is routine and is not a degree fall.
  This document pre-registers no criterion on it, because one written now would
  be written to match three points already seen.
