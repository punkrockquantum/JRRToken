"""PREREG-M2 cannot drift from its derivation.

Same guard as PREREG-M1's: the derived block in the document must be byte-equal
to what the derivation script prints, so a number in the pre-registration is
always a computation and never a recollection.
"""

from __future__ import annotations

from pathlib import Path

from modules.reach.prereg.derive_thresholds import COMPUTATION_ID, render_block
from modules.reach.spec import PREREG_PATH, SPEC
from provenance.prereg import load
from tiers.tier import Tier

ROOT = Path(__file__).resolve().parents[1]


def test_the_derived_block_is_byte_equal_to_its_derivation() -> None:
    text = (ROOT / PREREG_PATH).read_text(encoding="utf-8")
    assert render_block() in text


def test_the_block_carries_its_computation_id() -> None:
    assert COMPUTATION_ID == "M2-DERIVE-001"
    assert COMPUTATION_ID in render_block()


def test_the_document_parses_and_declares_tier_p_only() -> None:
    prereg = load(PREREG_PATH)
    assert prereg.prereg_id == "PREREG-M2"
    assert prereg.fields["declared_tiers"] == "P"
    assert prereg.fields["module"] == "modules.reach"
    assert prereg.fields["seeds_per_cell"] == "0", (
        "a module with no sampled path must declare zero seeds, not a number it "
        "will never use"
    )


def test_the_spec_agrees_with_the_document() -> None:
    prereg = load(PREREG_PATH)
    declared = {Tier(t.strip()) for t in prereg.fields["declared_tiers"].split(",")}
    assert SPEC.declared_tiers == declared == {Tier.P}
    assert SPEC.prereg_path == PREREG_PATH
    assert SPEC.runner_path == prereg.fields["runner_path"]


def test_the_document_states_both_hypotheses_and_the_no_claim_clause() -> None:
    text = (ROOT / PREREG_PATH).read_text(encoding="utf-8")
    for needle in ("H1 (soundness)", "H2 (word level", "H3 (two completeness",
                   "Reachability is not dependence"):
        assert needle in text, needle
