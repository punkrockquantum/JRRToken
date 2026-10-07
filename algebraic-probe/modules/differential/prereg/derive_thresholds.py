"""Derivation of every number in PREREG-M3.md.

Prime directive 2.1: no number in a pre-registration is a constant somebody
believed. ``tests/test_prereg_m3.py`` asserts the block in the document is
byte-equal to ``render_block()``.

Run:  python modules/differential/prereg/derive_thresholds.py
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from modules.differential.measure import (  # noqa: E402
    CONFIDENCE,
    MAX_EXACT_DIFFERENTIAL_VARS,
    SEEDS_PER_CELL,
)
from stats.power import clopper_pearson_interval, witness_min_detectable  # noqa: E402

COMPUTATION_ID = "M3-DERIVE-001"

#: Family-wise level for the Benjamini-Hochberg correction over the differential
#: family. Matches PREREG-M1's alpha so the two modules do not disagree.
ALPHA = 0.05

#: Family size: one Tier S cell per input difference examined. Declared here and
#: asserted at analysis time by stats.bh.benjamini_hochberg.
FAMILY_SIZE = 32

#: Output width of the primary target's chaining value.
N_OUT_BITS_PRIMARY = 256

#: Statistical power the design is required to have.
POWER = 0.80

#: Smallest reportable difference in a step count. Steps are integer-valued.
EFFECT_FLOOR_STEPS = 1.0

#: Data-complexity ceiling, log2. This project's declared compute budget, not a
#: sourced measurement -- the same policy number and the same reasoning as
#: PREREG-M1 carries after E-02 was decided (D-047).
FEASIBILITY_CEILING_LOG2 = 63.1
FEASIBILITY_CEILING_PROVENANCE = "declared-project-budget"


def derive() -> dict[str, object]:
    bh_smallest = ALPHA / FAMILY_SIZE
    detectable = witness_min_detectable(SEEDS_PER_CELL, POWER)
    # With zero hits in a cell, the interval's upper bound is all a null is
    # entitled to say.
    zero_hit_upper = clopper_pearson_interval(0, SEEDS_PER_CELL, CONFIDENCE)[1]
    # The smallest hit count whose interval clears the random level of a
    # 256-bit output. The random level is astronomically small, so one hit
    # suffices -- which is the point worth registering, not hiding.
    one_hit_low = clopper_pearson_interval(1, SEEDS_PER_CELL, CONFIDENCE)[0]
    random_level_primary = 2.0**-N_OUT_BITS_PRIMARY
    return {
        "seeds_per_cell": SEEDS_PER_CELL,
        "alpha": ALPHA,
        "family_size": FAMILY_SIZE,
        "power": POWER,
        "confidence": CONFIDENCE,
        "n_out_bits_primary": N_OUT_BITS_PRIMARY,
        "effect_floor_steps": EFFECT_FLOOR_STEPS,
        "feasibility_ceiling_log2": FEASIBILITY_CEILING_LOG2,
        "feasibility_ceiling_provenance": FEASIBILITY_CEILING_PROVENANCE,
        "max_exact_differential_vars": MAX_EXACT_DIFFERENTIAL_VARS,
        "bh_smallest_critical_value": bh_smallest,
        "min_detectable_rate_at_power80": detectable,
        "zero_hit_rate_upper_bound_95": zero_hit_upper,
        "one_hit_rate_lower_bound_95": one_hit_low,
        "random_level_primary_log2": float(-N_OUT_BITS_PRIMARY),
        "one_hit_clears_primary_random_level": one_hit_low > random_level_primary,
        "exact_path_ceiling_inputs_log2": float(MAX_EXACT_DIFFERENTIAL_VARS),
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
        "seeds_per_cell",
        "alpha",
        "family_size",
        "power",
        "confidence",
        "n_out_bits_primary",
        "effect_floor_steps",
        "feasibility_ceiling_log2",
        "feasibility_ceiling_provenance",
        "max_exact_differential_vars",
        "bh_smallest_critical_value",
        "min_detectable_rate_at_power80",
        "zero_hit_rate_upper_bound_95",
        "one_hit_rate_lower_bound_95",
        "random_level_primary_log2",
        "one_hit_clears_primary_random_level",
        "exact_path_ceiling_inputs_log2",
    ):
        lines.append(f"- `{key}`: {_fmt(d[key])}")
    lines.append("<!-- END DERIVED -->")
    return "\n".join(lines)


if __name__ == "__main__":
    print(render_block())
