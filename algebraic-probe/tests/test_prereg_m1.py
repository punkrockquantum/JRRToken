"""PREREG-M1 cannot drift from its derivation, and declares what section 8 requires."""

from __future__ import annotations

from pathlib import Path

import pytest

from modules.degree.prereg.derive_thresholds import COMPUTATION_ID, derive, render_block
from provenance.prereg import REQUIRED_FIELDS
from provenance.prereg import load as load_prereg
from stats.power import witness_min_detectable, zero_witness_upper_bound

PREREG_PATH = "modules/degree/prereg/PREREG-M1.md"


def prereg():
    return load_prereg(PREREG_PATH)


def test_every_required_field_is_declared() -> None:
    fields = prereg().fields
    for name in REQUIRED_FIELDS:
        assert name in fields, name


def test_the_declared_values_are_the_ones_the_module_uses() -> None:
    fields = prereg().fields
    assert fields["prereg_id"] == "PREREG-M1"
    assert fields["module"] == "modules.degree"
    assert fields["declared_tiers"] == "P,E,S"
    assert fields["primary_metric"] == "k_HO"
    assert prereg().field_int("family_size") == 64
    assert prereg().field_float("alpha") == 0.05
    assert prereg().field_float("effect_floor") == 1.0
    assert prereg().field_int("seeds_per_cell") == 50


def test_the_derived_block_is_byte_equal_to_its_derivation() -> None:
    """Prime directive 2.1: no number in the document is a constant somebody
    believed to be true."""
    text = Path(load_prereg(PREREG_PATH).path).read_text(encoding="utf-8")
    assert render_block() in text
    assert f"computation_id={COMPUTATION_ID}" in text


def test_the_power_figures_are_reproduced_from_stats() -> None:
    derived = derive()
    assert derived["min_detectable_p_at_power80"] == pytest.approx(
        witness_min_detectable(50, 0.80)
    )
    assert derived["zero_witness_p_upper_bound_95"] == pytest.approx(
        zero_witness_upper_bound(50, 0.95)
    )


def test_the_detectable_versus_meaningful_comparison_is_stated_numerically() -> None:
    derived = derive()
    assert derived["worked_meaningful_over_detectable"] == pytest.approx(
        derived["worked_meaningful_p"] / derived["min_detectable_p_at_power80"]
    )
    text = Path(load_prereg(PREREG_PATH).path).read_text(encoding="utf-8")
    assert "8.1 times smaller" in text


def test_the_tier_s_closure_matches_the_computed_power() -> None:
    """The pre-registered consequence in section 9.1 follows from the numbers
    above it, not from a preference."""
    derived = derive()
    assert derived["max_probe_dim_with_power80"] == 4
    assert derived["max_probe_dim_reaching_bh_significance"] == 2
    text = Path(load_prereg(PREREG_PATH).path).read_text(encoding="utf-8")
    assert "`tier_s_promotion_closed_above_k`: 2" in text


def test_the_seed_requirement_table_is_monotone_in_the_probe_dimension() -> None:
    derived = derive()
    required = derived["seeds_required"]
    assert isinstance(required, dict)
    dims = sorted(required)
    values = [required[k]["bh_significant"] for k in dims]
    assert values == sorted(values)
    assert all(required[k]["bh_significant"] >= required[k]["power80"] for k in dims)


def test_the_promotion_gate_is_instantiated_with_concrete_numbers() -> None:
    text = Path(load_prereg(PREREG_PATH).path).read_text(encoding="utf-8")
    for marker in (
        "gate_threshold",
        "gate_verification",
        "gate_cost",
        "gate_falsification",
        "feasibility_ceiling_log2` = 63.1",
        "2^(k+256)",
        "brute force always present",
    ):
        assert marker in text, marker


def test_the_blocking_preconditions_are_declared() -> None:
    text = Path(load_prereg(PREREG_PATH).path).read_text(encoding="utf-8")
    for marker in (
        "precondition_target",
        "precondition_ground_truth",
        "precondition_calibration",
        "precondition_measurement",
    ):
        assert marker in text, marker


def test_the_holdout_rounds_are_reserved_before_any_run() -> None:
    fields = prereg().fields
    holdout = [int(r) for r in fields["holdout_rounds"].split(",")]
    assert holdout == list(range(53, 65))


def test_the_null_result_requirements_are_declared() -> None:
    text = Path(load_prereg(PREREG_PATH).path).read_text(encoding="utf-8")
    assert "`mechanism`" in text
    assert "`blindness_statement`" in text
    assert "`blindness_test`" in text
    assert "modules/degree/blindness/inverse_map.py" in text


def test_a_prereg_missing_a_required_field_is_refused(tmp_path) -> None:
    incomplete = tmp_path / "PREREG-BAD.md"
    incomplete.write_text("- `prereg_id`: X\n", encoding="utf-8")
    with pytest.raises(Exception, match="missing required fields"):
        load_prereg(incomplete)
