# algebraic-probe

An instrument for bounding the algebraic attack surface of ARX and
arithmetisation-oriented hash functions.

Its output is bounds, distributions, and scope statements. It does not claim a
break and it does not claim impossibility. For a given technique applied to a
given function at a given round count, it reports what that technique can and
cannot establish, with the evidence attached.

## State

First deliverable only. No module has a measurement path, nothing has been run
against a real target, and the primary target is absent by design (DECISIONS.md
D-002).

| Piece | State |
| --- | --- |
| `tiers/` — tier labels and integrity enforcement | implemented, tested |
| `stats/` — BH, power, censored regression | implemented, tested |
| `provenance/` — commit embedding, prereg hashing, hash chain, audit | implemented, tested |
| `harness/` — registry, regime router, calibration gate, promotion gate, sweeps | implemented, tested |
| `core/` — control targets, Keccak-f, MiMC | implemented, validated |
| `core/sha256.py` — primary target | absent; raises `NotAuthorised` |
| `verify/` — independent exhaustive ANF path | implemented, tested |
| `modules/degree/` — Module 1 | pre-registered and calibrated; `measure=None` |
| Modules 2-6 | not started |

## Layout

```
core/         parametrised primitives and control targets, plus validation
tiers/        tier label types and the integrity enforcement that makes
              cross-tier operations raise
modules/      one subpackage per module, each with prereg/, calibration/
              and blindness/
verify/       independently implemented verification paths; imports nothing
              from modules/ and is imported by nothing in modules/
harness/      run orchestration, seeding, censoring, resumable SQLite sweeps
stats/        BH correction, censored regression, power analysis
provenance/   commit embedding, hash chaining, audit
reports/      lint plus generated output in reports/out/
runs/         committed run logs, append-only and hash-chained
DECISIONS.md  every judgement call, with reasoning
```

## The three tiers

Every result carries exactly one label, assigned by the code path that produced
it (`tiers.result.prove` / `enumerated` / `sampled`) and never by hand.

- **P — PROVEN.** Deductive. Repetition adds nothing; `with_repetitions` raises.
- **E — EXHAUSTED-IN-SPACE.** Complete enumeration of a stated space. Every Tier
  E value prints the space, its cardinality and its fraction of the universe on
  the same line.
- **S — SAMPLED.** At least 30 independent seeds, 50 preferred; the full
  distribution is the value, never a point.

Combining, averaging or comparing results of different tiers raises
`TierViolation`.

## Running it

```
cd algebraic-probe
pytest -q                                       # the suite
python scripts/ci_checks.py                     # structural checks
python -m modules.degree.calibration.suite      # what Module 1 will assert
python modules/degree/prereg/derive_thresholds.py
python scripts/render_reports.py                # regenerate reports/out/
python scripts/mutation_test.py                 # deliberate-defect check
```

## What blocks Module 1 right now

Four hard blocks, all listed in `modules/degree/prereg/PREREG-M1.md` section 3
and all reported by the calibration gate:

1. the parametrised SHA-256 target is not vendored here;
2. two ground-truth citations have not been checked against their primary
   sources, so their expected values are `PENDING_PRIMARY_SOURCE`;
3. the calibration suite therefore cannot report satisfied;
4. no measurement implementation is registered.

Open questions for the operator are in DECISIONS.md section Q.
