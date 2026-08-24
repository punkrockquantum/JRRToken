# Checkpoint E — synthesis

## E1 — promotion gate: **promoted set is empty**

Run, not asserted. Section 5 makes calibration a precondition of trusting a
module on anything new, so a module whose calibration gate is blocked has no
eligible results; that is checked before any of the four criteria.

| Module | Calibration blocked | Eligible | Why not |
|---|---|---|---|
| `modules.degree` | yes | no | `CITE-BCD11`, `CITE-EGLORSW20` unverified; six cases `PENDING_PRIMARY_SOURCE` |
| `modules.hod` | yes | no | no published anchor exists for the module |

`candidates_evaluated=0 promoted=0`. No result reached criterion 1. A completed
run that promotes nothing is a completed run.

## E2 — combined scope and blindness

**What was measured.** Algebraic degree over GF(2) of control targets and of
MiMC over GF(2^n) for n ∈ {9,11,13}, r ∈ [1,9]: certified upper bounds (Tier P,
two derivations), exact degrees (Tier E, two independent implementations), and
witnessed lower bounds (Tier P). From those, the order and round-range of implied
higher-order differentials.

**What would not have been detected.** The union of the three implemented
blindness classes, each run and each passing:

1. **Low-degree implicit systems over the extension field.** `x → x^(-1)` has
   degree n−1 and is described by `x·y = 1`. Degree over GF(2) does not bound the
   degree of the implicit multivariate system over GF(2^n).
2. **Univariate tractability under Boolean saturation.** `x → x^e` with
   wt(e) = n−1 saturates the degree and is inverted by one exponentiation.
   Boolean saturation carries no information about the degree or count of the
   univariate relations.
3. **Non-affine structure.** A degree bound quantifies over affine subspaces
   only. The same saturated map sums to zero over a coset of the multiplicative
   subgroup of order 7 — a distinguisher on **7** inputs where the degree measure
   demands **2^9**. No tightening of a degree bound can surface it.

**Therefore unexamined after this run:** everything expressible as a small
implicit relation system over the extension field; everything expressible over
multiplicative or otherwise non-affine subsets; all of SHA-256 (never measured);
differential, meet-in-the-middle and rotational structure (M3, M5, M6 never
built); and degree over prime fields (E-06, the metric is undefined there).

## E3 — one-factor-at-a-time reproduction

**Vacuous: the promoted set is empty.** No result requires seed, sampling or
compiler-flag reproduction because none reached the report. The machinery exists
(`harness.runner` refuses a reproduction naming more than one varied factor, and
a test asserts it) and is unexercised.

## E4 — compliance audit

Three runs audited.

| Run | Chain | Prereg digest | Deviations | Compliant |
|---|---|---|---:|---|
| `…54c56266` | valid | matches | 1 | **no** |
| `…668f043a` | valid | matches | 1 | **no** |
| `…d978251d` | valid | matches | 0 | yes |

Both deviations are the same: `working_tree_clean=False`. Those two runs were
executed with uncommitted changes present, so the commit id they embed does not
describe the code that produced them. Reported rather than removed — results are
append-only, and a non-compliant run is evidence about the process.

The third run is the clean-tree re-execution and is compliant. No result in this
report depends on the two non-compliant runs.

## E5 — provenance verification

| Check | Result |
|---|---|
| `PREREG-M1` introduced `d84c096`, runner `84ca87e` | runner precedes |
| `PREREG-M4` introduced `1fc7af1`, runner `84ca87e` | runner precedes |
| Hash chains across all logs | unbroken |
| Byte-identical pairs among logs | 0 |
| Run-log files committed | 5 |

One log holds 16 records and is **unsealed**. It is the first `execute.py` run,
which aborted when the measurement path correctly refused a bound for the
random-oracle target. `verify_against_index()` reports its length as unverified,
which is the right answer: an aborted run is not a completed one, and the
integrity layer distinguishes the two rather than silently accepting it.

## Termination

All stages A–E complete. Every module either passes its gates or is recorded
calibration-blocked with the reason. Compliance audit run with every deviation
reported. Provenance chain verified.

**Nothing promoted. The run is complete.**
