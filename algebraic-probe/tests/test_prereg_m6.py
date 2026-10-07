"""PREREG-M6: every declared number traces to its derivation."""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path

from modules.rx.prereg.derive_thresholds import COMPUTATION_ID, derive, render_block
from provenance.prereg import load

ROOT = Path(__file__).resolve().parents[1]
PREREG = "modules/rx/prereg/PREREG-M6.md"


def test_the_document_contains_the_derived_block_verbatim() -> None:
    text = (ROOT / PREREG).read_text(encoding="utf-8")
    assert render_block() in text, "PREREG-M6.md has drifted from its derivation"


def test_the_derivation_carries_its_computation_id() -> None:
    assert COMPUTATION_ID == "M6-DERIVE-001"
    assert f"computation_id={COMPUTATION_ID}" in render_block()


def test_the_prereg_loads_and_declares_the_module() -> None:
    prereg = load(PREREG)
    assert prereg.prereg_id == "PREREG-M6"
    assert prereg.fields["module"] == "modules.rx"
    assert prereg.fields["declared_tiers"] == "P,S"


def test_sampling_is_declared_because_this_module_actually_samples() -> None:
    """Unlike M2 and M5, seeds_per_cell here is a real declaration."""
    prereg = load(PREREG)
    assert prereg.fields["seeds_per_cell"] == "50"
    assert int(prereg.fields["family_size"]) == 31


def test_the_probability_is_declared_as_an_exact_rational() -> None:
    """A float in a pre-registration would make an exact value look measured."""
    d = derive()
    exact = Fraction(
        d["addition_probability_numerator"], d["addition_probability_denominator"]
    )
    assert exact == Fraction(6442450947, 17179869184)
    assert 0 < exact < 1


def test_the_family_size_matches_the_rotation_amounts_examined() -> None:
    d = derive()
    assert d["family_size"] == d["width"] - 1, "one cell per non-zero rotation"


def test_the_correction_is_the_declared_level_over_the_declared_family() -> None:
    d = derive()
    assert d["bh_smallest_critical_value"] == d["alpha"] / d["family_size"]


def test_the_linear_fact_is_registered_as_exactly_one() -> None:
    assert derive()["linear_propagation_probability"] == 1
