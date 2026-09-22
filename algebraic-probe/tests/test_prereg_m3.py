"""PREREG-M3 cannot drift from its derivation."""

from __future__ import annotations

from pathlib import Path

from modules.differential.prereg.derive_thresholds import COMPUTATION_ID, render_block
from modules.differential.spec import PREREG_PATH, SPEC
from provenance.prereg import load
from tiers.tier import Tier

ROOT = Path(__file__).resolve().parents[1]


def test_the_derived_block_is_byte_equal_to_its_derivation() -> None:
    assert render_block() in (ROOT / PREREG_PATH).read_text(encoding="utf-8")


def test_the_block_carries_its_computation_id() -> None:
    assert COMPUTATION_ID == "M3-DERIVE-001"
    assert COMPUTATION_ID in render_block()


def test_the_document_declares_tiers_e_and_s() -> None:
    prereg = load(PREREG_PATH)
    assert prereg.prereg_id == "PREREG-M3"
    assert prereg.fields["declared_tiers"] == "E,S"
    assert SPEC.declared_tiers == {Tier.E, Tier.S}


def test_the_ceiling_is_declared_policy_not_a_citation() -> None:
    """E-02's decision, carried into this module's derivation."""
    assert "feasibility_ceiling_provenance`: declared-project-budget" in render_block()


def test_one_hit_is_decisive_on_the_primary_target() -> None:
    """The fact that gives this module a real Tier S path where Module 1 has
    none: a 256-bit output makes the random level 2^-256, so a single hit in
    fifty draws clears it by a vast margin."""
    assert "one_hit_clears_primary_random_level`: True" in render_block()


def test_the_document_states_the_one_sided_threshold_limit() -> None:
    text = (ROOT / PREREG_PATH).read_text(encoding="utf-8")
    for needle in ("H1 (soundness", "H2 (the floor", "H3 (the family",
                   "one-sided", "impossible differential"):
        assert needle in text, needle


def test_the_promotion_gate_is_instantiated() -> None:
    text = (ROOT / PREREG_PATH).read_text(encoding="utf-8")
    for arm in ("gate_threshold", "gate_verification", "gate_cost", "gate_falsification"):
        assert arm in text, arm
