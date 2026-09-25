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
