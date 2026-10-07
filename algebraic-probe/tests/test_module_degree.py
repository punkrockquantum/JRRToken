"""Module 1 as registered: declared, pre-registered, calibrated, and blocked."""

from __future__ import annotations

import pytest

from harness.calibration import PENDING_PRIMARY_SOURCE, CaseKind
from harness.registry import REGISTRY
from modules.degree.calibration.suite import SUITE
from modules.degree.citations import CITATIONS
from modules.degree.spec import SPEC
from tiers.errors import CalibrationBlocked, NotAuthorised, RegimeViolation
from tiers.provenance import Verification
from tiers.tier import Regime, Tier


def test_the_module_is_registered_with_its_declared_tiers() -> None:
    spec = REGISTRY.get("modules.degree")
    assert spec is SPEC
    assert spec.declared_tiers == frozenset({Tier.P, Tier.E, Tier.S})


def test_a_measurement_path_is_registered_and_dispatches_on_the_quantity() -> None:
    assert SPEC.measure is not None
    exact = next(c for c in SUITE.cases if c.quantity == "algebraic_degree")
    assert SPEC.measure(exact.target_factory(), exact) >= 0


def test_the_router_accepts_each_declared_tier_under_its_own_regime() -> None:
    for tier, regime in (
        (Tier.P, Regime.DEDUCTIVE),
        (Tier.E, Regime.ENUMERATIVE),
        (Tier.S, Regime.PROBABILISTIC),
    ):
        assert REGISTRY.route("modules.degree", tier=tier, regime=regime) is SPEC


def test_the_router_refuses_a_proof_run_under_the_sampled_regime() -> None:
    with pytest.raises(RegimeViolation):
        REGISTRY.route("modules.degree", tier=Tier.P, regime=Regime.PROBABILISTIC)


# -- the calibration suite --------------------------------------------------


def test_the_suite_carries_every_mandatory_case_kind() -> None:
    kinds = {case.kind for case in SUITE.cases}
    assert CaseKind.PUBLISHED_GROUND_TRUTH in kinds
    assert CaseKind.POSITIVE_CONTROL in kinds
    assert CaseKind.NEGATIVE_CONTROL in kinds
    assert CaseKind.INTERMEDIATE_CONTROL in kinds
    assert CaseKind.BLINDNESS in kinds


def test_the_positive_control_is_the_linear_map_and_expects_degree_one() -> None:
    case = next(c for c in SUITE.cases if c.case_id == "CAL-M1-POS-LINEAR")
    assert case.expected == 1
    target = case.target_factory()
    assert target.is_invertible
    assert case.expectation_provenance.computation_id == "M1-CTRL-LIN-001"


def test_the_intermediate_control_expects_a_middle_of_range_value() -> None:
    case = next(c for c in SUITE.cases if c.case_id == "CAL-M1-INT-POW-D31")
    assert case.expected == 5
    assert 1 < case.expected < 10


def test_the_negative_control_expects_a_saturated_degree() -> None:
    case = next(c for c in SUITE.cases if c.case_id == "CAL-M1-NEG-RANDOM")
    assert case.expected == 11
    # 12 output bits, each failing by chance with probability 2^-13.
    assert case.parameters["false_failure_probability"] == pytest.approx(12 * 2.0**-13)


def test_the_blindness_case_expects_the_same_null_as_a_saturated_round_function() -> None:
    case = next(c for c in SUITE.cases if c.case_id == "CAL-M1-BLIND-INVERSE")
    assert case.expected == 10
    assert "x*y = 1" in case.parameters["implicit_system"]


def test_every_ground_truth_case_is_pending_its_primary_source() -> None:
    ground_truth = [c for c in SUITE.cases if c.kind is CaseKind.PUBLISHED_GROUND_TRUTH]
    assert ground_truth
    assert all(c.expected is PENDING_PRIMARY_SOURCE for c in ground_truth)


def test_every_ground_truth_target_can_actually_be_constructed() -> None:
    """A calibration case that names a target it cannot build is a placeholder."""
    for case in SUITE.cases:
        target = case.target_factory()
        assert callable(target)
        assert target(0) is not None


def test_the_control_cases_carry_in_repo_provenance_not_a_citation() -> None:
    for case in SUITE.cases:
        if case.kind is CaseKind.PUBLISHED_GROUND_TRUTH:
            assert case.expectation_provenance.citation_key is not None
        else:
            assert case.expectation_provenance.computation_id is not None
            assert case.expectation_provenance.citation_key is None


# -- the gate ---------------------------------------------------------------


def test_the_module_is_blocked_and_names_exactly_what_blocks_it() -> None:
    status = SUITE.gate()
    assert status.blocked
    assert set(status.blocking_citations) == {"CITE-BCD11", "CITE-EGLORSW20"}
    assert any("transcribed from the primary source" in r for r in status.blocking_reasons)


def test_the_block_is_hard_not_a_warning() -> None:
    with pytest.raises(CalibrationBlocked, match="refuses to run"):
        SUITE.require_unblocked()
    with pytest.raises(CalibrationBlocked):
        SUITE.run(lambda target, case: 0)


def test_the_citation_gate_is_checked_before_the_measurement_gate() -> None:
    """Order matters: a blocked module must not report 'no implementation' as
    though that were the only thing standing in the way."""
    with pytest.raises(CalibrationBlocked):
        SUITE.run(None)


def test_a_suite_of_only_module_1_controls_would_reach_the_measurement_gate() -> None:
    """The same cases, with the two pending ground-truth citations satisfied,
    stop at NotAuthorised rather than at the citation gate."""
    from dataclasses import replace

    from harness.calibration import CalibrationSuite
    from tiers.provenance import CitationIndex

    verified = CitationIndex(
        citations=tuple(
            replace(c, verification=Verification.PRIMARY_SOURCE, verification_note="")
            for c in CITATIONS.citations
        )
    )
    cases = tuple(
        c if c.expected is not PENDING_PRIMARY_SOURCE else replace(c, expected=0)
        for c in SUITE.cases
    )
    unblocked = CalibrationSuite(module_id=SUITE.module_id, cases=cases, citations=verified)
    assert not unblocked.gate().blocked
    with pytest.raises(NotAuthorised, match="no measurement implementation"):
        unblocked.run(None)


def test_the_ceiling_citation_is_declared_and_unverified() -> None:
    shattered = CITATIONS.get("CITE-SHATTERED")
    assert shattered.verification is Verification.UNVERIFIED
    assert shattered.verification_note


def test_the_carlet_reference_blocks_nothing_because_nothing_depends_on_it() -> None:
    keys = {c.expectation_provenance.citation_key for c in SUITE.cases}
    assert "CITE-CARLET21" not in keys
    assert "CITE-CARLET21" not in SUITE.gate().blocking_citations


# -- the manifest -----------------------------------------------------------


def test_the_manifest_states_every_assertion_before_anything_runs() -> None:
    manifest = SUITE.manifest()
    assert manifest.count("assertion=") == len(SUITE.cases)
    assert manifest.count("rationale=") == len(SUITE.cases)
    for case in SUITE.cases:
        assert f"case={case.case_id}" in manifest
    assert "calibration_blocked=True" in manifest


def test_the_manifest_prints_full_references_for_every_citation() -> None:
    manifest = SUITE.manifest()
    for citation in CITATIONS.citations:
        assert f"[{citation.key}]" in manifest
        assert citation.title in manifest
        assert citation.locator in manifest


def test_the_manifest_contains_no_prose_conclusions() -> None:
    from reports.lint import lint_text

    assert lint_text(SUITE.manifest(), path="manifest") == []
