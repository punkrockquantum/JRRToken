"""Derivation of every number that appears in PREREG-M1.md.

Prime directive 2.1: no number in the pre-registration is a constant somebody
believed to be true. The declared inputs are at the top, each with the reason it
takes that value; everything else is computed from them here, and
``tests/test_prereg_m1.py`` asserts that the block in PREREG-M1.md is byte-equal
to ``render_block()``.

Run:  python modules/degree/prereg/derive_thresholds.py
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from stats.power import (  # noqa: E402
    witness_draws_required,
    witness_min_detectable,
    zero_witness_upper_bound,
)

COMPUTATION_ID = "M1-DERIVE-001"

# ---------------------------------------------------------------------------
# Declared inputs. Each is a judgement call and is recorded in DECISIONS.md.
# ---------------------------------------------------------------------------

#: Seeds per Tier S cell. 50 is the brief's preferred value (section 3), above
#: the mandatory minimum of 30.
SEEDS_PER_CELL = 50

#: Family-wise level for the Benjamini-Hochberg correction.
ALPHA = 0.05

#: Family size: one Tier S cell per round of the primary target, r = 1..64.
#: Fixed here, asserted at analysis time by stats.bh.benjamini_hochberg.
FAMILY_SIZE = 64

#: Free input bits of the primary target: the 512-bit message block, chaining
#: value fixed to the IV.
N_FREE_BITS_PRIMARY = 512

#: Output bits of the primary target.
N_OUT_BITS_PRIMARY = 256

#: Statistical power the design is required to have.
POWER = 0.80

#: Confidence for the one-sided bound reported alongside a zero-witness null.
CONFIDENCE = 0.95

#: Probe dimension used for the worked detectability comparison in the prereg.
WORKED_PROBE_DIM = 8

#: Probe dimensions for the "how many seeds would be needed" table.
SEED_REQUIREMENT_DIMS = (4, 8, 16, 32)

#: Data-complexity ceiling, log2, above which an implied distinguisher is not
#: promoted. Derivation: the largest published practical hash computation.
#: Carries citation CITE-SHATTERED, whose verification state gates its use.
FEASIBILITY_CEILING_LOG2 = 63.1

#: Smallest representable non-zero gap between a certified upper bound on the
#: degree and a witnessed lower bound. Degree is integer-valued.
EFFECT_FLOOR_DEGREE_BITS = 1.0


def derive() -> dict[str, object]:
    """Every derived number, keyed exactly as it appears in the prereg."""
    bh_smallest_critical = ALPHA / FAMILY_SIZE
    min_detectable = witness_min_detectable(SEEDS_PER_CELL, POWER)
    zero_witness_upper = zero_witness_upper_bound(SEEDS_PER_CELL, CONFIDENCE)

    # Worst-case witness probability for a probe of dimension k, when the true
    # degree equals k: a non-zero multilinear form of degree k over GF(2) is
    # non-zero on k uniformly random vectors with probability at least 2^-k
    # (Schwartz-Zippel over GF(2)).
    def worst_case_p(k: int) -> float:
        return 2.0**-k

    max_k_power = max(k for k in range(1, 64) if worst_case_p(k) >= min_detectable)
    max_k_bh = max(
        (k for k in range(1, 64) if (1.0 - worst_case_p(k)) ** SEEDS_PER_CELL <= bh_smallest_critical),
        default=0,
    )

    seeds_required = {}
    for k in SEED_REQUIREMENT_DIMS:
        p = worst_case_p(k)
        seeds_required[k] = {
            "power80": witness_draws_required(p, POWER),
            "bh_significant": math.ceil(math.log(bh_smallest_critical) / math.log(1.0 - p)),
        }

    worked_meaningful = worst_case_p(WORKED_PROBE_DIM)

    return {
        # declared
        "seeds_per_cell": SEEDS_PER_CELL,
        "alpha": ALPHA,
        "family_size": FAMILY_SIZE,
        "power": POWER,
        "confidence": CONFIDENCE,
        "n_free_bits_primary": N_FREE_BITS_PRIMARY,
        "n_out_bits_primary": N_OUT_BITS_PRIMARY,
        "effect_floor_degree_bits": EFFECT_FLOOR_DEGREE_BITS,
        "feasibility_ceiling_log2": FEASIBILITY_CEILING_LOG2,
        # derived
        "bh_smallest_critical_value": bh_smallest_critical,
        "min_detectable_p_at_power80": min_detectable,
        "zero_witness_p_upper_bound_95": zero_witness_upper,
        "max_probe_dim_with_power80": max_k_power,
        "max_probe_dim_reaching_bh_significance": max_k_bh,
        "worked_probe_dim": WORKED_PROBE_DIM,
        "worked_meaningful_p": worked_meaningful,
        "worked_meaningful_over_detectable": worked_meaningful / min_detectable,
        "seeds_required": seeds_required,
        "existence_ceiling_k": N_FREE_BITS_PRIMARY,
        "generic_zero_sum_advantage_log2": float(N_OUT_BITS_PRIMARY),
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
    """The exact markdown block that PREREG-M1.md must contain."""
    d = derive()
    lines = [f"<!-- BEGIN DERIVED computation_id={COMPUTATION_ID} -->"]
    for key in (
        "seeds_per_cell",
        "alpha",
        "family_size",
        "power",
        "confidence",
        "n_free_bits_primary",
        "n_out_bits_primary",
        "effect_floor_degree_bits",
        "feasibility_ceiling_log2",
        "bh_smallest_critical_value",
        "min_detectable_p_at_power80",
        "zero_witness_p_upper_bound_95",
        "max_probe_dim_with_power80",
        "max_probe_dim_reaching_bh_significance",
        "worked_probe_dim",
        "worked_meaningful_p",
        "worked_meaningful_over_detectable",
        "existence_ceiling_k",
        "generic_zero_sum_advantage_log2",
    ):
        lines.append(f"- `{key}`: {_fmt(d[key])}")
    seeds_required = d["seeds_required"]
    assert isinstance(seeds_required, dict)
    for k in SEED_REQUIREMENT_DIMS:
        lines.append(
            f"- `seeds_required_power80_k{k}`: {seeds_required[k]['power80']}"
        )
        lines.append(
            f"- `seeds_required_bh_significant_k{k}`: {seeds_required[k]['bh_significant']}"
        )
    lines.append("<!-- END DERIVED -->")
    return "\n".join(lines)


if __name__ == "__main__":
    print(render_block())
