"""Derivation of every number in PREREG-M6.md.

Prime directive 2.1: no number in a pre-registration is a constant somebody
believed. ``tests/test_prereg_m6.py`` asserts the block in the document is
byte-equal to ``render_block()``.

Run:  python modules/rx/prereg/derive_thresholds.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from modules.rx.measure import (  # noqa: E402
    CONFIDENCE,
    SEEDS_PER_CELL,
    addition_probability,
    addition_probability_log2,
    additions_to_random_level,
)
from stats.power import clopper_pearson_interval, witness_min_detectable  # noqa: E402

COMPUTATION_ID = "M6-DERIVE-001"

#: SHA-256's word width, and the rotation amount the headline figures use.
WIDTH = 32
AMOUNT = 1

#: Output width a characteristic is compared against.
N_OUT_BITS_PRIMARY = 256

#: Family-wise level, matching PREREG-M1 and PREREG-M3 so the modules do not
#: disagree.
ALPHA = 0.05

#: Family size: one Tier S cell per rotation amount examined at width 32.
FAMILY_SIZE = 31

POWER = 0.80

#: Smallest reportable difference in an addition count. Integer-valued.
EFFECT_FLOOR_ADDITIONS = 1

#: Data-complexity ceiling, log2. This project's declared compute budget, not a
#: sourced measurement -- the same policy number PREREG-M1, M3 and M5 carry.
FEASIBILITY_CEILING_LOG2 = 63.1
FEASIBILITY_CEILING_PROVENANCE = "declared-project-budget"


def derive() -> dict[str, object]:
    probability = addition_probability(WIDTH, AMOUNT)
    bh_smallest = ALPHA / FAMILY_SIZE
    detectable = witness_min_detectable(SEEDS_PER_CELL, POWER)
    zero_hit_upper = clopper_pearson_interval(0, SEEDS_PER_CELL, CONFIDENCE)[1]
    return {
        "width": WIDTH,
        "rotation_amount": AMOUNT,
        "n_out_bits_primary": N_OUT_BITS_PRIMARY,
        "linear_propagation_probability": 1,
        "addition_probability_numerator": probability.numerator,
        "addition_probability_denominator": probability.denominator,
        "addition_probability_log2": addition_probability_log2(WIDTH, AMOUNT),
        "additions_to_random_level": additions_to_random_level(
            WIDTH, AMOUNT, N_OUT_BITS_PRIMARY
        ),
        "seeds_per_cell": SEEDS_PER_CELL,
        "confidence": CONFIDENCE,
        "alpha": ALPHA,
        "family_size": FAMILY_SIZE,
        "power": POWER,
        "bh_smallest_critical_value": bh_smallest,
        "min_detectable_rate_at_power80": detectable,
        "zero_hit_rate_upper_bound_95": zero_hit_upper,
        "effect_floor_additions": EFFECT_FLOOR_ADDITIONS,
        "feasibility_ceiling_log2": FEASIBILITY_CEILING_LOG2,
        "feasibility_ceiling_provenance": FEASIBILITY_CEILING_PROVENANCE,
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
        "width",
        "rotation_amount",
        "n_out_bits_primary",
        "linear_propagation_probability",
        "addition_probability_numerator",
        "addition_probability_denominator",
        "addition_probability_log2",
        "additions_to_random_level",
        "seeds_per_cell",
        "confidence",
        "alpha",
        "family_size",
        "power",
        "bh_smallest_critical_value",
        "min_detectable_rate_at_power80",
        "zero_hit_rate_upper_bound_95",
        "effect_floor_additions",
        "feasibility_ceiling_log2",
        "feasibility_ceiling_provenance",
    ):
        lines.append(f"- `{key}`: {_fmt(d[key])}")
    lines.append("<!-- END DERIVED -->")
    return "\n".join(lines)


if __name__ == "__main__":
    print(render_block())
