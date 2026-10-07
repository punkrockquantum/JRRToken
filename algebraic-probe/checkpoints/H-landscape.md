# Checkpoint H — is the null complete?

An objection from outside the repository: statistical mechanics describes
landscapes that are locally indistinguishable from random while globally
organised — clustering, ultrametricity, a non-trivial overlap distribution — so
a measure reporting "no local signal" may have had "no structure" read into it.

Acted on rather than deflected, with one correction to the premise.

## The premise, corrected

The objection was framed around lag-1 autocorrelation. **This instrument
computes no autocorrelation and no lag statistic of any kind.** A grep across the
codebase returns exactly one hit, in a rationale string describing the *prior*
tool that the linear-map positive control exists to expose. The objection came
from a different instrument.

The structural point transfers intact, and it was right.

## What was missing

Module 1 had three blindness classes. All three name **algebraic** structure the
Boolean degree cannot see: a small implicit relation system over the extension
field, univariate tractability under saturation, multiplicative structure. None
named **geometric** structure in the search landscape. That was a gap in the
blindness map — not a gap in the measurement.

## The construction

`core/landscape.py`, one energy with one hierarchy parameter:

```
E(x) = sqrt(a) * z_outer(x >> (n - n_outer))  +  sqrt(1 - a) * z_inner(x)
```

`z_outer`, `z_inner` independent standard normals from SHA-256 in counter mode.
At `n_outer = 0` this is a structureless landscape; above it, states sharing
their top bits share an offset, so low-energy states organise into blocks.

The Boolean view is the energy pushed through its own CDF and quantised. Φ(E) is
uniform in **both** regimes, so the output's marginal law — and hence its
algebraic degree — is the same whether the hierarchy is present or not, and every
output bit depends on `z_inner(x)` and therefore on all *n* input bits. The
landscape is not side information: anything that can evaluate the target can
evaluate the energy.

## The result

`python scripts/landscape.py`, *n* = 14, six cluster counts from 1 to 1024,
Tier E, ~1 s:

| statistic | separates | blind at |
|---|---|---|
| **algebraic degree** | **0 of 5** | every cell — profile (14,13) throughout |
| local minima | 5 of 5 | — |
| overlap P(q) | 4 of 5 | 1024 clusters |
| density of states | 1 of 5 | 4 of 5 cells |

The local-minimum count departs from its structureless prediction by 32–47% in
every hierarchical cell. The prediction 2ⁿ/(*n*+1) is derived in-repo
(`M1-LAND-DERIVE-001`) from exchangeability and continuity alone, and tested by
enumerating **every** ordering of the energies at *n* = 1, 2, 3 and asserting the
mean count as an exact rational — no floating-point slack, no citation. That
last point matters: the spin-glass literature is behind the same egress block as
E-04, so a derivation was the only honest route to the anchor.

**The answer is yes — the null was incomplete.** A fourth blindness class now
records it (`CAL-M1-BLIND-LANDSCAPE`, and `tests/test_blindness_landscape.py` for
the two-target, two-measure demonstration section 6(c) asks for).

## Two claims of mine the measurement refuted

Recorded because I wrote both before testing either.

**"The density of states cannot separate the regimes, since both are standard
normal."** True of the marginal under a random seed; false of the empirical
density over one exhausted hypercube. The outer level supplies only `2^n_outer`
draws, so the empirical mean fluctuates by about `sqrt(a / 2^n_outer)` — 0.42 at
four clusters, 0.03 at 1024. The separation is a finite-cluster artefact that
fades, not a signature of hierarchy.

**"The overlap distribution stays separated at every cluster count."** It does
not. At 1024 clusters of 16 states, the 64 lowest-energy states are drawn from
many different clusters, so pairs share no block and the mean overlap returns to
baseline — while the hierarchy is still there by construction.

## The general finding, which is stronger than the specific one

**Every statistic measured here has a regime in which it reports "no structure"
about a landscape that has structure by construction.** The degree measure is
blind in all five cells; each proposed replacement is blind in some.

A landscape module would therefore not remove blindness. It would move it. That
is an argument against building one, and it is made in **E-11** rather than left
implied.

## What did not change

No gate, no promotion, no threshold. A section 6 blindness class has no
promotion path by construction. The separation criteria in `scripts/landscape.py`
were fixed *after* the sweep ran, and the script's own output labels them as
descriptive rather than a pre-registered test.

## Verification

```
landscape layer    8/8 mutants killed
new tests          37 (verify/landscape + blindness class)
```

## Found while building this

Running the full mutation catalogue left five committed reports dirty. Mutant
`RPRT-07` exists to make the renderer ignore `--out-dir` and write into the
tracked directory, and the harness restored the mutated *source* but not the
files that mutant caused to be written — D-033 arriving by another route. Fixed
with a snapshot and restore, reported rather than silent.

Testing that fix turned up two pre-existing defects in the harness: **three
duplicate mutant ids** (two byte-identical copies costing a test run each for no
coverage, and one genuinely distinct mutant wearing a colliding id, which would
have made a survivor report ambiguous), and the fact that **the harness cannot
mutate itself** — any anchor naming a line of `scripts/mutation_test.py` also
matches the catalogue entry quoting it. Catalogue now 104 entries, 104 unique
ids, asserted by a test. See D-039.
