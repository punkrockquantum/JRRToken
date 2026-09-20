# Checkpoint G — the probabilistic arm

The instruction named "brute force probabilistic exhaustion". Checkpoint F ran
the exhaustive half. This is the probabilistic half, and it only became possible
because of F: the exhaustive arm produced targets whose exact algebraic degree is
known over their complete input space, so the sampled witness probe can now be
measured against truth instead of against its own model.

`scripts/witness_calibration.py`, computation `M1-WITNESS-CAL-001`. 52 cells,
50 seeds each (the pre-registered `seeds_per_cell`), ~28 s.

## Two arms, two tiers, kept apart

**Soundness — Tier P.** A degree of exactly *d* means every derivative of order
*d+1* vanishes identically. At probe dimension *k > d* the probe must therefore
never witness, for any seed, ever. A witness there contradicts a theorem; it is
not an unlucky draw.

```
cells above the exact degree   15
draws                          750
witnesses                      0
soundness_violations           0
```

This is the first check of the Tier S machinery against ground truth. It is
falsifiable and it passes.

**Rate — Tier S.** At *k ≤ d* a witness exists and the probe finds it with some
probability. PREREG-M1 §9 models that by the Schwartz–Zippel worst case, 2^−k.
Measured, at *k* equal to the exact degree:

| Target | rate | worst case | ratio |
|---|---|---|---|
| linear-map-gf2 n=13 | 1.00 | 0.5 | 2× |
| power-map-gf2n d=7 | 1.00 | 0.125 | 8× |
| power-map-gf2n d=31 | 1.00 | 0.03125 | 32× |
| power-map-gf2n d=4095 | 0.62 | 0.000244 | 2540× |
| keccak-f[25] r=1 | 1.00 | 0.25 | 4× |
| keccak-f[25] r=2 | 1.00 | 0.0625 | 16× |
| keccak-f[25] r=3 | 1.00 | 0.00390625 | 256× |

Every rate carries an exact Clopper–Pearson interval, never a bare point. In all
37 cells at or below the exact degree, the interval's **lower** bound excludes
the worst case.

Cells too costly to run are reported with their cost rather than dropped:
Keccak-f[25] at rounds 4, 5 and 6 would need probe dimensions 17, 23 and 25, or
131,072 to 33,554,432 evaluations per seed, against the guard `MAX_PROBE_DIM = 13`.

## What this does not do

**D-010 stays closed.** The Tier S promotion path is still shut above probe
dimension 2. Three reasons, in order of weight:

1. These rates were measured on targets whose degree I already knew. Promotion
   concerns a target whose degree is unknown — which is the entire reason a probe
   exists. A rate measured under knowledge is not evidence about a rate measured
   without it.
2. The targets are structured and far from saturation. The regime the closure was
   drawn for is the opposite: a sparse top-degree form, where the probe is at its
   weakest. Nothing here samples that regime.
3. Revising a pre-registered threshold after seeing data that favours revising it
   is the prohibited act, whatever the margin.

The measurement is recorded as evidence under **E-01**, which is the operator's
decision. It licenses a better-informed answer; it does not license the answer.

**One consequence worth your attention.** The seed requirements in E-01 —
468,882 to reopen *k*=16, 3.07×10^10 for *k*=32 — are derived from the worst
case. If a real target behaves nearer to what was measured than to what was
assumed, those are enormous overestimates. Establishing that needs a tighter
model with its own derivation and pre-registration, holding for the sparse case
rather than the dense one. Unbuilt, and named rather than half-done.

## Statistics added

`stats.clopper_pearson_interval` and `stats.binomial_tail_at_most` — exact,
standard-library only, solved by bisection on the binomial tail rather than an
inverse incomplete beta. The existing closed form `zero_witness_upper_bound`
covered only zero successes, and reporting a non-zero rate without an interval is
the single point §3 forbids.

Pinned three independent ways: against textbook Clopper–Pearson values, against
the existing closed form at zero successes via the identity
`CP_upper(0, n, c) = zero_witness_upper_bound(n, (1+c)/2)`, and by the
requirement that relabelling success and failure mirrors the interval.

## Verification

```
tests      577 collected, 563 in the fast lane, 0 failed
ci_checks  5 checks, 0 failed
mutants    witness layer 8/8 killed
```
