# Checkpoint M — Module 6 built, and the brief's module list is complete

Section 9 declares M6's quantity as "rotational-pair propagation probability" and
its tiers as **P and S**. It is the last of the six modules the brief specifies.

## What it measures

A rotational pair is `(x, x <<< r)`. A function propagates it when rotating the
input rotates the output: `f(x <<< r) == f(x) <<< r`.

Two facts drive everything, and the first is why the technique exists:

**XOR and rotation propagate a rotational pair with probability exactly 1.**
Rotation distributes over XOR and rotations compose, so a circuit of those two
is *completely transparent* to a rotational pair at any depth. Deductive, Tier P.
Checked exhaustively at every rotation amount anyway.

**Modular addition does not.** The two sides differ when the carry crossing the
rotation boundary differs. The exact probability, from the carry cases:

```
p(width, r) = (1 + 2^-r + 2^-(width-r) + 2^-width) / 4
```

So a rotational characteristic's probability is governed by **how many modular
additions a design performs**, not by how many rounds it runs. That is the
number this module reports.

## The closed form is derived here and verified by counting

The formula above is a claim I wrote. `verify/rotational.py` shares no code with
the module and settles it by counting every `(x, y)` pair:

```
width  r   closed form    counted        agree
  4    1   27/64          27/64          True
  6    3   81/256         81/256         True
  8    5   297/1024       297/1024       True
        ... every amount at widths 4, 6, 8 ...
disagreements: 0
```

At SHA-256's width:

```
p(32, 1) = 6442450947 / 17179869184 = 2^-1.415037
additions to reach the 2^-256 level = 181
```

Reported as an exact `Fraction`, not a float. An exactly-rational probability
printed as a decimal invites a reader to take it for a measurement.

## What SHA-256 actually performs, instrumented

The addition count had to be a measurement of the implementation rather than a
number read off the specification, so `CountingWord` wraps a 32-bit word,
forwards every operation and tallies only `+`. Running the real `compress`:

```
rounds   additions
   0          8      (the feed-forward alone)
   1         15      (+7 per round)
  17        130      (+10 once the schedule derives words)
  64        600
```

181 additions sink the characteristic, and SHA-256 crosses that at **round 23**.

**An earlier draft reported 5 additions for one round.** It wrapped only the
message words, and an addition between two plain ints never reaches the wrapper,
so every addition on the state alone went uncounted. The figure it produced was
the count of additions *touching a message-derived word* — a different quantity
from the one the name promised. Both the state and the message are instrumented
now.

**A coincidence, flagged as one.** Module 5's last independent round is also 23.
The two computations share no mechanism — one counts modular additions against a
probability threshold, the other closes the message schedule over word indices —
and the agreement is chance. Recorded here and asserted in the test so that
nobody, including me, later reads it as structure.

## The blindness class, and both numbers are exact

`f(x) = (x <<< r) XOR C` with `C` not rotation-invariant:

```
f(x <<< r) = (x <<< 2r) XOR C
f(x) <<< r = (x <<< 2r) XOR (C <<< r)
```

Equal only when `C == C <<< r`. For a constant that is not rotation-invariant
they are equal at **no input at all**, so the plain measure returns probability
exactly **0** — not at the random level, but the strongest null it can emit.

Meanwhile the offset between the two sides is `C XOR (C <<< r)`, the same value
everywhere: a rotational-XOR characteristic of probability exactly **1**.
Measured at width 16, r = 3, C = 0x00FF: propagation 0/65536, one distinct
offset (0x707) across all 65536 inputs, matching the derived value.

This is the sharpest blindness class in the repository because neither number is
elevated or reduced — they are 0 and 1. It is also why the technique is named
rotational-**XOR**: a module measuring only the plain relation measures the
special case `offset = 0` of the thing that matters. A design's round constants
alone are enough to produce the null.

The control that turns the mechanism off is included: with an all-ones constant,
equal to its own rotation, the plain relation holds everywhere and
`counterexample()` **refuses to construct** — a blindness class must have the
structure, not merely evade the measure.

## Three survivors, three different reasons (D-058)

The first mutation run left three alive. They looked alike in the report and were
not alike at all.

**`RX-03` was genuinely equivalent.** The closed form is symmetric in the two
parts the rotation cuts the word into, so swapping them is a no-op — at every
width and amount, checked. Sixth equivalent mutant, and the first that is
equivalent through an algebraic symmetry rather than through masking. Replaced
with a term-position mutant that dies at once, and the symmetry is now asserted,
since a property that makes a whole class of mutation equivalent is worth stating
once. It also explains H2's confirmed prediction: `p(w, r) == p(w, w - r)`, so
rotation by 1 and by `width - 1` are equally good for an attacker.

**`RX-04` was equivalent because its branch was unreachable.** `>` versus `>=`
differ only when `p ** k` lands exactly on the floor, and every probability this
module derives has a non-power-of-two numerator, so it never does. This is
D-057's pattern a second time, in a second module. Fixed the same way: the
function now takes an explicit probability, and with `p = 1/2` against a 4-bit
level the boundary is exact.

Twice in two modules is not coincidence. Before recording any further mutant as
equivalent, check whether the equivalence is a fact about the code or an artefact
of what the code can be asked.

**`RX-06` was not equivalent, merely untested.** The Tier S rule decided by the
point estimate instead of the interval — identical to `DIFF-04`, and it survived
for the identical reason. Closed by constructing the missing cell: 1 hit in 50, a
rate of 0.02 against a 2^-8 random level of 0.0039, exact lower bound 0.000506.
That this recurred in a second Tier S module means the straddling cell is a
**required fixture** for any module that samples, not a curiosity.

## A control must be computable by both paths (D-059)

The intermediate control first asked for the figure the module reports — 181
additions at width 32. G08 failed, because the counted path cannot enumerate 2^64
pairs.

Having the recomputer raise `_Unrecomputable` would have been wrong, and the gate
is right to treat it as a failure: a control only one path can compute
cross-checks nothing. The control moved to width 8, where both paths run and
agree on **183**, and the 32-bit figure remains what the module *reports* rather
than what a control asserts — checked against counting where checking is
possible, with the case note saying exactly that.

Same shape as D-056, different cause. There a blindness case could not be a
control because the two paths are built to disagree; here because one path cannot
run at all. Both reduce to: a calibration case asserts a value two independent
paths produce.

## Where M6 stands

```
gates passed        9/11 -> 10/11 on this commit
outstanding         G04  pre-registration untracked (resolves on commit)
                    G06  no published anchor -- E-05, operator, terminal
controls            4/4 pass
calibration         BLOCKED, and not lifted by the controls passing
targets             none declared: the quantity is a property of an operation
                    rather than of a target
```

M6 is **E-05's** class, like M2 and M4: the brief names no anchor at all. That is
a different block from M1, M3 and M5, which are blocked because an anchor exists
and cannot be reached. The remedies differ — confirm that none exists, versus
transcribe a number — and a test asserts the distinction rather than leaving it
in prose.

## Verification

```
new tests        48 (30 module, 10 blindness, 8 prereg)
rx layer         12/12 mutants killed, 0 survivors
ci checks        6/6
```

All six modules the brief specifies are now built.
