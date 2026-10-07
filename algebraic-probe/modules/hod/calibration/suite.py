"""Module 4 calibration suite.

No published-ground-truth case exists: section 5 requires an anchor a reader can
check against a paper and neither brief names one for this module. The suite is
therefore built with `allow_missing_ground_truth`, and the module ships
calibration-blocked (ESCALATIONS.md E-05).
"""

from __future__ import annotations

from core.targets import InverseMap, IteratedPowerMap, PowerMap
from harness.calibration import CalibrationCase, CalibrationSuite, CaseKind, Comparator
from tiers.provenance import Provenance

from ..citations import CITATIONS

MODULE_ID = "modules.hod"


def _case(case_id, kind, target_id, factory, expected, assertion, rationale, params):
    return CalibrationCase(
        case_id=case_id,
        kind=kind,
        target_id=target_id,
        target_factory=factory,
        quantity="implied_order",
        comparator=Comparator.EQUAL,
        expected=expected,
        expectation_provenance=Provenance(computation_id=f"M4-CTRL-{case_id}"),
        assertion=assertion,
        rationale=rationale,
        parameters=params,
    )


def _cases() -> tuple[CalibrationCase, ...]:
    return (
        _case(
            "CAL-M4-POS-CUBE",
            CaseKind.POSITIVE_CONTROL,
            "power-map-gf2n n=9 d=3",
            lambda: PowerMap.create(9, 3),
            3,
            "the implied vanishing order for a degree-2 map is exactly 3",
            "the smallest non-trivial case: if order != degree+1 here, nothing "
            "downstream is meaningful",
            {"n": 9, "degree": 2},
        ),
        _case(
            "CAL-M4-INT-ITER",
            CaseKind.INTERMEDIATE_CONTROL,
            "iterated-power-map-gf2n n=11 e=3 r=5",
            lambda: IteratedPowerMap.create(11, 3, 5),
            7,
            "the implied order for the composed control of degree 6 is exactly 7",
            "a composed target at middling degree, so the case exercises the "
            "composition path rather than a single application",
            {"n": 11, "degree": 6},
        ),
        _case(
            "CAL-M4-NEG-SATURATED",
            CaseKind.NEGATIVE_CONTROL,
            "inverse-map-gf2n n=11",
            lambda: InverseMap.create(11),
            11,
            "a saturated-degree map implies order n, which needs the whole input "
            "space and is therefore not a distinguisher",
            "establishes the floor: the value the module returns when the degree "
            "carries no exploitable deficiency",
            {"n": 11, "degree": 10},
        ),
    )


SUITE = CalibrationSuite(
    module_id=MODULE_ID,
    cases=_cases(),
    citations=CITATIONS,
    allow_missing_ground_truth=True,
    missing_ground_truth_reason=(
        "section 5 requires a published anchor an independent reader can check; "
        "neither brief names one for Module 4 (ESCALATIONS.md E-05)"
    ),
)
