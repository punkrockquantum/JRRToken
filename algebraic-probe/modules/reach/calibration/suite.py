"""Module 2 calibration suite.

No published-ground-truth case exists: section 5 requires an anchor a reader can
check against a paper, and neither brief names one for this module. The suite is
built with ``allow_missing_ground_truth`` and the module ships
calibration-blocked (ESCALATIONS.md E-05), as Module 4 does.

What the cases do establish is that the reachability path measures what it
claims. The positive control is the smallest case where the answer is forced: one
round consumes exactly one message word, so exactly 32 input bits can reach the
output and any other answer is wrong. The negative control is zero rounds, where
the output is the feed-forward alone and nothing is reachable -- the floor. The
intermediate control sits strictly between, and the blindness case is where the
over-approximation is exhibited rather than asserted.
"""

from __future__ import annotations

from core.sha256 import SHA256Compression
from harness.calibration import CalibrationCase, CalibrationSuite, CaseKind, Comparator
from tiers.provenance import Provenance

from ..citations import CITATIONS

MODULE_ID = "modules.reach"

WORD = 32


def _case(case_id, kind, target_id, factory, quantity, expected, assertion, rationale, params):
    return CalibrationCase(
        case_id=case_id,
        kind=kind,
        target_id=target_id,
        target_factory=factory,
        quantity=quantity,
        comparator=Comparator.EQUAL,
        expected=expected,
        expectation_provenance=Provenance(
            computation_id=f"M2-CTRL-{case_id}",
            notes=(
                "established from the schedule's own shape: round t consumes W[t], "
                "and W[0..15] are the block words themselves"
            ),
        ),
        assertion=assertion,
        rationale=rationale,
        parameters=params,
    )


def _cases() -> tuple[CalibrationCase, ...]:
    return (
        _case(
            "CAL-M2-NEG-ZERO",
            CaseKind.NEGATIVE_CONTROL,
            "sha256-compression rounds=0",
            lambda: SHA256Compression.create(n_rounds=0),
            "reachable_input_bits",
            0,
            "no input bit is reachable at zero rounds",
            "the floor: the output is the Davies-Meyer feed-forward alone, so a "
            "path that reported any reachable bit would be reporting an artefact "
            "of its own propagation",
            {"rounds": 0},
        ),
        _case(
            "CAL-M2-POS-ONE-ROUND",
            CaseKind.POSITIVE_CONTROL,
            "sha256-compression rounds=1",
            lambda: SHA256Compression.create(n_rounds=1),
            "reachable_input_bits",
            WORD,
            f"exactly {WORD} input bits are reachable after one round",
            "the smallest case where the answer is forced rather than argued: one "
            "round consumes exactly W[0], so exactly its 32 bits can reach the "
            "output. Any other answer is wrong, which is what makes this the "
            "single most important case here",
            {"rounds": 1, "words_consumed": 1},
        ),
        _case(
            "CAL-M2-INT-EIGHT-ROUNDS",
            CaseKind.INTERMEDIATE_CONTROL,
            "sha256-compression rounds=8",
            lambda: SHA256Compression.create(n_rounds=8),
            "reachable_input_bits",
            8 * WORD,
            f"exactly {8 * WORD} input bits are reachable after eight rounds",
            "a middle-of-range answer, strictly inside (0, 512): an instrument "
            "that only gets the two endpoints right has not been shown to measure "
            "anything between them",
            {"rounds": 8, "words_consumed": 8},
        ),
        _case(
            "CAL-M2-INT-FREEDOM",
            CaseKind.INTERMEDIATE_CONTROL,
            "sha256-compression rounds=20",
            lambda: SHA256Compression.create(n_rounds=20),
            "free_message_bits",
            16 * WORD,
            "the freedom budget saturates at 512 bits once sixteen rounds have "
            "consumed the whole block, and later rounds add none",
            "the second declared quantity, and the one that does not grow: from "
            "round 16 the schedule determines each word from words already "
            "committed, so a path that kept accumulating freedom would be wrong "
            "in the direction that flatters an attack",
            {"rounds": 20, "derived_words": 4},
        ),
        _case(
            "CAL-M2-BLIND-CANCEL",
            CaseKind.BLINDNESS,
            "sha256-compression rounds=64",
            lambda: SHA256Compression.create(n_rounds=64),
            "reachable_input_bits",
            512,
            "the module reports every one of the 512 input bits reachable at full "
            "round count -- its null -- which is the same answer it gives for a "
            "function with provably constant output bits",
            "section 6(b) and 6(c). Reachability unions its operands and cannot "
            "see that two contributions cancel, so 'complete diffusion' is "
            "compatible with identically-zero output bits. The function class that "
            "exhibits this is core.targets.CancellingXor, run in "
            "tests/test_blindness_cancellation.py, which needs two measures and "
            "two predicates and so cannot be a single-valued case here",
            {"rounds": 64, "structure_not_seen": "cancellation between paths"},
        ),
    )


SUITE = CalibrationSuite(
    module_id=MODULE_ID,
    cases=_cases(),
    citations=CITATIONS,
    allow_missing_ground_truth=True,
    missing_ground_truth_reason=(
        "section 5 requires a published anchor an independent reader can check; "
        "neither brief names one for Module 2 (ESCALATIONS.md E-05)"
    ),
)
