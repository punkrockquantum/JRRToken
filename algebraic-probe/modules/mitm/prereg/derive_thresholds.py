"""Derivation of every number in PREREG-M5.md.

Prime directive 2.1: no number in a pre-registration is a constant somebody
believed. ``tests/test_prereg_m5.py`` asserts the block in the document is
byte-equal to ``render_block()``.

Module 5 declares tiers P and E only, so there is no seed count, no confidence
level and no multiple-testing correction here. Registering statistics this
module cannot produce would be registering a promise it has no way to keep --
the numbers below are the sizes of the spaces it enumerates and the costs it
must stay under.

Run:  python modules/mitm/prereg/derive_thresholds.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from modules.mitm.measure import (  # noqa: E402
    BLOCK_WORDS,
    FULL_ROUNDS,
    WORD_BITS,
)

COMPUTATION_ID = "M5-DERIVE-001"

#: Smallest reportable difference in a round count. Rounds are integer-valued,
#: so a split that reaches one more round is the smallest real improvement.
EFFECT_FLOOR_ROUNDS = 1

#: Data-complexity ceiling, log2. This project's declared compute budget, not a
#: sourced measurement -- the same policy number and the same reasoning
#: PREREG-M1 and PREREG-M3 carry after E-02 was decided (D-047).
FEASIBILITY_CEILING_LOG2 = 63.1
FEASIBILITY_CEILING_PROVENANCE = "declared-project-budget"

#: Generic preimage cost for a 256-bit digest, log2. A meet-in-the-middle
#: preimage attack has to beat this to be an attack at all.
GENERIC_PREIMAGE_LOG2 = 256


def derive() -> dict[str, object]:
    # The enumeration space: one cut per round boundary, inclusive at both ends.
    cuts_full_schedule = FULL_ROUNDS + 1
    # Freedom available in principle: the whole message block.
    block_freedom_bits = BLOCK_WORDS * WORD_BITS
    # The most a single side can carry, which is every block word.
    max_matching_dof_bits = block_freedom_bits
    # A meet needs both sides, so the usable freedom is bounded by half the
    # block when the two neutral sets partition it.
    balanced_matching_dof_bits = block_freedom_bits // 2
    return {
        "block_words": BLOCK_WORDS,
        "word_bits": WORD_BITS,
        "full_rounds": FULL_ROUNDS,
        "block_freedom_bits": block_freedom_bits,
        "cuts_enumerated_full_schedule": cuts_full_schedule,
        "enumeration_is_exhaustive": True,
        "max_matching_dof_bits": max_matching_dof_bits,
        "balanced_matching_dof_bits": balanced_matching_dof_bits,
        "effect_floor_rounds": EFFECT_FLOOR_ROUNDS,
        "generic_preimage_log2": GENERIC_PREIMAGE_LOG2,
        "feasibility_ceiling_log2": FEASIBILITY_CEILING_LOG2,
        "feasibility_ceiling_provenance": FEASIBILITY_CEILING_PROVENANCE,
        "balanced_dof_under_feasibility_ceiling": (
            float(balanced_matching_dof_bits) <= FEASIBILITY_CEILING_LOG2
        ),
    }


def _fmt(value: object) -> str:
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return f"{value:.10g}"
    return str(value)


def render_block() -> str:
    d = derive()
    lines = [f"<!-- BEGIN DERIVED computation_id={COMPUTATION_ID} -->"]
    for key in (
        "block_words",
        "word_bits",
        "full_rounds",
        "block_freedom_bits",
        "cuts_enumerated_full_schedule",
        "enumeration_is_exhaustive",
        "max_matching_dof_bits",
        "balanced_matching_dof_bits",
        "effect_floor_rounds",
        "generic_preimage_log2",
        "feasibility_ceiling_log2",
        "feasibility_ceiling_provenance",
        "balanced_dof_under_feasibility_ceiling",
    ):
        lines.append(f"- `{key}`: {_fmt(d[key])}")
    lines.append("<!-- END DERIVED -->")
    return "\n".join(lines)


if __name__ == "__main__":
    print(render_block())
