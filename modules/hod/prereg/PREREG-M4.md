# PREREG-M4 — Higher-order differentials and integral distinguishers

Committed before any Module 4 data exists. Module 4 follows from Module 1: a
degree bound of d means every (d+1)-order differential vanishes identically.

## 1. Identity

- `prereg_id`: PREREG-M4
- `module`: modules.hod
- `title`: Higher-order differentials and integral distinguishers
- `declared_tiers`: P,E
- `runner_path`: harness/runner.py
- `primary_metric`: last_nontrivial_round
- `alpha`: 0.05
- `family_size`: 27
- `effect_floor`: 1.0
- `seeds_per_cell`: 30

`family_size` 27 = 3 field sizes (n ∈ {9,11,13}) × 9 rounds. No Tier S cell is
planned: every quantity here is deductive given a degree bound, or exhaustive
over a stated subspace. `alpha` and `seeds_per_cell` are declared because the
pre-registration schema requires them and are not used; if a Tier S cell is ever
added to this module they bind it.

## 2. Quantities

- `order(r) = d(r) + 1` — the order of a derivative that vanishes identically.
  Tier P whenever d(r) is Tier P.
- `log2_data(r) = order(r)` — chosen inputs the distinguisher needs.
- `exists(r)` — whether an `order(r)`-dimensional subspace exists at all.
- `last_nontrivial_round` — the last round with `order(r) < n`. **Primary
  metric.** An order equal to the variable count needs every input, which is an
  exhaustive evaluation rather than a distinguisher.

## 3. Hypotheses

- `H1_gap`: the exact degrees of Stage A give a strictly later
  `last_nontrivial_round` than a doubling bound on the same target.
- `H0`: they give the same round.

## 4. Thresholds

- `T1_existence`: `order(r) <= n`, else the bound is vacuous. Structural.
- `T2_nontrivial`: `order(r) < n`, else the distinguisher is exhaustive search.
- `effect_floor`: 1.0 rounds. Rounds are integer-valued, so one is the smallest
  representable difference.

## 5. Calibration

**This module is calibration-blocked and ships as such.** Section 5 of the
original brief requires a published anchor an independent reader can check
against a paper; neither brief names one for Module 4. Recorded as
ESCALATIONS.md E-05, and `modules/hod/citations.py` is empty by design rather
than by omission. Controls run; the module does not run on anything new.

## 6. Null-result requirements

- `mechanism`: derived from the degree series and the round structure that
  produced it, not from the aggregate.
- `blindness_statement`: a degree bound quantifies over affine subspaces only,
  so an integral over a multiplicative coset is invisible to it however tight
  the bound becomes.
- `blindness_test`: `modules/hod/blindness/multiplicative_coset.py`.

## 7. Verification

Every `order(r)` claim is checked empirically by summing the target over a
random affine subspace of that dimension, using this module's own subspace
summation rather than `verify/`, so agreement between them is evidence and not a
restatement.
