"""Derivation of every number in PREREG-M2.md.

Prime directive 2.1: no number in a pre-registration is a constant somebody
believed. The declared inputs are the SHA-256 schedule's own shape; everything
else is computed from them, and ``tests/test_prereg_m2.py`` asserts the block in
PREREG-M2.md is byte-equal to ``render_block()``.

Run:  python modules/reach/prereg/derive_thresholds.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from modules.reach.measure import (  # noqa: E402
    BLOCK_WORDS,
    SCHEDULE_OFFSETS,
    first_round_reaching_every_word,
    freedom_budget,
    reachable_words,
    schedule_sources,
)

COMPUTATION_ID = "M2-DERIVE-001"

#: Round counts the pre-registration states reachability at. Chosen to bracket
#: the two completeness rounds the module predicts, before either was computed.
DECLARED_ROUNDS = (1, 4, 8, 15, 16, 17, 24, 64)


def derive() -> dict[str, object]:
    full_word_round = first_round_reaching_every_word()
    return {
        "block_words": BLOCK_WORDS,
        "schedule_offsets": list(SCHEDULE_OFFSETS),
        "schedule_fan_in": len(SCHEDULE_OFFSETS),
        "first_round_reaching_every_block_word": full_word_round,
        "free_words_total": BLOCK_WORDS,
        "free_bits_total": freedom_budget(BLOCK_WORDS).free_bits,
        "last_directly_settable_round": freedom_budget(BLOCK_WORDS).last_directly_settable_round,
        "first_derived_round": BLOCK_WORDS,
        "sources_of_first_derived_word": sorted(schedule_sources(BLOCK_WORDS)),
        "reachable_words_by_round": {r: len(reachable_words(r)) for r in DECLARED_ROUNDS},
    }


def render_block() -> str:
    d = derive()
    lines = [f"<!-- BEGIN DERIVED computation_id={COMPUTATION_ID} -->"]
    for key in (
        "block_words",
        "schedule_offsets",
        "schedule_fan_in",
        "first_round_reaching_every_block_word",
        "free_words_total",
        "free_bits_total",
        "last_directly_settable_round",
        "first_derived_round",
        "sources_of_first_derived_word",
    ):
        lines.append(f"- `{key}`: {d[key]}")
    reach = d["reachable_words_by_round"]
    assert isinstance(reach, dict)
    for rounds in DECLARED_ROUNDS:
        lines.append(f"- `reachable_words_r{rounds}`: {reach[rounds]}")
    lines.append("<!-- END DERIVED -->")
    return "\n".join(lines)


if __name__ == "__main__":
    print(render_block())
