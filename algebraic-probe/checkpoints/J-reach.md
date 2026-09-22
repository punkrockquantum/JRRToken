# Checkpoint J — Module 2 built

The completion brief ordered M2 first. It was blocked *entirely* on E-03, because
its subject is SHA-256's message schedule and there was no SHA-256. E-03 resolved
on 2026-09-22, so M2 became buildable the same day.

Section 9 declares its quantity — "input bits reachable to each output bit at
round r; degrees of freedom" — and its tier: **P only**. Both parts are
properties of the wiring, so nothing in the module enumerates or samples, and
`declared_tiers` says so.

## Two registered predictions, resolved

PREREG-M2 §3 recorded three hypotheses before the measurement path existed. H1
(soundness) holds and is checked continuously. The other two were predictions
about SHA-256 specifically.

### H3 — confirmed

```
union of reachable bits complete at round          16
every output bit reaches every input bit at round  21
```

Round 16 is the round that consumes the last block word, so the union going
complete there is expected. That *every output bit individually* takes five more
rounds is the finding. Rounds 16–20 are where some output bits still cannot see
some input bits — the only regime in which a dependency-based distinguisher could
live.

### H2 — refuted

The prediction was that bit-level propagation would be strictly tighter than the
word-level closure somewhere, since rotations and shifts move bits rather than
merging them. **It never is.** `word_level_overstatement` is 0 at every round
count from 0 to 64.

Modular addition's carry chain unions every operand bit at or below each
position, and there are enough additions per round that every bit of a consumed
word becomes reachable anyway. This is a fact about ARX mixing rather than about
the implementation — a design whose mixing were rotation-only would separate the
two. The test asserts the refutation instead of being deleted, and the module
docstring's original claim was corrected to match what was measured.

## The freedom budget

```
rounds 0..16    free bits grow 32 per round, to 512
rounds 17..64   free bits stay 512; derived words grow
last directly settable round   15
```

From round 16 the schedule determines each word from words already committed, so
a later round spends what the first sixteen committed rather than adding freedom.
Mutant `RCH-03` makes the budget keep accumulating — wrong in the direction that
flatters an attack, which is why it is in the catalogue.

## Reachability is not dependence

The module reports a *reachable set* and never claims an output depends on what
it names. Section 6 requires that limit to be exhibited, and
`core.targets.CancellingXor` exhibits it: `f(x) = (A x) XOR (B x)` presents every
input bit as reaching every output bit, because every operation unions its
operands. The function is `(A XOR B) x`, and on rows where A and B agree the sum
is the zero row — those output bits are identically zero and depend on nothing.

Verified exhaustively: `verify/dependence.py` confirms output bits 2 and 5 are
constant while all 10 input bits are reachable. That file is also gate G10's
independent path, and it shares no code with the module.

## Where M2 stands

```
gates passed        9/11
outstanding         G04  pre-registration untracked (resolves on commit)
                    G06  no published anchor -- E-05, operator
controls            5/5 pass
calibration         BLOCKED, as M4 is, and not lifted by the controls passing
```

## What building a second module exposed

Two readiness gates were hard-coded to Module 1's quantity, and only a second
measurement path could reveal it. G08 recomputed every control with
`verify.anf.algebraic_degree` — Module 1's quantity and no other module's — and
G09 imported `blindness.inverse_map` by name.

Fixed by having the module declare and the gate dispatch: `SpecSheet` gains
`control_strategy` (`exhaustive-anf` for M1, `schedule-closure` for M2), and the
gate holds a wiring table for the blindness classes.

That table lives in the gate rather than in the modules, and the first attempt
got it wrong: a zero-argument `readiness_check()` in each blindness package
looked tidier, but it had to import `verify/` to build its measures — exactly the
coupling D-006 forbids. `scripts/ci_checks.py` caught it immediately. The wiring
needs both halves, so it belongs in the one place allowed to see both. Adding a
module now means adding one visible entry there, which is the honest cost of
keeping the halves independent.

## Verification

```
new tests        59 (29 module, 12 dependence, 7 blindness, 5 prereg, 6 misc)
reach layer      8/8 mutants killed
ci checks        5/5, including both import-independence rules
```

`RCH-08` needed two attempts. As first written it removed the unordered-pair
guard in `dependence_matrix`, and survived because the accumulator is `|=` — the
second visit to a pair contributes `f(x) ^ f(x) = 0`, so the mutant was merely
slower. Replaced with one that assigns rather than accumulates, which *also*
survived, because every function the tests used happens to differ at its last
input too. Closed by adding `f(x) = x0 AND NOT x1`, whose dependence on bit 0 is
invisible at the final comparison. Fourth equivalent mutant identified here; the
pattern each time is a step whose removal is masked by a later one.
