# Checkpoint D — M2 through M6

Five of six are unreachable behind E-03/E-05 and are recorded as blocked, not
attempted. M4's arithmetisation-oriented arm needs only Module 1's calibrated
degree bounds and was built and run.

| Module | State | Blocked by |
|---|---|---|
| M2 reachability / free-round budget | not started | E-03 — its subject is SHA-256's message schedule |
| M3 differential search | not started | E-03, and its 31/38–39-step anchor needs E-04 |
| **M4 higher-order differentials** | **built, controls pass, calibration-blocked** | E-05 (no published anchor exists) |
| M5 meet-in-the-middle | not started | E-03, and published preimage structure needs E-04 |
| M6 rotational-XOR | not started | E-03 — Sigma/sigma constants are SHA-256's |

Ordering deviation from the completion brief §5 (which puts M2 first) recorded
in DECISIONS.md D-031.

---

## D2 — M4, built

Pre-registered (`PREREG-M4`, family size 27 = 3 field sizes × 9 rounds), Tier P
and E only, registered in the harness, controls executed through its own
measurement path.

### The substantive result

A degree bound d means every (d+1)-order derivative vanishes. The round at which
the implied distinguisher stops being useful — the last round with order < n,
since order = n is exhaustive evaluation rather than a distinguisher:

| n | naive doubling | Stage A derived | exact | **rounds given up by doubling** |
|---|---:|---:|---:|---:|
| 9 | 2 | 5 | 5 | **3** |
| 11 | 3 | 6 | 6 | **3** |
| 13 | 3 | 7 | 8 | **5** |

The doubling bound abandons the distinguisher 3–5 rounds early. The Stage A
derived bound recovers all of that at n ∈ {9,11} and all but one round at n=13.

### Empirical confirmation of the Tier P claim

The vanishing is checked by summing over a random affine subspace, using this
module's own subspace summation rather than `verify/`:

| r | exact degree | order d+1 vanishes | order d vanishes |
|---|---:|---|---|
| 1 | 2 | yes | no |
| 2 | 2 | yes | no |
| 3 | 4 | yes | no |
| 4 | 4 | yes | no |

The order-d row is what makes the order-(d+1) row informative: without it the
check would pass at any dimension.

### Calibration

**Calibration-blocked and shipping as such.** No published anchor exists for
this module in either brief, so `modules/hod/citations.py` is empty by design and
the suite is constructed with `allow_missing_ground_truth` plus a stated reason.

That flag **moves the block from construction time to gate time**; it does not
relax it. Without it the suite could not be built at all and the module could not
ship; with it the module exists, its controls run, and `gate()` reports blocked
permanently until an anchor is supplied. A test asserts the reason must be
non-empty, and another asserts running the controls does not lift the block.

Controls: implied order 3 for a degree-2 map (positive), 7 for the composed
degree-6 control (intermediate), 11 for a saturated degree-10 map (negative —
the floor, where the order needs the whole input space).

### Blindness class

`modules/hod/blindness/multiplicative_coset.py`.

A degree bound quantifies over **affine** subspaces only. Take a power map over
GF(2^9) with wt(e) = 8: the degree measure reports saturation and an implied
data requirement of **2^9 = 512** chosen inputs. Its sum over any coset of the
multiplicative subgroup of order 7 is zero, so a distinguisher exists on **7**
inputs.

The same coset sum on a random function is non-zero, so the property is a
distinguisher and not a vacuous identity — that control is a test.

The two structures are unrelated, so no tightening of the degree bound can
surface this one. The blindness is a property of the quantity.

## Classification

**Class 5 (blocked on operator)** for M2, M3, M5, M6.
**Class 3 (genuine null)** for M4's calibration state: everything works and the
answer is that no published anchor exists to check it against.
