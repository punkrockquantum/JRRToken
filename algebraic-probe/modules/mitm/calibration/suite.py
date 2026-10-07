"""Module 5 calibration suite.

Section 5 names an anchor for this module -- published preimage attacks on
reduced-round SHA-256 -- so like Module 3, and unlike Modules 2, 4 and 6, this
suite *has* a published-ground-truth case. It is ``PENDING_PRIMARY_SOURCE``
because the source is unreachable (E-04). That is a repairable block: a number
transcribed, rather than the brief naming something it does not.

The controls are chosen so each answer is forced by the schedule's definition
rather than argued from it:

  positive     a cut at round 8 of the first 16 rounds. Below round 16 every
               schedule word *is* a block word, so the two chunks consume
               {0..7} and {8..15} exactly. Sixteen neutral words is the only
               possible answer, and any other is wrong.
  negative     a one-round range. Every cut in it leaves one chunk empty, and
               an empty chunk has no neutral words, so no cut is independent.
               The floor: a positive reading here is an artefact of the
               counting, not a property of SHA-256.
  intermediate the matching freedom at 20 rounds, which is neither the maximum
               nor zero and has to be computed.
  blindness    a schedule whose wiring carries every block word into a tail
               that depends on one of them.
"""

from __future__ import annotations

from core.sha256 import SHA256Compression
from core.targets import CancellingSchedule
from harness.calibration import (
    PENDING_PRIMARY_SOURCE,
    CalibrationCase,
    CalibrationSuite,
    CaseKind,
    Comparator,
)
from tiers.provenance import Provenance

from ..citations import CITATIONS

MODULE_ID = "modules.mitm"

#: The positive control's cut and range. Below round 16 the schedule has not
#: started deriving words, so the consumption sets are the block words
#: themselves and the expected answer is forced rather than measured.
POSITIVE_CUT = 8
POSITIVE_END = 16

#: The negative control's range: one round, so every cut leaves a chunk empty.
NEGATIVE_END = 1

#: The intermediate control's round count.
INTERMEDIATE_END = 20

#: The blindness case's round count: the first at which the module emits its
#: null on SHA-256, and a value both paths agree on.
BLIND_END = 24


def _cases() -> tuple[CalibrationCase, ...]:
    return (
        CalibrationCase(
            case_id="CAL-M5-GT-SHA256",
            kind=CaseKind.PUBLISHED_GROUND_TRUTH,
            target_id="sha256-compression-parametrised",
            target_factory=lambda: SHA256Compression.create(n_rounds=64),
            quantity="last_independent_round",
            comparator=Comparator.EQUAL,
            expected=PENDING_PRIMARY_SOURCE,
            expectation_provenance=Provenance(citation_key="CITE-SHA256-MITM"),
            assertion=(
                "the round count at which this module stops finding a word-level "
                "split is compared against the round count a published "
                "meet-in-the-middle preimage attack reaches, in the attack model "
                "that result assumes"
            ),
            rationale=(
                "the only case here that tests this module against anybody else. "
                "It is also the case most likely to *disagree*, and the "
                "disagreement would be informative rather than a defect: this "
                "module models word-level neutrality alone, while published "
                "attacks add partial matching, initial structures and message "
                "compensation. A published attack reaching further than this "
                "module's last independent round measures what those techniques "
                "buy; a published attack reaching less far would mean one of the "
                "two is wrong"
            ),
            parameters={"model": "to be recorded with the transcription"},
        ),
        CalibrationCase(
            case_id="CAL-M5-POS-BLOCKWORDS",
            kind=CaseKind.POSITIVE_CONTROL,
            target_id="sha256-compression-parametrised rounds=16",
            target_factory=lambda: SHA256Compression.create(n_rounds=POSITIVE_END),
            quantity="neutral_word_count",
            comparator=Comparator.EQUAL,
            expected=16,
            expectation_provenance=Provenance(
                computation_id="M5-CTRL-POS-001",
                notes=(
                    "for t < 16 the schedule word W[t] is the block word t itself, "
                    "so rounds [0, 8) consume exactly {0..7} and rounds [8, 16) "
                    "exactly {8..15}. The two sets are disjoint, so all 8 words on "
                    "each side are neutral and the count is 16. Forced by the "
                    "definition of the schedule below round 16, not measured. "
                    "Cross-checked against verify/mitm.py, which observes the same "
                    "sets by flipping bits of the real message_schedule"
                ),
            ),
            assertion=(
                f"the module counts 16 neutral words at a cut at round "
                f"{POSITIVE_CUT} of the first {POSITIVE_END} rounds"
            ),
            rationale=(
                "the answer is forced: below round 16 nothing is derived, so any "
                "count other than 16 means the module has misread which words a "
                "round consumes. A splitting instrument that gets the un-derived "
                "part of the schedule wrong has not been shown to read it at all"
            ),
            parameters={"start": 0, "cut": POSITIVE_CUT, "end": POSITIVE_END},
        ),
        CalibrationCase(
            case_id="CAL-M5-NEG-EMPTYCHUNK",
            kind=CaseKind.NEGATIVE_CONTROL,
            target_id="sha256-compression-parametrised rounds=1",
            target_factory=lambda: SHA256Compression.create(n_rounds=NEGATIVE_END),
            quantity="independent_split_count",
            comparator=Comparator.EQUAL,
            expected=0,
            expectation_provenance=Provenance(
                computation_id="M5-CTRL-NEG-001",
                notes=(
                    "a one-round range admits two cuts, at 0 and at 1, and each "
                    "leaves one chunk with no rounds in it. A chunk that consumes "
                    "nothing has no neutral words, and independence requires a "
                    "non-empty neutral set on both sides, so neither cut is "
                    "independent. Forced by the definition"
                ),
            ),
            assertion=(
                "the module finds no independent split in a one-round range, where "
                "every cut leaves a chunk empty"
            ),
            rationale=(
                "the floor. A module that reported a split here would be treating "
                "an empty chunk as having freedom, which would make every round "
                "count look splittable and the whole quantity meaningless"
            ),
            parameters={"start": 0, "end": NEGATIVE_END},
        ),
        CalibrationCase(
            case_id="CAL-M5-INT-DOF20",
            kind=CaseKind.INTERMEDIATE_CONTROL,
            target_id="sha256-compression-parametrised rounds=20",
            target_factory=lambda: SHA256Compression.create(n_rounds=INTERMEDIATE_END),
            quantity="matching_dof_bits",
            comparator=Comparator.EQUAL,
            expected=128,
            expectation_provenance=Provenance(
                computation_id="M5-CTRL-INT-001",
                notes=(
                    "computed by closing the schedule recurrence over the first 20 "
                    "rounds: the best cut is at round 9, with forward neutral "
                    "{5,6,7,8} and backward neutral {9..15}, so the matching side "
                    "is 4 words = 128 bits. Neither the maximum (256 bits, at 16 "
                    "rounds) nor zero (from 24 rounds on), so an instrument that "
                    "got only the endpoints right would fail here"
                ),
            ),
            assertion=(
                "the module reports 128 bits of matching freedom for the best cut "
                "of the first 20 rounds"
            ),
            rationale=(
                "a middle answer. The matching freedom falls by exactly one word "
                "per round between 16 and 24, and this case sits in the middle of "
                "that decay where neither endpoint's answer is right"
            ),
            parameters={"start": 0, "end": INTERMEDIATE_END},
        ),
        CalibrationCase(
            case_id="CAL-M5-BLIND-CANCEL",
            kind=CaseKind.BLINDNESS,
            target_id="sha256-compression-parametrised rounds=24",
            target_factory=lambda: SHA256Compression.create(n_rounds=BLIND_END),
            quantity="independent_split_count",
            comparator=Comparator.EQUAL,
            expected=0,
            expectation_provenance=Provenance(
                computation_id="M5-BLIND-001",
                notes=(
                    "at 24 rounds no cut has a neutral set on both sides, so the "
                    "module emits its null. Both paths agree on this value -- the "
                    "observed dependence of the real message_schedule equals the "
                    "closure at every word below 24 -- which is what makes it a "
                    "recomputable control. The blindness is that the same null is "
                    "emitted for a schedule that *does* split: "
                    "core.targets.CancellingSchedule, whose wiring reports no "
                    "forward neutral words where three exist. That needs two "
                    "measures at once and so cannot be a single-valued case here; "
                    "it is exhibited in tests/test_blindness_mitm.py. A case whose "
                    "counterexample makes the two paths disagree cannot also be a "
                    "recomputable control, which is why the null is asserted here "
                    "and the disagreement is asserted there (D-056)"
                ),
            ),
            assertion=(
                "the module finds no independent split at 24 rounds, the null "
                "whose uninformativeness the blindness class establishes"
            ),
            rationale=(
                "section 6(b) and 6(c). Consumption unions the operands of every "
                "step, so a word that reaches a chunk and cancels inside it is "
                "still counted as consumed and therefore not counted neutral. The "
                "null 'no independent split' is compatible with a split existing. "
                "The direction is worth recording: the measure under-reports "
                "attack structure rather than inventing it, so it cannot produce a "
                "false positive -- but a null from it is not evidence of absence"
            ),
            parameters={
                "start": 0,
                "end": BLIND_END,
                "counterexample": "core.targets.CancellingSchedule",
                "structure_not_seen": "a split hidden by a cancelling term",
            },
        ),
    )


SUITE = CalibrationSuite(module_id=MODULE_ID, cases=_cases(), citations=CITATIONS)
