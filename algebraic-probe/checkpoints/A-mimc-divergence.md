# Checkpoint A — the MiMC divergence

Stage A of the autonomous completion brief. Ran first because a defect in the
bound path would invalidate everything built on it.

**Outcome: the bound path is SOUND but LOOSE. No defect. Class 1 does not apply.**

---

## A1 — what rule the `d_ub` path applies

`mimc_bound` propagates a per-bit degree bound through the round structure:

- key and constant additions are GF(2)-affine and carry the bound unchanged;
- squaring is the Frobenius map, GF(2)-linear, and carries the bound unchanged;
- the remaining multiplication adds its operands' bounds.

So `bound_r = 2 · bound_{r-1}`, starting at 1, capped at n−1. **Naive doubling.**

**Sound, not unsound.** Each step is a valid inequality: `deg(x²)=deg(x)` because
Frobenius is linear, and `deg(a·b) ≤ deg(a)+deg(b)` because every output bit of a
field product is a sum of products of one bit from each operand. Verified
empirically: `d_ub ≥ d_exact` at every measured point (n ∈ {9,11,13}, r ∈ [1,7]).

Derivation is in-repo, computation `M1-AO-BOUND-000`. No citation is relied on.

---

## A2 — the discriminator

Two models, both stated before measurement.

- **MODEL-P (pure power)** — degree = `wt(3^r mod 2^n−1)`, ignoring round
  constants. Predicts a **non-monotonic drop at r=4** that no monotone doubling
  bound can produce.
- **MODEL-C (constant contamination)** — round constants keep every lower
  exponent alive, so the support is `[1, min(3^r, 2^n−1)]` and the degree is the
  largest Hamming weight in that range.

Measured at n=9:

| r | MODEL-P | MODEL-C | d_ub naive | **d_exact** | verify |
|---|---:|---:|---:|---:|---:|
| 1 | 2 | 2 | 2 | **2** | 2 |
| 2 | 2 | 3 | 4 | **2** | 2 |
| 3 | 4 | 4 | 8 | **4** | 4 |
| 4 | **3** | 6 | 8 | **4** | 4 |
| 5 | 6 | 7 | 8 | **6** | 6 |
| 6 | 5 | 9 | 8 | **8** | 8 |

Same pattern at n=11. The two exact paths (`modules/degree/measure.exact_degree`,
subset-sum ANF; `verify/anf.algebraic_degree`, Möbius butterfly) agree at every
point.

**The models separate, and both are refuted as predictors.**

- MODEL-P's predicted drop at r=4 **did not occur**: measured 4, predicted 3.
  MODEL-P is therefore not even an upper bound — it is the contribution of the
  top exponent only, and a lower exponent of higher Hamming weight survives.
- MODEL-C is a sound upper bound but overshoots by 1–3 bits.
- Measured values lie strictly between: `MODEL-P ≤ d_exact ≤ MODEL-C` at every
  point.

Class 4 does not apply — the data separates the models cleanly. The mechanism is
constant contamination, at a magnitude smaller than MODEL-C's worst case.

---

## A3 — derived bound

Implemented as `mimc_derived_bound` (computation `M1-AO-BOUND-001`).

> The r-round polynomial is univariate over GF(2^n). Round constants keep every
> lower exponent alive, so the exponent support is contained in
> `[1, min(3^r, 2^n−1)]`. `deg(x^e) = wt(e)`, and the degree of a sum is at most
> the largest degree among its terms. Hence
> `deg ≤ max{ wt(e) : 1 ≤ e ≤ min(3^r, 2^n−1) }`, capped at n−1 for a permutation.

Sound by construction. Derived in-repo; no citation claimed.

---

## A4 — mechanism is not an artefact of n=9

Field size varied, everything else held fixed.

| n | r | naive | derived | exact | gap naive | gap derived |
|---|---|---:|---:|---:|---:|---:|
| 9 | 1–7 | 2,4,8,8,8,8,8 | 2,3,4,6,7,8,8 | 2,2,4,4,6,8,8 | 0,2,4,4,2,0,0 | 0,1,0,2,1,0,0 |
| 11 | 1–7 | 2,4,8,10,10,10,10 | 2,3,4,6,7,9,10 | 2,2,4,4,6,8,10 | 0,2,4,6,4,2,0 | 0,1,0,2,1,1,0 |
| 13 | 1–7 | 2,4,8,12,12,12,12 | 2,3,4,6,7,9,11 | 2,2,4,4,6,8,10 | 0,2,4,8,6,4,2 | 0,1,0,2,1,1,1 |
| 17 | 1–7 | 2,4,8,16,16,16,16 | 2,3,4,6,7,9,11 | — | — | — |

Mean gap at n=13: naive **3.71**, derived **0.86**.

`d_ub ≥ d_exact` and `derived ≥ d_exact` hold at every measured point.

At n=17 the exact path exceeds its declared guard (`MAX_EXACT_VARS = 13`, a 3^n
subset-sum) and **refuses rather than approximating**. Recorded as a limit of the
exact path, not as a measurement.

---

## A5 — blindness class

`modules/degree/blindness/saturated_power.py`.

`x → x^e` over GF(2^n) with `wt(e) = n−1` and `gcd(e, 2^n−1) = 1`: a permutation
of **maximal Boolean degree**, so the instrument emits its saturation null, that
is inverted by a **single exponentiation** to `e^-1 mod 2^n−1`.

| n | e | wt(e) | d_ub | d_exact | verify | e^-1 | one exponentiation inverts | null reproduced |
|---|---:|---:|---:|---:|---:|---:|---|---|
| 9 | 255 | 8 | 8 | 8 | 8 | 509 | yes (checked over all 2^9) | yes |
| 11 | 1023 | 10 | 10 | 10 | 10 | 2045 | yes | yes |
| 13 | 4095 | 12 | 12 | 12 | 12 | 8189 | yes | yes |

Distinct from `inverse_map`: that class is the specific exponent `2^n−2` and its
triviality is the quadratic relation `x·y = 1`. Here the exponent is ordinary, so
the class shows that saturation of the **Boolean** degree carries no information
about the degree or count of the **univariate** relations — the quantity the
arithmetisation-oriented literature actually disputes.

Inversion is checked exhaustively, not asserted.

---

## Classification

**Class 3 (genuine null) for the divergence itself**: the bound path works, and
the answer is that naive doubling is loose by a mechanism now identified and
quantified. Recorded with mechanism, blindness statement, and a passing blindness
test. Not retried.

## What changed

- `mimc_derived_bound` added; naive path retained so both are reported per round.
- `saturated_power` blindness class added.
- `max_weight_up_to` added — O(1), from the largest all-ones value ≤ m.

## Still open

Both MiMC published-ground-truth cases remain `PENDING_PRIMARY_SOURCE`
(`CITE-EGLORSW20`, egress-blocked). The derived bound is **not** substituted for
that anchor: Class 2 forbids it, and a value I derived is not a published one.
