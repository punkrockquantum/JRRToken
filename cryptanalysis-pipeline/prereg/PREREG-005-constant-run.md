# PREREG-005 — do full rounds after the last partial round move the solving degree?

The constant-run question. PREREG-003 met its `structure_criterion` in one
shape at both widths: `2f+1p+2f` measured a solving degree of `1, 3, 5, 5, 5`
while `vdim` went `27, 81, 243` across the last three rungs. The two full
rounds after the partial round added nothing to the solving degree. PREREG-004
then found, across 50 attributable steps under two encodings, that partial
rounds raised the solving degree (+2 to +3) and full rounds on average did not
(+0.08, range −3 to +2).

Both are statements about shapes with at most two trailing full rounds, because
`poseidon_like` splits `rounds_full` evenly and PREREG-002's grid stopped at
four. Constancy over two rungs is not constancy. This document registers the
shapes that can tell the difference, and fixes the reading of each answer
before any of them is run.

## Why this matters, and what it would not mean

If the solving degree is set by the partial rounds and does not move through
the full rounds that follow them, then for this shape the quantity that
governs F4's cost is bounded by the partial-round count while the ideal degree
keeps tripling. That is the reverse of the intuition the family's design rests
on, where the full rounds are the strong ones. It would be an observation
about a script-generated shape at a 30-bit prime, measured by one solver under
one ordering. It would not be a break, it would not transfer to any deployed
parameter set, and the word attack stays behind the L4 gates whatever this
document's outcome.

## What is being measured

- `prereg_id`: PREREG-005
- `target`: Poseidon-shaped specs from `spec.Spec.create` with an explicit
  round split — `rounds_full_first` full rounds, then `rounds_partial` partial
  rounds, then `rounds_full_last` full rounds — at widths 2 and 3, capacity 1,
  S-box exponent 3, constants and MDS derived as in PREREG-002. The shapes
  below are chosen so that the run of full rounds after the last partial round
  is long: three to six rounds, against the two that every earlier cell had.
- `encoding`: sbox

  That is `compile_polysys.py`, one variable per S-box, the encoding every
  earlier solving-degree measurement was made under. PREREG-004 established
  that the state encoding gives the same solving degree rung for rung on the
  fourteen-cell grid, so it is not re-run here; a run under it is welcome and
  is not required for the reading.
- `observable`: `solving_degree` from block 0 of msolve's F4 table, exactly as
  PREREG-003 defines it. From it, per cell, the **trailing run**: the solving
  degrees at the rung whose last round is the last partial round, and at every
  closed rung after it. A **trailing step** is the change in solving degree
  between two consecutive closed rungs inside the trailing run. A cell's
  **drift** is the solving degree at its last closed rung minus the solving
  degree at the rung of the last partial round.
- `prediction`: for `vdim`, `reference.predicted_ideal_degree`, unchanged from
  PREREG-002; on these shapes the free variable reaches an S-box in round 1 and
  the propagated bound equals `3^r`. For the solving degree, **no numerical
  prediction is offered**. PREREG-003 disclosed what a fitted model is worth,
  and the observation above is a prior, not a prediction. What is fixed is the
  question and the reading of each answer.

## Coverage, fixed before the run

A cell that walls before three trailing steps are closed has not answered the
question and is not read. The reading is over the cells that did.

- `minimum_trailing_steps_per_cell`: 3
- `minimum_covered_cells`: 4
- `minimum_pooled_steps`: 15

A cell is **covered** when at least `minimum_trailing_steps_per_cell`
consecutive trailing steps are closed with a solving degree. The reading needs
at least `minimum_covered_cells` covered cells with **both widths represented
among them**, and at least `minimum_pooled_steps` trailing steps pooled across
the covered cells — the latter for the same reason PREREG-004 fixed 15 per
round kind. Below either, the run is recorded as `outcome_inconclusive` and
nothing further is read.

## The readings, and what each licenses

Fixed in advance so that whichever occurs, the reading of it was not chosen
after it was seen. The words below are this document's verdict vocabulary;
the outcome record's kind is one of them and nothing else.

- `outcomes`: outcome_constant, outcome_grows, outcome_drifts, outcome_inconclusive
- `negatives`: outcome_constant

`outcome_constant` claims an absence — that trailing full rounds do not move
the solving degree — and is recorded with a blindness statement like any other
negative. The other three claim no absence; `outcome_inconclusive` claims
nothing at all.

- `outcome_constant`: in **every** covered cell the drift is within
  `drift_tolerance` of zero, **and** the pooled mean trailing step is within
  `constant_mean_tolerance` of zero. Then the solving degree of this shape is
  set by the rounds up to and including the last partial round and does not
  move through three to six full rounds after it, at both widths. What this
  licenses is that sentence, about this shape, at this prime, under this
  encoding and solver. It does not license any statement about rounds beyond
  the deepest closed rung, about the zero-target instance, or about any
  deployed parameter set.
- `outcome_grows`: the pooled mean trailing step is at least
  `growth_mean_minimum`. Then trailing full rounds do raise the solving
  degree, at a rate of at least one per round on average, and the constant
  runs PREREG-003 saw were short-range. The PREREG-003 structure observation is
  recorded as not extending, which is the outcome this document is written to
  make cheap to record.
- `outcome_drifts`: neither of the above — the degree moves, but by less than
  a round's worth on average, or unevenly across cells. This is recorded and
  **licenses nothing**. It is not turned into a third story after the fact; if
  it occurs, the next document says what would distinguish the cases.
- `outcome_inconclusive`: the coverage conditions above are not met. Walls are
  the expected reason. An inconclusive run is a statement about the budget,
  not about the shape.

- `drift_tolerance`: 1
- `constant_mean_tolerance`: 0.25
- `growth_mean_minimum`: 1.0

- `break_criterion`: unchanged from PREREG-002, all four clauses, including a
  candidate passing all three L4 gates. Nothing in this document can produce a
  break on its own, and a constant solving degree is clause two of nothing:
  `vdim` is expected to match its prediction at every rung.
- `wall_criterion`: a rung where either solver exceeds `timeout_seconds` or
  exits for want of memory. A walled rung has no solving degree and ends the
  cell's trailing run. The deepest shapes here reach eight rounds, where the
  MiMC-sponge ladder walled at this budget, so **walls are expected** and a
  cell that walls before coverage is the cost of asking, not evidence.
- `negative_criterion`: every outcome is recorded with a blindness statement;
  `outcome_constant` is a negative and is recorded as one.

## Budget

- `max_rounds`: 10
- `timeout_seconds`: 900
- `widths`: 2 and 3
- `shapes`: nine explicit splits, each run at both widths — `1f+1p+3f`,
  `1f+1p+4f`, `1f+1p+5f`, `1f+1p+6f`, `2f+1p+3f`, `2f+1p+4f`, `2f+1p+5f`,
  `1f+2p+3f` and `1f+2p+4f` — eighteen cells. The `2f+1p+kf` row extends the
  PREREG-003 structure cell by one, two and three trailing rounds; the
  `1f+1p+kf` row asks the same question with the shortest possible prefix; the
  `1f+2p+kf` row asks whether two partial rounds change the answer.
- `solvers`: msolve for the solving degree, Singular for corroboration of
  `vdim`. The solving degree remains uncorroborated by a second implementation,
  as PREREG-003 and PREREG-004 record; parsing Singular's protocol output is
  instrument work this document does not wait for.
- `exclusivity`: one ladder at a time, as PREREG-002.
- `planted`: every instance is planted and supports no statement about the
  zero-target instance.
- `stamping`: the sweep is run with `--prereg` naming this document, so every
  ladder record it writes carries this document's sha256. The PREREG-002
  stamp on the first 42 chain records is the defect this field exists to not
  repeat.

## What this cannot establish

- Constancy over up to six trailing rounds is not constancy beyond them. The
  deepest closed rung bounds every statement.
- One encoding. PREREG-004's agreement between two encodings was on shapes
  with at most two trailing rounds and does not automatically extend.
- One solver's report of the solving degree, block 0, degrevlex. A second
  implementation reporting the same quantity is the next instrument step and
  is not this document.
- A 30-bit prime, planted instances, rounds 1–8 at most. Deployed parameter
  sets are an order of magnitude away in both prime size and round count, and
  nothing here reaches them.
- Nothing about why. A constant run, if it occurs, is a measurement in want of
  an explanation, and the explanation is not licensed by the measurement.
