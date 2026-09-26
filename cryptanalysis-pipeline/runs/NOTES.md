# Notes on the committed runs

Append-only commentary. **No record in this directory is ever edited**, including
to correct a defect found after the fact. Where a run carries a known
deficiency it is described here, beside the record, and the record stands as
what the pipeline actually emitted at the time.

## `ladder-ee34b2be0be23222-1790359502.json` — calibration, 180s budget

Width-2 MiMC-sponge shape, p = 1073741831, planted instances. Rounds 1–6 Tier
E, `vdim = 3^r` exactly at every rung, deficit 0. Round 7 hit the wall.

## `ladder-a2de67ba8b6687a3-1790362133.json` — deep ladder, 900s per solver

Same shape and prime. Rounds 1–7 Tier E, `vdim = 3^r` exactly at every rung,
deficit 0 throughout. Round 8 hit the wall at 1800.1s — both solvers spending
their full 900s.

Round 7 closed in 541.8s, with a basis of 905 elements, top degree 5 and 414.7
MB peak.

**The wall moved with the budget, and that is the finding worth recording.**
Round 7 is a *wall* in the 180s run and *Tier E* in the 900s run. A wall is a
statement about a budget on a machine, never about the mathematics, and these
two records are the demonstration: the same rung of the same ladder is
unmeasured in one and exactly closed in the other. Any report quoting "the wall
is at round n" without its budget is quoting a number that changes when the
timeout does.

The fitted models on the deep ladder: exponential slope 1.58496 bits per round
against log2(3) = 1.5849625, RMS residual 3.4e-16 bits — the prediction
reproduced to floating-point noise across seven rungs. The polynomial model
fits far worse (residual 0.857 bits) and the two diverge beyond round 3, which
is the honest boundary of what these rungs support. Both are labelled MODEL and
neither is a measurement.

No deviations, no sanity failures, no solver disagreements in either run.

### Known deficiencies in both records

Stated rather than fixed, because fixing them in place would mean rewriting a
result.

1. **`msolve/unknown`, and `singular/unknown` in the earlier run.** The
   adapters read a version out of each binary's banner. msolve's `-h` output
   carries no version number at all, so every msolve cell recorded `unknown`;
   Singular's banner does carry one and was nonetheless missed in the earlier
   run, and twice again during later probing, for a reason that was not
   established across a dozen further attempts. PREREG-001 requires msolve
   0.6.5 and Singular 4.3.2, so neither record demonstrates that it satisfies
   the pre-registration it was run under. Both versions were available from the
   package database the whole time. Fixed for future runs by reading the
   package version first and refusing to mint a record whose version is the
   word `unknown`; these two records keep theirs.

2. **No `planted` or `contended_rounds` field.** Both runs used planted
   instances — a solution existed by construction, so neither says anything
   about the zero-target CICO problem. `Ladder.render()` printed that scope
   statement and `to_json()` dropped it, so the committed artefact omitted the
   fact that governs what its numbers may be used for. Fixed for future runs;
   for these two, the scope statement is here: **both runs are planted, and
   neither is evidence about the zero-target instance.**

3. **Neither run is stamped with a pre-registration.** PREREG-001 was written
   after both, and it says so in its own first paragraph. They are calibration
   runs — made to find out whether the pipeline measures anything at all — and
   a pre-registration cannot be applied backwards. They are not in the L5 hash
   chain, and `runs/log.jsonl` therefore starts empty.

4. **The deep run's `predicted_degree` came from the hardcoded `d ** rounds`.**
   For this spec the derived propagation gives the identical value at every
   rung (checked for rounds 1–8 before the change was committed), so the
   deficits above are unaffected. A leading-partial spec would differ.

## PREREG-002 sweep — the full 14-cell grid, closed

Poseidon-shaped specs, p = 1073741831, planted instances, at PREREG-002's full
900-second per-rung budget (`as_pre_registered=True`). The chain in
`log.jsonl` holds 14 records and verifies; the grid `sweep.py` reads out of
PREREG-002 declares 14 cells, and every one is present.

Every cell is a **no-deviation** record. Measured `vdim` equalled the
propagated prediction at every rung of every cell: no deviations, no walls, no
solver disagreements, no contended rounds. PREREG-002's break criterion is met
nowhere, so nothing here is a lead and nothing is promoted.

| width | rounds | measured vdim per rung |
|---|---|---|
| 2, 3 | 3 (0f+2p+1f) | 1, 3, 9 |
| 2, 3 | 3 (1f+1p+1f) | 3, 9, 27 |
| 2, 3 | 4 (1f+2p+1f) | 3, 9, 27, 81 |
| 2, 3 | 5 (1f+3p+1f) | 3, 9, 27, 81, 243 |
| 2, 3 | 5 (2f+1p+2f) | 3, 9, 27, 81, 243 |
| 2, 3 | 6 (2f+2p+2f) | 3, 9, 27, 81, 243, 729 |
| 2, 3 | 7 (2f+3p+2f) | 3, 9, 27, 81, 243, 729, 2187 |

### The leading-partial rows are the load-bearing measurement here

The two `0f+2p+1f` cells measured **1, 3, 9** — one round of lag, held for the
rest of the ladder. That is what `reference.predicted_ideal_degree` predicts and
it is *not* what `d ** rounds` predicts: the hardcoded exponent would have given
3, 9, 27, a deficit of 2, 6 and 18 at the three rungs, and a positive deficit is
the first clause of the break criterion. Those two cells would have reported a
deviation at every rung, in both widths, with nothing behind it.

So the derived prediction is no longer only an argument about constants raised to
powers. It is a measurement: the solver reports the lag the propagation
predicts, in the two cells PREREG-002 named in advance for exactly this reason.

### The partial-round hypothesis, as pre-registered

PREREG-002 states: a `vdim` below the propagated bound at a partial round and at
no full round is the deviation this ladder looks for. **It did not occur.** The
degree multiplied by 3 through every partial round in all 14 cells, which is
what the family's security argument requires of them. This run is consistent
with that argument and does not test it anywhere near deployed parameters.

### What this run does not establish

- **No wall was reached, and the grid could not reach one.** PREREG-002 fixes
  `max_rounds` at 10, but `poseidon_like` shapes in this grid total at most 7
  rounds, so the round cap never bound and no cell was budget-limited. The grid
  measured closable systems only; it says nothing about where these shapes stop
  being solvable. The deep MiMC-sponge ladder is the only wall this project has
  measured.
- **All instances are planted.** A solution existed by construction in every
  cell, so no cell is evidence about the zero-target CICO problem.
- **One monomial ordering, one solver pair, one 30-bit prime.** Deployed
  Poseidon uses 255-bit primes and round counts an order of magnitude higher,
  and nothing here extrapolates to them.
- **The width-2 half has no sweep report.** Its seven cells are in the chain,
  but the run that produced them died on the first width-3 cell before printing
  a report, and the report was not reconstructed afterwards. Coverage of all 14
  cells rests on the 14 chain records, not on a single report artefact.

## PREREG-003 — the solving degree, measured

The full fourteen-cell grid re-run with the solving-degree instrument, at
PREREG-002's budget, `as_pre_registered=True`, 1052s of 3300s, 14/14 attempted.
The `vdim` results are unchanged: no deviations anywhere.

### model_criterion: the fitted model failed, 0 of 12

`s(r) = 2r - 1` was fitted on one cell during instrument diagnosis, disclosed
as fitted in PREREG-003's first section, and predicted out-of-sample. It is
wrong on **every** cell it was tested on. The two leading-partial cells carried
no prediction by design.

This is the outcome the disclosure was written to make recordable. A model that
fails out-of-sample, written down first, is worth more than the same model
quietly dropped.

### structure_criterion: met in two cells

`2f+1p+2f` at width 2 **and** width 3, identically: solving degree
`1, 3, 5, 5, 5`, holding at 5 across rounds 3, 4 and 5 while `ideal_degree`
goes 27, 81, 243. Three consecutive rungs at constant solving degree with vdim
tripling at each — the registered wording, checked in code against the field
parsed out of the committed document.

Under PREREG-003 this is **structure, not a break.** The break criterion is
unchanged and requires the L4 gates including the cost gate. Nothing is
promoted.

### Two explanations ruled out, not argued away

An earlier note on these results offered instability as a possible explanation
for the flat run. **That explanation is wrong and is retracted here.**

- *Block selection.* Every F4 block msolve runs under a permuted variable order
  reports the **same** solving degree; only the final, different computation is
  higher (6,6,6,6,6,6,6,6,6,8 on one cell; 5×10 then 7 on another). Block 0 is
  representative of the Gröbner computation, not an arbitrary pick.
- *Nondeterminism.* Six independent repeat measurements of the hit cell, three
  at each width, returned `1, 3, 5, 5, 5` every time.

So the flat run is a deterministic, reproducible property of the system,
replicated across two widths.

### The post-hoc observation, labelled as post-hoc

Attributing each rung's change in solving degree to the kind of round it added,
across all fourteen cells — 50 steps — gives a clean separation:

| round added | n | range | mean |
|---|---|---|---|
| partial | 24 | +2 to +3 | +2.17 |
| full | 26 | −3 to +2 | +0.08 |

**Every partial round raised the solving degree. Full rounds did not, on
average.** That is the reverse of the intuition the family's design rests on,
where full rounds are the strong ones and partial rounds are the cheap ones
that still buy security.

Reproduce with `python3 analysis/round_kind_effect.py`.

**This was not pre-registered** — PREREG-003 registered a fitted model and a
constancy criterion, not this question — so it is hypothesis-generating and
nothing follows from it yet.

**And it may not be about the cipher at all.** A full round introduces `width`
new variables and equations where a partial round introduces one, and adding
generators can lower a system's degree of regularity. The effect may therefore
be a property of the one-variable-per-S-box **encoding** rather than of the
primitive. The decisive test is the same measurement under a second,
independent encoding of the same cipher: if it survives a change of encoding it
is about the primitive, and if it does not it is about the model. That test has
not been run, and until it is, this is a statement about a model of a cipher.

## PREREG-004 — the encoding control: `outcome_survives`

The full fourteen-cell grid re-run under the state encoding, `as_pre_registered=True`,
1792s of 3300s, 14/14 attempted. Every registered condition for
`outcome_survives` is met, evaluated in code against the field parsed out of
the committed document:

| Encoding | mean partial | mean full | gap | min(partial) > mean(full) | steps |
|---|---|---|---|---|---|
| S-box | +2.17 | +0.08 | +2.09 | +2 > +0.08 | 24p / 26f |
| state | +2.15 | +0.08 | +2.08 | +2 > +0.08 | 26p / 26f |

Gap ≥ 1.0 in both. Minimum partial-round change strictly above the full-round
mean in both. At least 15 attributable steps of each kind in both, so the
`minimum_steps` condition does not hold the reading back.

**The separation is not an artefact of generator counting.** Under the state
encoding every round adds exactly `2 × width` variables and `2 × width`
equations whatever its kind, so the bookkeeping difference the S-box encoding
carried is gone — and the numbers barely moved.

Stronger than the registered condition required: wherever both encodings
produced a measurement, the solving degrees are **identical rung for rung**,
not merely similarly distributed, while variable counts differ by up to 2.6×.

### What this licenses, in the document's own words

A claim that the solving degree of this construction tracks partial rounds
rather than full ones, under two independent models. That is all.

It is **not** a break. The break criterion is unchanged across PREREG-002, -003
and -004 and requires a candidate passing all three L4 gates — recovery against
`reference.py`, cost below the generic baseline timed on the same machine, and
scope. It has never been met, and nothing here attempts it.

### The one wall, pre-committed as expected

`t3-f4-p3` walled at round 7 under the state encoding after 1446.7s, having
closed round 6. The same cell closes round 7 under the S-box encoding.
PREREG-004 fixed the reading of this in advance: the state encoding is the
larger system, more walls are expected, and a cell that walls earlier there is
the cost of the control rather than evidence about either encoding.

### The one difference between the encodings

The leading-partial cells yield an observable at round 1 under the state
encoding and none under the S-box encoding. At round 1 that shape's only S-box
acts on a capacity element fixed to zero; the S-box encoding folds it into a
constant, leaving no equation, while the state encoding still carries variables
for it. So the state encoding measures one rung the other leaves unmeasured,
which is why its step counts are 26p/26f against 24p/26f rather than identical.

### What it still does not establish

- Two encodings are two, not many. This is evidence that the effect is not an
  artefact of *this* bookkeeping difference, not that no encoding would show
  something else.
- The solving degree is still measured by msolve alone. Singular corroborates
  the conclusion and `vdim`; its protocol output is not parsed.
- Rounds 1–7, a 30-bit prime, planted instances, degrevlex only. Deployed
  parameter sets are an order of magnitude away in both prime size and rounds.

### PREREG-004 discharged in the chain, and the stamping defect behind it

`runs/log.jsonl` seq 42 is an `outcome-survives` record naming PREREG-004 and
carrying its sha256 `f43b1e6be52945c3`. It holds the three registered
conditions with the values that decided them, the per-encoding statistics, a
blindness statement, and the content hashes of the 28 run artefacts it was
computed from. Reproduce with `python3 outcome.py`.

**The defect that made this necessary.** The first 42 chain records all name
**PREREG-002**, because `sweep.py` stamps the document it reads its grid from
and that is PREREG-002 for every sweep. So the runs discharging PREREG-003 and
PREREG-004 were chained as PREREG-002 runs, and neither of those documents was
referenced anywhere in the evidence chain. Their outcomes existed only in this
file's prose and in a terminal.

That is the failure the layer exists to prevent. A pre-registration fixes the
reading in advance so that applying it can be mechanical; if applying it is not
mechanical, fixing it in advance bought nothing. The verdict `outcome_survives`
rested, until seq 42, on my reading of a script's printout.

Two consequences, both recorded rather than corrected in place:

1. **The run records keep their PREREG-002 stamp.** They are append-only. The
   outcome record names the files it read by content hash instead, which is
   what ties the verdict to the exact runs.
2. **Those records carry no solving degree.** `to_record` now includes
   `solving_degrees` and `first_zero_reduction_degrees`, but the 42 records
   written before that change do not, so the chain alone cannot support a
   solving-degree claim over them — only the outcome record's cited files can.
   Runs from here on carry it in the chain.

PREREG-003 is **still not discharged in the chain.** Its `model_criterion`
(failed 0 of 12) and `structure_criterion` (met in 2 cells) are recorded in
this file and evaluated in code, but no outcome record names PREREG-003. That
is open work, not a closed loop.

### PREREG-003 discharged at seq 43 — and it fixed no verdict vocabulary

`runs/log.jsonl` seq 43 is an `outcome-unworded` record naming PREREG-003 and
carrying its sha256 `c86face0b68772e8`, with each registered criterion
evaluated from the run files:

| Criterion | Result |
|---|---|
| `model_criterion` | **FAIL** — `s(r) = 2r-1` held on 0 of 11 out-of-sample predicted cells |
| `structure_criterion` | **MET** — 2 cells, `t2 4f+1p` and `t3 4f+1p` |
| `break_criterion` | **not met** — clause 2 holds in 0 cells; no candidate reached the L4 gates |

**The defect this exposed.** PREREG-003 named its criteria but never defined a
word for the result, the way PREREG-004 defines survives / vanishes / reverses.
Choosing one now would be the after-the-fact naming the layer exists to
prevent, so the record's kind is `outcome-unworded` and the absence is visible
in the chain rather than resolved in a footnote. The first version of the
outcome machinery hardcoded PREREG-004's four words as if a verdict vocabulary
belonged to the module; it belongs to the document that fixed it.

**A correction.** Earlier notes and commit messages say the model failed "0 of
12". The correct figure is **0 of 11**: the twelve counted the cell the model
was fitted on, which PREREG-003 discloses and excludes. A model tested on the
data it was fitted to is not tested. The conclusion is unchanged — it held
nowhere.

Both pre-registrations that were open are now closed in the chain. PREREG-002
is discharged by its 42 ladder records; PREREG-003 at seq 43; PREREG-004 at
seq 42.
