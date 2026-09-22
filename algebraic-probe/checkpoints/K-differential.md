# Checkpoint K — Module 3 built, and the statistical layer finally does work

Three modules were left when the completion brief's ordered work ran out: M3, M5
and M6. M3 went first for one reason. Section 9 declares its tiers as **E and
S**, and it is the only module built so far whose declared tiers include S.

Everything the repository had built for sampled inference — Clopper–Pearson
intervals, Benjamini–Hochberg with an asserted family size, the power analysis,
the seed discipline — had been exercised only by the witness probe, where the
interesting cells are the *deductive* ones. An outside review had said as much:
the statistical apparatus is calibrated for a failure mode that is not the
field's dominant one, and Tier S is the weakest evidence class the instrument
emits. That criticism is not answered by building more statistics. It is answered
by finding the one place where the Tier S rule is load-bearing, and checking that
it holds there. M3 is that place, and §"What Tier S cost" below is what it took.

## What the module measures

```
differential_probability   Tier E where the space is exhaustible: count the
                           inputs with f(x) ^ f(x ^ din) == dout. Exact.
sampled_probability        Tier S otherwise: seeds drawn, hits counted, rate
                           reported with an exact interval. Never a bare point.
characteristic_steps       Rounds covered while the probability stays above the
                           random level. A count, not a probability.
```

The guard on the exact path is `MAX_EXACT_DIFFERENTIAL_VARS = 18`, and above it
the path **refuses** rather than switching silently to an estimate. That refusal
is the reason the two tiers cannot be confused: there is no code path on which a
caller asking for an exact probability receives a sampled one.

## What was measured

### x³ over GF(2ⁿ), n odd — computed, not cited

```
n = 7, 9, 11
maximum differential count      2         (probability 2^-(n-1))
random level                    2^-n
elevation above random          exactly one bit
fraction of the table that is
  exactly impossible            50.0%     at every n measured
```

The derivative of a quadratic power map is affine, so its image is a coset of an
index-two subspace: two-to-one onto half the space, zero on the other half. The
uniformity and the impossibility are the same fact seen from opposite sides.

`differential_uniformity` returning exactly 2 **is** the definition of almost
perfect nonlinear, and the test computes it rather than citing it.

### x³¹ over GF(2¹¹) at din=1

```
output differences with count 2    793
output differences with count 6     77
maximum                              6
```

This row is the subject of D-048. The calibration case for it first said **4** —
a number I wrote from a model of how high-degree power maps behave, with nothing
computing it. The control failed, which is the only reason it was caught.

The control itself now runs at n=7, where the row has the same two-valued shape
(43 counts of 2, 7 of 6) and the same maximum. The reason is the cost guard
below, and the expected value was recomputed at 7 rather than carried across.

### SHA-256, sampled

```
din = block bit 0 (in W[15]), dout = 0
  rounds  4    hits 50/50   ci [0.9289, 1]
  rounds 15    hits 50/50   ci [0.9289, 1]
  rounds 16    hits  0/50   ci [0, 0.0711]
  rounds 17    hits  0/50   ci [0, 0.0711]

din = block bit 480 (W[0] bit 0), dout = 0
  rounds  1    hits  0/50
  rounds  4    hits  0/50
```

## The cross-check worth having

The round at which a flipped W[15] bit stops being invisible is **16**.

Module 2 computes 16 as the first round at which the union of reachable block
bits is complete — by closing the schedule recurrence over *word indices*,
without ever evaluating SHA-256. Module 3 gets 16 here by evaluating the
compression function on sampled pairs and watching when the difference starts
propagating. The two share no code and proceed by different means.

The scope of the agreement is stated rather than left to be inferred: it is a
cross-check on both modules' reading of the message schedule, and a disagreement
would have meant one of them was wrong about it. It says nothing about the round
function, which neither computation examines, and nothing about any differential
at a round count above 16.

That result arrived by way of a failing test. The first draft used `din=1` and
expected no hits; it hit 50/50, because block bit 0 lies in W[15] and a 4-round
compression never reads that word. Identical to the trap `ARX-08` pins for the
degree arm. The observed behaviour is now asserted in two tests instead of being
worked around (D-050).

## The blindness class: the search looks upward

M3's null is "no differential above the random level was found". The threshold is
one-sided **by construction** — it asks whether a probability *exceeds* 2^-m.

x³ over GF(2ⁿ) reproduces that null exactly while carrying the structure the
search is looking for. Its best differential clears the threshold by one bit, the
smallest elevation an even-counted table can show, and half of every row is
unreachable. An impossible differential supports an attack as a probable one
does, and lies on the other side of the threshold.

```
blindness check   passed=True
observed          max_differential_count=2 p=2^-6 random=2^-7
                  barely_above_random=True impossible_fraction=0.5
                  structure_present=True
```

Two earlier candidate classes were tried and abandoned, both for the same reason
— they were not true:

- **Modular addition as XOR-differentially flat.** It is not. Measured median
  maximum ≈ 2^-3.4 against a random level of 2^-10.
- **A product-rule / composition deviation.** Searched; the deviation is
  **exactly 0**.

Neither is recorded as a near miss. A blindness class has to *have* the property
being searched for, and `structure_predicate` enforces that in code: the check
passes only if the search returns its null **and** the structure is really there.

## What Tier S cost

`interval_excludes_random_level` returns `ci_low > random_level`. Substituting
`rate > random_level` — the point estimate — **survived every test the module
had**. Every sampled cell in the repository sat at 0 hits or at 50, where the
point estimate and the interval bound fall on the same side of the random level.

The honest options were to accept a weaker mutant or to measure the missing cell.
The cell was measured:

```
RandomFunction.create(12, 6, 1), din=1, dout=10
  hits            1/50
  rate            0.02
  random level    2^-6 = 0.015625
  ci_low          0.000506228
  point estimate clears the random level    True
  interval clears it                        False
```

Fifty draws cannot separate one hit from chance at this output width. The test
pins the straddling cell and `DIFF-04` enforces it (D-051).

This is the answer to the review's Tier S criticism, and it is a narrow one. The
discipline is now load-bearing in one place and tested there. That is a smaller
claim than "the statistical layer is validated", and it is the claim being made.

## A guard that bounded one exponent while the cost had two

The three M3 test files took 184 seconds and `scripts/readiness_report.py` took
over a minute and a half. Both traced to one defect, and it is a defect in a
guard rather than in a measurement.

`MAX_EXACT_DIFFERENTIAL_VARS = 18` and `MAX_DDT_VARS = 18` bound a *variable
count*. Three computations here do not cost 2^n:

```
modules: max_differential_hits      2^(n+m)   one full pass per output difference
verify:  differential_uniformity    2^(2n)    one full pass per input difference
verify:  impossible_fraction        2^(2n)    same
```

| n | exponent | uniformity | impossible_fraction | module max-over-row |
|---:|---:|---:|---:|---:|
| 7 | 14 | 0.11s | 0.12s | 0.28s |
| 9 | 18 | 2.20s | 2.28s | 5.53s |
| 11 | 22 | 44.51s | 43.41s | ~88s |

At n = m = 18 — which both existing guards **permit** — a sweep is 2^36
Python-level evaluations. That is not a slow computation, it is one that does not
finish, and it was being let through by a guard whose stated job is to refuse
rather than estimate.

`MAX_ROW_SWEEP_BITS = 18` budgets the **exponent sum**, in both files, and each
sweep checks its own exponent. The value is not chosen to permit what already
ran: it is the same 2^18-Python-evaluation budget `MAX_DEPENDENCE_VARS`,
`MAX_DDT_VARS` and `MAX_EXACT_DIFFERENTIAL_VARS` already carry, applied to the
quantity that governs the cost. Raising it happens at the call site via
`budget_bits`, not by editing a constant.

**What was deliberately not done.** The obvious fix is to have the module tally a
whole row in one pass, making the quantity linear. Rejected: that is
`verify/differential.py`'s algorithm, and the module's per-pair counting is its
own declared method. Two paths that share an algorithm are one path with a copy,
and gate G10 rests on them not being. The quadratic cost is what the independence
costs; it is bounded, not erased.

**The control moved and the value was recomputed.** `CAL-M3-INT-POWER` ran at
n=11, which the new guard refuses and which cost ~88 seconds on every invocation
of a tool the operator runs. It moves to n=7 — and because "a control got smaller
and the suite got faster" is the shape of the thing the brief forbids, three
things are stated: the control passed at *both* widths, so nothing was failing;
the expected value was **recomputed** at 7 (43 counts of 2 and 7 of 6, maximum 6)
rather than carried across from 11 (793 and 77, same maximum); and 2^7 is a
smaller space than 2^11, which makes it weaker in that one respect and is
recorded rather than glossed.

**The n=11 evidence was kept.** `EXPECTED_IMPOSSIBLE_FRACTION = 0.5` is
documented as measured at n = 7, 9 *and* 11, and the README and the blindness
statement both rest on it. Dropping 11 because a guard now refuses it would have
quietly narrowed the evidence behind a claim left standing at full strength, so
the n=11 confirmation lives in a test that raises the budget explicitly and is
marked slow.

## The third gate hard-coded to Module 1

D-044 found two. `T01`/`T03` were the third: they probed the target by calling
`compress()` with no arguments and expecting `NotAuthorised` — meaningful only
while SHA-256 was a stub, and quietly passing for the wrong reason once E-03 made
it real. `T01` now evaluates the target and checks bit-identity against
`hashlib`; `T03` dispatches on a declared `support_probe` (`degree-paths` for M1,
`differential-paths` for M3). Recorded as D-049, including what it does not
license: three quantities is a weaker basis than "the general case".

## Where M3 stands

```
gates passed        11/11  (10/11 before the commit; G04 asks whether the
                    pre-registration is tracked, so committing it is what
                    resolves that gate -- it cannot be settled beforehand)
controls            4/4 pass
calibration         BLOCKED on CITE-SHA256-DIFF
target              sha256-compression-parametrised NO-GO on
                    T02:target-ground-truth-verified
```

M3 is blocked by an anchor that is *named and unreachable*, which is E-04's
class, not E-05's. The brief names a published anchor for M3 — reduced-round
SHA-256 differential results — and `eprint.iacr.org` returns `EGRESS_BLOCKED`
from this environment. A test asserts that distinction rather than leaving it in
prose: `allow_missing_ground_truth` is **False** for M3, unlike M2 and M4 where
the brief named no anchor at all.

The calibration gate stays blocked with the controls passing, which is the
designed behaviour and was not relaxed to obtain a better line here.

## Verification

```
new tests        45 (27 module, 11 blindness, 7 prereg)
differential     12/12 mutants killed, 0 survivors
                 (catalogue now 132 mutants across 15 layers)
runtime          three M3 files 184s -> 76s; readiness report 3.5s
ci checks        5/5
```

Fifth equivalent-mutant class identified, and the first resolved by measuring a
new cell rather than by rewriting the mutant: `DIFF-04` was not equivalent, it
was untested, and the distinction matters because the fix is a test rather than a
different mutation.
