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
