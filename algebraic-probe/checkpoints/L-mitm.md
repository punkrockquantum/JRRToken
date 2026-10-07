# Checkpoint L — Module 5 built

Section 9 declares M5's quantity as "splitting points, independent chunks,
matching degrees of freedom" and its tiers as **P and E**. Both are properties of
the message schedule's wiring, so nothing in the module samples, and
`declared_tiers` says so.

## What a split is, as this module measures it

Cut the round sequence. The rounds before the cut are one chunk, the rounds after
it the other. A block word consumed by one chunk and **not** the other is
*neutral* for that chunk — it moves one side while the other stands still. A cut
with a non-empty neutral set on **each** side is what lets the two sides be
enumerated separately and met in the middle.

Consumption is a transitive closure over the recurrence, taken over word indices
(Tier P). The sweep over cuts is a complete enumeration of a stated, finite space
— at most 65 cuts (Tier E).

## The result

```
rounds   independent cuts   matching freedom
  16           15               256 bits
  17           13               224
  18           12               192
  19           11               160
  20           10               128
  21            9                96
  22            8                64
  23            7                32
  24            0                 0
```

Matching freedom falls by **exactly one word — 32 bits — per round** from 16, and
reaches zero at 24. The last round count with a word-level split is **23**.

The closed form is asserted rather than tabulated: `matching_dof(end)` is
`(24 - end) * 32` for `end` in [16, 24). A table would have gone stale silently;
a closed form fails loudly if the schedule is misread.

This sits next to M2's finding rather than repeating it. M2 measured that round 16
is where the union of reachable block words is complete. M5 measures what happens
*after* that: from the round the block is fully consumed, the schedule ties the
two halves together one word at a time, and eight rounds later no word-level
split survives at all.

## Two readings of the same schedule, written twice

M5 does **not** import M2's closure. `SCHEDULE_OFFSETS` is written out a second
time, and a test asserts the two agree at all 64 indices. A shared reading would
be one reading; two hand-written ones can disagree, and a disagreement would mean
one of them is wrong about SHA-256.

The same choice is behind `verify/mitm.py`, which shares no code with either. It
calls the real `core.sha256.message_schedule`, flips one bit of one block word at
a time, and records which schedule words moved. That gives

```
observed dependence  ⊆  true dependence  ⊆  consumption
```

so an observed dependence outside the module's consumption set refutes the
module. A wrong offset shows up immediately.

**Measured: the two agree exactly.** At every schedule word below 24, observed
dependence equals the closure. Consumption is an upper bound in principle and
tight in fact, here. That is asserted as a test rather than assumed, because if a
later change made it loose, the blindness class would stop being hypothetical and
every null this module emits would weaken.

## The blindness class

`W[t] = W[t-4] XOR W[t-4] XOR W[t-1]`. The repeated term annihilates, so every
derived word is just `W[t-1]` and the tail depends on block word 3 alone. The
wiring cannot see the cancellation and reports the tail consuming all four.

```
                    by the wiring      in truth
forward  [0, 3)     {0, 1, 2}          {0, 1, 2}
backward [3, 8)     {0, 1, 2, 3}       {3}
forward neutral     {}                 {0, 1, 2}
independent split   no                 yes
```

The module reports no split for a schedule that has one, with three words of
forward freedom unreported. Across the whole counterexample: the wiring finds
**0** independent cuts, the truth finds **3**.

The direction is recorded because it matters. This **under-reports** attack
structure rather than inventing it, so it cannot produce a false positive — and a
null from this module is correspondingly not evidence that no split exists.

## What the module will not claim

An independent split is necessary for a meet-in-the-middle attack and nowhere
near sufficient. Nothing here models matching, memory, partial matching, message
compensation, initial structures or bicliques, and the module never evaluates the
compression function.

PREREG-M5 §7 records the consequence in the gate itself: `balanced_matching_dof_bits`
is **256**, against a declared feasibility ceiling of **63.1**. Degrees of freedom
on paper are not an attack budget. The pre-registration registers that `False`
explicitly, so it cannot later be produced as a caveat.

## Two structural facts the build surfaced

**A blindness case cannot also be a recomputable control (D-056).** The first
draft made `CancellingSchedule` the blindness case's target. G08 failed: the
module gives 0, the independent path gives 3 — which is the blindness class
working exactly as designed. `run_controls` checks the module against the
expected value and G08 checks the independent path against the *same* value, so a
counterexample built to make them disagree cannot satisfy both. M3 had already
solved this by asserting a value both paths agree on and exhibiting the
disagreement in a dedicated test; nobody had written down why. M5 rediscovered
the constraint by violating it.

**An equivalent mutant that was equivalent by construction (D-057).** `MITM-06`
drops the last round from `last_independent_round`'s sweep, and survived —
because that function could only ever be asked about SHA-256, and nothing splits
at round 64. Not a step masked by a later step, which is the pattern behind the
other four: a function with one possible input cannot be mutation-tested at all.
Fixed by widening the interface to take `max_end` and `consume`, as every other
entry point already did.

Its mirror image, `MITM-08`, inverts the soundness subtraction and was **not**
equivalent — merely untested, because on SHA-256 the two sets are equal so either
direction passes. Killed by a test on the counterexample, where consumption is
strictly looser. Same lesson as D-051: ask which inputs could tell them apart.

## Where M5 stands

```
gates passed        10/11
outstanding         G04  pre-registration untracked (resolves on this commit)
controls            4/4 pass
calibration         BLOCKED on CITE-SHA256-MITM
target              sha256-compression-parametrised NO-GO on
                    T02:target-ground-truth-verified
```

M5 is E-04's class, like M1's two blocked targets and M3's: an anchor the brief
**names** and this environment cannot reach. That now accounts for four
module-target pairs. It is one act — transcribing published values — and building
more modules keeps landing on it.

## Verification

```
new tests        44 (29 module, 10 blindness, 8 prereg, less overlap)
mitm layer       11/11 mutants killed, 0 survivors
ci checks        6/6
```
