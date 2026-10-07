"""Module 3 calibration suite.

Section 5 names an anchor for this module -- reduced-round SHA-256 collision and
semi-free-start results -- so unlike Modules 2, 4 and 6 this suite *has* a
published-ground-truth case. It is ``PENDING_PRIMARY_SOURCE`` because the source
is unreachable (E-04), which blocks the module for a reason that can be repaired
by transcribing two numbers rather than by the brief naming something it does
not.

The controls are chosen so each answer is forced rather than argued:

  positive     an invertible linear map: the differential din -> A*din holds with
               probability exactly 1 and every other output difference with
               probability exactly 0. Nothing about it is approximate.
  negative     a random-oracle stand-in: the floor, where a count above the
               random level is an artefact of the counting.
  intermediate x -> x^31 over GF(2^11), whose differential uniformity is a
               computation rather than a constant.
  blindness    x -> x^3 over GF(2^n), n odd: best differential one bit above
               random, half the table exactly impossible.
"""

from __future__ import annotations

from core.sha256 import SHA256Compression
from core.targets import LinearMapGF2, PowerMap, RandomFunction
from harness.calibration import (
    PENDING_PRIMARY_SOURCE,
    CalibrationCase,
    CalibrationSuite,
    CaseKind,
    Comparator,
)
from tiers.provenance import Provenance

from ..citations import CITATIONS

MODULE_ID = "modules.differential"

LINEAR_N = 10
LINEAR_SEED = 20260923
RANDOM_N = 12
RANDOM_SEED = 20260924
#: The max-over-row control's width. 7, not 11, because the module gets the
#: largest count in a row by counting each (din, dout) pair separately, which
#: costs 2^(n+m); at n=m=11 that is 2^22 evaluations and about 90 seconds *per
#: invocation of the readiness report*, and the sweep guard
#: MAX_ROW_SWEEP_BITS refuses it. The control is the same control at 7: the row
#: has the same two-valued shape (43 counts of 2 and 7 of 6 at n=7; 793 and 77
#: at n=11) and the same maximum, 6. The expected value was recomputed at 7
#: rather than carried across from 11 -- see D-052.
POWER_N = 7
POWER_EXPONENT = 31
BLIND_N = 7


def _cases() -> tuple[CalibrationCase, ...]:
    linear = LinearMapGF2.random_invertible(LINEAR_N, LINEAR_SEED)
    return (
        CalibrationCase(
            case_id="CAL-M3-GT-SHA256",
            kind=CaseKind.PUBLISHED_GROUND_TRUTH,
            target_id="sha256-compression-parametrised",
            target_factory=lambda: SHA256Compression.create(n_rounds=24),
            quantity="characteristic_steps",
            comparator=Comparator.EQUAL,
            expected=PENDING_PRIMARY_SOURCE,
            expectation_provenance=Provenance(citation_key="CITE-SHA256-DIFF"),
            assertion=(
                "the module's step count for the best characteristic it finds on "
                "reduced-round SHA-256 equals the step count of the published "
                "result named in section 5, at the round count that result applies to"
            ),
            rationale=(
                "the only case here that tests this module against anybody else. "
                "Differential search is the technique with the longest published "
                "record on SHA-256, so a module that cannot reproduce a known step "
                "count is not trustworthy on an unknown one"
            ),
            parameters={"rounds": 24, "model": "to be recorded with the transcription"},
        ),
        CalibrationCase(
            case_id="CAL-M3-POS-LINEAR",
            kind=CaseKind.POSITIVE_CONTROL,
            target_id=f"linear-map-gf2 n={LINEAR_N} seed={LINEAR_SEED}",
            target_factory=lambda: linear,
            quantity="differential_hits",
            comparator=Comparator.EQUAL,
            expected=1 << LINEAR_N,
            expectation_provenance=Provenance(
                computation_id="M3-CTRL-LIN-001",
                notes=(
                    "for g(x) = Ax the difference g(x) ^ g(x ^ d) equals Ad for every "
                    "x, so the differential d -> Ad holds on all 2^n inputs and every "
                    "other output difference on none. Checked exhaustively in "
                    "tests/test_module_differential.py"
                ),
            ),
            assertion=(
                f"the module counts all {1 << LINEAR_N} inputs as satisfying the "
                "differential d -> Ad for an invertible linear map"
            ),
            rationale=(
                "the answer is forced: any count other than 2^n is wrong, which is "
                "what makes this the most important case here. A differential "
                "instrument that miscounts a linear map has not been shown to count"
            ),
            parameters={
                "n": LINEAR_N,
                "seed": LINEAR_SEED,
                "din": 1,
                "dout": linear(1),
            },
        ),
        CalibrationCase(
            case_id="CAL-M3-NEG-RANDOM",
            kind=CaseKind.NEGATIVE_CONTROL,
            target_id=f"random-function-sha256-prf n={RANDOM_N} seed={RANDOM_SEED}",
            target_factory=lambda: RandomFunction.create(RANDOM_N, RANDOM_N, RANDOM_SEED),
            quantity="differential_hits",
            comparator=Comparator.AT_MOST,
            expected=16,
            expectation_provenance=Provenance(
                computation_id="M3-CTRL-RND-001",
                notes=(
                    f"for a random function on {RANDOM_N} bits the count for a fixed "
                    f"(din, dout) is Binomial(2^{RANDOM_N}, 2^-{RANDOM_N}) in "
                    "expectation 1, and counts are even because (x, x ^ din) "
                    "contributes twice; 16 is far into the tail and is a ceiling "
                    "rather than a prediction"
                ),
            ),
            assertion=(
                "the module counts at most 16 inputs satisfying a fixed differential "
                "of an i.i.d. random-oracle stand-in"
            ),
            rationale=(
                "establishes the floor: what the module returns when there is no "
                "structure. A count well above this would be the counting method "
                "reporting itself"
            ),
            parameters={"n": RANDOM_N, "seed": RANDOM_SEED, "din": 1, "dout": 0},
        ),
        CalibrationCase(
            case_id="CAL-M3-INT-POWER",
            kind=CaseKind.INTERMEDIATE_CONTROL,
            target_id=f"power-map-gf2n n={POWER_N} d={POWER_EXPONENT}",
            target_factory=lambda: PowerMap.create(POWER_N, POWER_EXPONENT),
            quantity="max_differential_hits",
            comparator=Comparator.EQUAL,
            expected=6,
            expectation_provenance=Provenance(
                computation_id="M3-CTRL-POW-001",
                notes=(
                    f"the largest count for din = 1 on x -> x^{POWER_EXPONENT} over "
                    f"GF(2^{POWER_N}), computed exhaustively by "
                    "verify/differential.py: the row holds 43 output differences "
                    "with count 2 and 7 with count 6. Not a value taken from a "
                    "table, and not a value I predicted -- the first draft of this "
                    "case guessed 4 and the control caught it (D-048). The width "
                    "moved from 11 to 7 when the sweep guard was added; the value "
                    "was recomputed at 7 rather than carried across, and the row "
                    "at 11 holds 793 counts of 2 and 77 of 6 for the same maximum "
                    "(D-052)"
                ),
            ),
            assertion=(
                f"the module's largest count for din = 1 on x -> x^{POWER_EXPONENT} "
                f"over GF(2^{POWER_N}) is exactly 6"
            ),
            rationale=(
                "a middle answer, neither 2^n nor the random floor: an instrument "
                "that gets only the endpoints right has not been shown to measure "
                "between them"
            ),
            parameters={"n": POWER_N, "exponent": POWER_EXPONENT, "din": 1},
        ),
        CalibrationCase(
            case_id="CAL-M3-BLIND-IMPOSSIBLE",
            kind=CaseKind.BLINDNESS,
            target_id=f"power-map-gf2n n={BLIND_N} d=3",
            target_factory=lambda: PowerMap.create(BLIND_N, 3),
            quantity="max_differential_hits",
            comparator=Comparator.EQUAL,
            expected=2,
            expectation_provenance=Provenance(
                computation_id="M3-CTRL-APN-001",
                notes=(
                    "x -> x^3 over GF(2^n) with n odd is almost perfect nonlinear, so "
                    "the largest count is exactly 2 -- probability 2^-(n-1), one bit "
                    "above the random level. Computed exhaustively, not cited"
                ),
            ),
            assertion=(
                "the module's largest count is exactly 2 -- one bit above the random "
                "level, which is the weakest elevation an even-counted table can "
                "show -- for a target half of whose differential table is impossible"
            ),
            rationale=(
                "section 6(b) and 6(c). The threshold is one-sided: it asks whether a "
                "probability exceeds the random level, and an impossible differential "
                "lies on the other side of it. This target barely clears the "
                "threshold while exactly 50 per cent of its table is unreachable, so "
                "the null 'nothing meaningfully above random' is compatible with "
                "structure an impossible-differential attack would use. Exhibited in "
                "tests/test_blindness_impossible.py, which needs two measures and so "
                "cannot be a single-valued case here"
            ),
            parameters={
                "n": BLIND_N,
                "exponent": 3,
                "din": 1,
                "impossible_fraction": 0.5,
                "structure_not_seen": "impossible differentials, below the threshold",
            },
        ),
    )


SUITE = CalibrationSuite(module_id=MODULE_ID, cases=_cases(), citations=CITATIONS)
