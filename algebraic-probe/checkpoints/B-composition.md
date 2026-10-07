# Checkpoint B — calibration under composition

The brief's premise was correct. Every gap=0 control was a single uncomposed
map, where the bound is just wt(exponent); tightness there validated the
implementation, not the instrument. Under composition the bound is loose by up
to 10 bits, and the truth is non-monotonic while the bound is monotone.

## B1 — iterated control family, analytically known per-round exact degree

Two new controls in `core/targets.py`, both composed, both with closed-form
exact degree:

- **`IteratedPowerMap`** — x → x^e applied r times over GF(2^n), no round
  constants. Equals x^(e^r mod 2^n−1), so exact degree = wt(e^r mod 2^n−1).
- **`BlockRestrictedMap`** — a power map on the low `active` bits, identity on
  the rest. Degree can never exceed `active−1` at any round count, because no
  output bit depends on more than `active` inputs.

Both agree with `verify/anf` at every measured point.

## B2 — the control on which naive doubling is provably wrong

Iterated cube map over GF(2^9):

| r | naive | exact | gap | |
|---|---:|---:|---:|---|
| 1 | 2 | 2 | 0 | |
| 2 | 4 | 2 | 2 | |
| 3 | 8 | 4 | 4 | |
| 4 | 8 | **3** | 5 | **DECREASE** |
| 5 | 8 | 6 | 2 | |
| 6 | 8 | **5** | 3 | **DECREASE** |
| 7 | 8 | 5 | 3 | |
| 8 | 8 | 6 | 2 | |

The exact degree **decreases** at r=4 and again at r=6. A doubling bound is
monotone by construction and cannot reproduce a decrease at any round. This
separates a working bound path from one that multiplies by two: the bound is
sound, and it is structurally incapable of tracking this target.

## B3 — per-round gap series

Block-restricted map, n=12, active=5, e=3, known ceiling 4:

| r | naive | exact | gap | ceiling breached by bound |
|---|---:|---:|---:|---|
| 1 | 2 | 2 | 0 | no |
| 2 | 4 | 2 | 2 | no |
| 3 | 8 | 4 | 4 | **yes** |
| 4 | 11 | 3 | 8 | **yes** |
| 5 | 11 | 3 | 8 | **yes** |
| 6 | 11 | **1** | **10** | **yes** |
| 7 | 11 | 2 | 9 | **yes** |

From r=3 the bound exceeds a ceiling that is a theorem about the target, and by
r=6 it is wrong by 10 bits on a 12-bit state. A single gap figure would have
reported none of this, which is why the series is the reported quantity for a
composed target.

## B4 — intermediate controls

`inverse-map-gf2n` at n=11 retained as primary intermediate control: degree 10
of a possible 11 is not recoverable by accident.

Added `IteratedPowerMap(n=11, e=3, r=5)` as a second intermediate control at
middling degree — composed rather than single-application, so it exercises the
composition path the original intermediate controls did not.

## Classification

**Class 3, genuine null**, for the composed gap: the implementation is correct
and the finding is that a doubling bound does not track composition. Recorded
with its mechanism (composition of power maps reduces the exponent modulo
2^n−1, which a monotone per-round multiplier cannot see) and covered by the
Stage A blindness class.

**Not** Class 1: no control returns a value known to be wrong, both exact paths
agree, and every bound remains sound (`bound ≥ exact` at all 15 composed points).

## What this changes upstream

The Stage A derived bound for MiMC is now the only bound in the repository that
tracks a composed target, and its advantage is specific to the MiMC exponent
structure. `iterated_power_bound` and `block_restricted_bound` remain
deliberately composition-blind: they are the controls, and tightening them would
destroy the measurement.
