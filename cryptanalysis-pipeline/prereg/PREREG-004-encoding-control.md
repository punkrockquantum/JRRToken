# PREREG-004 — is the round-kind effect about the cipher or about the model?

The decisive test for the post-hoc observation recorded in `runs/NOTES.md`
under PREREG-003: across 50 steps of the fourteen-cell grid, **every** partial
round raised the solving degree (+2 or +3, n=24) while full rounds averaged
+0.08 over a range of −3 to +2 (n=26).

That observation was not pre-registered and this document does not pretend
otherwise. What it pre-registers is the **test that can kill it**, written
before the test is run.

## The confound being removed

Under the S-box encoding (`compile_polysys.py`) the two round kinds differ in
two ways at once:

- a full round adds `width` cubic equations, a partial round adds one — the
  difference in nonlinearity, which is the thing of interest;
- a full round adds `width` variables and equations, a partial round adds one —
  a difference in generator count, which is bookkeeping.

Adding generators to an ideal can lower its degree of regularity on its own. So
the measurement above is consistent with two quite different stories, and under
that encoding alone there is no way to tell them apart.

The state encoding (`compile_state.py`) removes the second difference. Every
round adds exactly `2 * width` variables and `2 * width` equations whatever its
kind; only the number of those equations that are cubic changes. It is the same
cipher: the bidirectional round-trip passes on every shape at both widths, and
Singular reports the same `vdim` under both encodings in every case checked.

## What is being measured

- `prereg_id`: PREREG-004
- `target`: the fourteen cells of PREREG-002, compiled under **both** encodings.
- `observable`: `solving_degree` from block 0 of msolve's F4 table, exactly as
  PREREG-003 defines it, plus the per-step change attributed to the kind of
  round that step added — the quantity `analysis/round_kind_effect.py` computes.
- `prediction`: **none is offered for the state encoding.** The S-box-encoding
  numbers above are the thing being tested, not a prior for the new encoding,
  and writing down a second prediction fitted to the first encoding's data
  would repeat the error PREREG-003 disclosed.

## The three outcomes, and what each licenses

Stated in advance so that whichever occurs, the reading of it was fixed before
it was seen.

- `outcome_survives`: under the state encoding, partial rounds again raise the
  solving degree and full rounds again do not — concretely, the mean change for
  partial rounds exceeds the mean for full rounds by at least 1.0, and the
  minimum partial-round change is strictly greater than the mean full-round
  change. Then the effect is **not** an artefact of generator counting, since
  generator counts are now equal. It remains an observation about two encodings
  of a shape at a 30-bit prime over rounds 1–7, it is still not a break, and it
  still requires the L4 gates before the word attack is available. What it
  would license is a claim that the solving degree of this construction tracks
  partial rounds rather than full ones under two independent models.

- `outcome_vanishes`: the separation disappears — the two means differ by less
  than 1.0, or the sign pattern no longer separates. Then the PREREG-003
  observation was **about the encoding, not the cipher**, and it is recorded as
  a retracted lead. This is the outcome that would make the earlier note wrong,
  and it is written here so that recording it costs nothing.

- `outcome_reverses`: full rounds raise the solving degree more than partial
  rounds under the state encoding. Then the two encodings disagree about the
  cipher and **neither measurement can be used** until the disagreement is
  explained. A disagreement between two models of the same primitive is a
  finding about the models, and the honest response is to stop, not to pick the
  more interesting one.

- `break_criterion`: unchanged from PREREG-002 and PREREG-003. All four
  clauses, including a candidate passing all three L4 gates. Nothing in this
  document can produce a break on its own.

- `wall_criterion`: a rung where either solver exceeds `timeout_seconds` or
  exits for want of memory. A walled rung has no solving degree. The state
  encoding is substantially larger than the S-box encoding, so **more walls are
  expected**, and a cell that walls under the state encoding earlier than under
  the S-box one is not evidence about either — it is the cost of the control.

- `negative_criterion`: any outcome is recorded with `Ladder.blindness()`.
  `outcome_vanishes` is a negative and is recorded as one.

## Budget

- `max_rounds`: 10
- `timeout_seconds`: 900
- `widths`: 2 and 3
- `shapes`: the fourteen cells of PREREG-002
- `solvers`: msolve for the solving degree, Singular for corroboration of the
  conclusion and for `vdim`. The solving degree remains uncorroborated by a
  second implementation, as PREREG-003 records.
- `minimum_steps`: the comparison is not read unless the state encoding yields
  at least 15 attributable steps of each round kind. Below that the means are
  not worth comparing, and the run is recorded as inconclusive rather than
  reported as an outcome.

## What this cannot establish

- Two encodings are two, not many. Agreement between them is evidence that the
  effect is not an artefact of *this particular* bookkeeping difference. It is
  not evidence that no encoding would show something else.
- Nothing about deployed parameter sets, for the reasons PREREG-002 gives.
- Nothing about orderings other than degrevlex, or about msolve's
  permuted-order retries: every observable is from block 0.
- Nothing about the zero-target instance: every instance is planted.
