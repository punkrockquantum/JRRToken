"""Module 6 calibration suite.

Section 5 names no published anchor for this module, so the suite is built with
``allow_missing_ground_truth`` and the module ships calibration-blocked under
E-05 -- the same terminal state as Modules 2 and 4, and a different one from
M1, M3 and M5, which are blocked because an anchor *exists* and cannot be
reached.

Every control's answer is forced by the arithmetic rather than argued from it:

  positive     a pure rotation-XOR circuit propagates a rotational pair with
               probability exactly 1, because rotation distributes over XOR.
               The one fact the whole technique rests on.
  negative     a rotation followed by XOR with a constant that is not
               rotation-invariant propagates at **no input at all** --
               probability exactly 0. The floor, and the strongest null the
               measure can emit.
  intermediate the number of modular additions that sinks a rotational
               characteristic to 2^-256, at the width where both the closed
               form and the counted enumeration can be run. Neither 1 nor 0,
               and it has to be computed.
  blindness    the same non-invariant constant: probability 0 by the plain
               measure, probability 1 by the rotational-XOR one.
"""

from __future__ import annotations

from core.targets import RotateXorConstant
from harness.calibration import (
    CalibrationCase,
    CalibrationSuite,
    CaseKind,
    Comparator,
)
from tiers.provenance import Provenance

from ..citations import CITATIONS

MODULE_ID = "modules.rx"

#: SHA-256's word width. The module *reports* at this width; the intermediate
#: control does not run here, because the counted path cannot enumerate 2^64
#: pairs and a control only one path can compute is not a cross-check.
PRIMARY_WIDTH = 32
PRIMARY_AMOUNT = 1

#: The intermediate control's width: 8, where verify/rotational.py can count
#: every (x, y) pair and the two paths meet. The 32-bit figure the module
#: reports rests on the same closed form, checked against counting at widths
#: 4, 6 and 8 in tests/test_module_rx.py (D-058).
CONTROL_WIDTH = 8
CONTROL_AMOUNT = 1

#: The output width a characteristic is compared against: SHA-256's chaining
#: value.
PRIMARY_N_OUT = 256

#: The blindness counterexample's shape.
BLIND_WIDTH = 16
BLIND_AMOUNT = 3
BLIND_CONSTANT = 0x00FF


def _cases() -> tuple[CalibrationCase, ...]:
    return (
        CalibrationCase(
            case_id="CAL-M6-POS-LINEAR",
            kind=CaseKind.POSITIVE_CONTROL,
            target_id="rotation-xor-circuit",
            target_factory=lambda: RotateXorConstant.create(
                BLIND_WIDTH, BLIND_AMOUNT, 0
            ),
            quantity="linear_propagation",
            comparator=Comparator.EQUAL,
            expected=1,
            expectation_provenance=Provenance(
                computation_id="M6-CTRL-POS-001",
                notes=(
                    "rotation distributes over XOR -- (a ^ b) <<< r equals "
                    "(a <<< r) ^ (b <<< r) -- and rotations compose, so a circuit "
                    "of XORs and rotations carries a rotational pair through "
                    "unchanged at any depth. Probability exactly 1, deductively. "
                    "Checked exhaustively in tests/test_module_rx.py at every "
                    "rotation amount"
                ),
            ),
            assertion=(
                "the module reports probability exactly 1 for a circuit built "
                "only from rotations and XORs"
            ),
            rationale=(
                "the fact the entire technique rests on. If this were anything "
                "but 1 there would be no such thing as a rotational "
                "distinguisher, so an instrument that got it wrong would be "
                "measuring something else entirely"
            ),
            parameters={"width": BLIND_WIDTH, "amount": BLIND_AMOUNT},
        ),
        CalibrationCase(
            case_id="CAL-M6-NEG-CONSTANT",
            kind=CaseKind.NEGATIVE_CONTROL,
            target_id=f"rotate-xor-constant width={BLIND_WIDTH} C={BLIND_CONSTANT:#x}",
            target_factory=lambda: RotateXorConstant.create(
                BLIND_WIDTH, BLIND_AMOUNT, BLIND_CONSTANT
            ),
            quantity="rx_offset_is_zero",
            comparator=Comparator.EQUAL,
            expected=0,
            expectation_provenance=Provenance(
                computation_id="M6-CTRL-NEG-001",
                notes=(
                    "f(x) = (x <<< r) XOR C gives f(x <<< r) = (x <<< 2r) XOR C "
                    "and f(x) <<< r = (x <<< 2r) XOR (C <<< r), which are equal "
                    "only when C == C <<< r. For C = 0x00FF at width 16, r = 3 "
                    "they are equal at no input, so the offset is never zero. "
                    "Counted exhaustively in verify/rotational.py: 0 of 65536"
                ),
            ),
            assertion=(
                "the module reports the plain rotational relation failing at "
                "every input for a non-rotation-invariant constant"
            ),
            rationale=(
                "the floor, and an unusually hard one: not merely at the random "
                "level but exactly zero. An instrument reporting any propagation "
                "here would be tolerating an offset it claims not to"
            ),
            parameters={
                "width": BLIND_WIDTH,
                "amount": BLIND_AMOUNT,
                "constant": BLIND_CONSTANT,
                "probe_inputs": 64,
            },
        ),
        CalibrationCase(
            case_id="CAL-M6-INT-ADDITION",
            kind=CaseKind.INTERMEDIATE_CONTROL,
            target_id=f"modular-addition width={CONTROL_WIDTH}",
            target_factory=lambda: RotateXorConstant.create(
                BLIND_WIDTH, BLIND_AMOUNT, 0
            ),
            quantity="additions_to_random_level",
            comparator=Comparator.EQUAL,
            expected=183,
            expectation_provenance=Provenance(
                computation_id="M6-CTRL-INT-001",
                notes=(
                    "one 8-bit modular addition propagates a rotational pair at "
                    "r = 1 with probability exactly 387/1024, and the smallest k "
                    "with p^k <= 2^-256 is 183. Computed two ways that agree: the "
                    "closed form over carry cases in modules/rx/measure.py, and a "
                    "full enumeration of all 65536 (x, y) pairs in "
                    "verify/rotational.py. Width 8 rather than 32 because the "
                    "counted path cannot enumerate 2^64 pairs, and a control only "
                    "one path can compute cross-checks nothing. The 32-bit figure "
                    "the module reports -- 181 additions, p = 2^-1.415037 -- rests "
                    "on the same closed form, checked against counting at widths "
                    "4, 6 and 8 at every rotation amount"
                ),
            ),
            assertion=(
                "the module reports 183 modular additions as the point at which "
                "an 8-bit rotational characteristic at r = 1 reaches the 2^-256 "
                "level"
            ),
            rationale=(
                "a middle answer, and the only control here that is neither 0 "
                "nor 1. It also exercises the composition: an instrument can get "
                "a single probability right and still compound it wrongly"
            ),
            parameters={
                "width": CONTROL_WIDTH,
                "amount": CONTROL_AMOUNT,
                "n_out_bits": PRIMARY_N_OUT,
            },
        ),
        CalibrationCase(
            case_id="CAL-M6-BLIND-RX",
            kind=CaseKind.BLINDNESS,
            target_id=f"rotate-xor-constant width={BLIND_WIDTH} C={BLIND_CONSTANT:#x}",
            target_factory=lambda: RotateXorConstant.create(
                BLIND_WIDTH, BLIND_AMOUNT, BLIND_CONSTANT
            ),
            quantity="rx_offset_is_zero",
            comparator=Comparator.EQUAL,
            expected=0,
            expectation_provenance=Provenance(
                computation_id="M6-BLIND-001",
                notes=(
                    "the plain measure returns its strongest null -- propagation "
                    "at no input -- while the offset between the two sides is the "
                    "same constant C XOR (C <<< r) = 0x707 at all 65536 inputs, a "
                    "rotational-XOR characteristic of probability 1. Both paths "
                    "agree on the value asserted here, which is what makes it a "
                    "recomputable control; the disagreement that *is* the "
                    "blindness needs two measures at once and is exhibited in "
                    "tests/test_blindness_rx.py (D-056)"
                ),
            ),
            assertion=(
                "the module emits its null for a function that is completely "
                "transparent to the rotational-XOR relation"
            ),
            rationale=(
                "section 6(b) and 6(c). The plain relation is the special case "
                "offset = 0 of the relation that matters, and a design's round "
                "constants alone move it off that case. Both numbers are exact "
                "rather than elevated or reduced -- 0 and 1 -- which makes this "
                "the sharpest blindness class here"
            ),
            parameters={
                "width": BLIND_WIDTH,
                "amount": BLIND_AMOUNT,
                "constant": BLIND_CONSTANT,
                "probe_inputs": 64,
                "structure_not_seen": "a probability-1 rotational-XOR characteristic",
            },
        ),
    )


SUITE = CalibrationSuite(
    module_id=MODULE_ID,
    cases=_cases(),
    citations=CITATIONS,
    allow_missing_ground_truth=True,
    missing_ground_truth_reason=(
        "section 5 requires a published anchor an independent reader can check; "
        "neither brief names one for Module 6 (ESCALATIONS.md E-05)"
    ),
)
