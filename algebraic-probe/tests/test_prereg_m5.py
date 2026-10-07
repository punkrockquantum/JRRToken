"""PREREG-M5: every declared number traces to its derivation."""

from __future__ import annotations

from pathlib import Path

from modules.mitm.prereg.derive_thresholds import COMPUTATION_ID, derive, render_block
from provenance.prereg import load

ROOT = Path(__file__).resolve().parents[1]
PREREG = "modules/mitm/prereg/PREREG-M5.md"


def test_the_document_contains_the_derived_block_verbatim() -> None:
    text = (ROOT / PREREG).read_text(encoding="utf-8")
    assert render_block() in text, "PREREG-M5.md has drifted from its derivation"


def test_the_derivation_carries_its_computation_id() -> None:
    assert COMPUTATION_ID == "M5-DERIVE-001"
    assert f"computation_id={COMPUTATION_ID}" in render_block()


def test_the_prereg_loads_and_declares_the_module() -> None:
    prereg = load(PREREG)
    assert prereg.prereg_id == "PREREG-M5"
    assert prereg.fields["module"] == "modules.mitm"
    assert prereg.fields["declared_tiers"] == "P,E"


def test_no_sampling_is_registered_because_none_is_possible() -> None:
    """Tiers P and E only, so a seed count would be a promise it cannot keep."""
    prereg = load(PREREG)
    assert prereg.fields["seeds_per_cell"] == "0"
    assert prereg.fields["family_size"] == "1"


def test_the_enumeration_space_is_declared_and_exhaustive() -> None:
    d = derive()
    assert d["cuts_enumerated_full_schedule"] == d["full_rounds"] + 1
    assert d["enumeration_is_exhaustive"] is True


def test_the_freedom_arithmetic_is_derived_not_written() -> None:
    d = derive()
    assert d["block_freedom_bits"] == d["block_words"] * d["word_bits"]
    assert d["balanced_matching_dof_bits"] == d["block_freedom_bits"] // 2


def test_the_balanced_freedom_sits_above_the_feasibility_ceiling() -> None:
    """Registered because it is the honest reading, not the flattering one.

    256 bits of matching freedom is far above this project's 63.1-bit budget, so
    a split whose enumeration could not be run is reported as structure and
    never as an attack. Registering the *False* here stops that being discovered
    later and presented as a caveat.
    """
    d = derive()
    assert d["balanced_dof_under_feasibility_ceiling"] is False
    assert d["balanced_matching_dof_bits"] > d["feasibility_ceiling_log2"]


def test_the_gate_compares_against_the_generic_cost_it_displaces() -> None:
    assert derive()["generic_preimage_log2"] == 256
