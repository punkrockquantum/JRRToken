# Checkpoint I — the primary target, measured

E-03 authorised 2026-09-22. SHA-256 had been the declared primary target since
the original brief and had never been measured, because the brief said vendor it
and the repository holding it was unreachable. The authorisation replaced
"vendor" with "implement here, with the validation committed".

## What the authorisation cost to honour

Three of the four preconditions `core/sha256.py` had been declaring since Stage C
apply unchanged to a fresh implementation. All three are met.

```
FIPS 180-4 validation runs here, committed        tests/test_core_sha256.py, 37 tests
bit-identity with hashlib at 64 rounds           every length 0-200 bytes, the padding
                                                 boundaries either side of 56 and 120,
                                                 a 300-case fixed random set, 1 MB input
no constant transcribed                          K and IV derived from their FIPS
                                                 definitions in exact integer arithmetic
upstream commit id of vendored code              n/a -- superseded by D-041
```

The constants matter more than they look. FIPS 180-4 defines K[i] as the first 32
bits of the fractional part of the cube root of the i-th prime, and H[i] the same
for the square root. Both are computed with an integer cube root and
`math.isqrt` — no floating point, so no rounding to argue about — exactly as
`core/keccak.py` derives its rho offsets from the `(x,y) <- (y, 2x+3y)`
recurrence rather than tabling them. `hashlib` then validates the derivation, and
mutant `ARX-05`, which takes the wrong 32 bits of the scaled root, is killed.

## The measurement problem, and it was real

SHA-256's non-linearity is modular addition. Adding that to `SymbolicWord` is
easy and the result is worthless:

```
z_i = x_i XOR y_i XOR c_{i-1}          deg <= max of the three
c_i = maj(x_i, y_i, c_{i-1})           deg <= max of the pairwise sums
```

Both rules are sound. Traced through `core.sha256.compress` the propagated value
is **4,526** after one round, **2.5×10⁸** after two, **1.6×10¹³** after three.
Only the free-variable ceiling keeps it finite, so the bound reported at every
round count from 1 to 64 is 512 — sound, and saying nothing.

The missing fact is elementary: a Boolean function of a variable set S has degree
at most |S|. `SupportWord` tracks each bit's variable support alongside its
degree and caps at `popcount(support)` **after every operation** — applying it at
each step rather than once at the end is what stops the products compounding.

## Result 1 — a bound that means something (Tier P)

```
rounds     1    2    3    4    5    6    8   12   16   17+
naive    512  512  512  512  512  512  512  512  512  512
capped    31   63   95  127  159  191  255  383  511  512
```

Exactly **32r − 1** through round 16, then the ceiling. Each round consumes one
32-bit message word, and the top bit's degree comes from a carry spanning all but
one of the variables below it. The improvement over the naive bound reaches
**481 bits**.

Both bounds are recorded in the run log, as `d_ub` and `d_ub_derived` — MiMC's
precedent. A log carrying only the better number would hide what the extra
argument bought.

## Result 2 — exhaustive lower bounds (Tier E on a restriction → Tier P on the target)

A restriction's degree never exceeds the function's, so exhausting a window gives
a *proven* lower bound on the unrestricted target. 18 cells, three window widths,
six round counts from 1 to 64:

```
soundness holds in every cell                     18/18
exact degree saturates at the window width        18/18
proven lower bound on the full target             16
```

**The substantive finding: one round is enough.** The exact degree equals the
window width at *every* round count measured, including r = 1. SHA-256's
compression function reaches full degree in any small set of message bits after a
single round.

Corrected during the run and worth recording: the free window first defaulted to
block offset 0, which lands in W[15] — a word no round below 15 consumes. All
eighteen cells returned degree 0, correctly, and uselessly. The window now sits
at offset 480, in W[0].

## Result 3 — witnessed lower bounds on the unrestricted target (Tier P)

One non-zero k-th order derivative proves degree ≥ k with no enumeration at all.
On the full 512-bit input, every probe witnessed **on the first seed**, at k = 8,
12 and 16, at every round count from 1 to 64. An independent route to the same
lower bound of 16.

## The bracket, and what it means

```
rounds=1     16 <= deg <= 31
rounds=4     16 <= deg <= 127
rounds=64    16 <= deg <= 512
```

The cryptanalytic reading, which is a statement about the *technique* and not a
claim about SHA-256: degree-based higher-order differentials need a derivative
order the degree bound puts out of reach, and the degree is already saturated in
any feasibly-exhaustible subspace after one round. This instrument's degree arm
has no purchase on SHA-256 beyond round 1. That is what it was built to find out.

## What is not established, stated rather than implied

The round-dependence of 32r − 1 **cannot be checked exhaustively here.** A
restricted target saturates at its own free-variable count, so the restriction
ceiling bites before the round count does; seeing round-dependence would need a
window wider than 32 bits, at least 4.3×10⁹ evaluations. The round-dependence is
Tier P only, and the exhaustive arm establishes soundness and a lower bound
rather than tightness.

No published anchor is claimed for any value here. E-04 still blocks the
literature comparison, and nothing was substituted for it.

## Verification

```
tests            64 new (37 validation, 27 degree)
arx layer        8/8 mutants killed
gates            T01 passes; sha256-compression-parametrised is GO
run log          4 SHA-256 instances recorded, 35 records, chain intact
```

`ARX-08` is worth naming: it makes the free window ignore its offset, which is
precisely the mistake that produced eighteen zeros on the first run. The defect
found by hand is now pinned by a mutant.
