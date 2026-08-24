"""The calibration framework and the regime router, on a synthetic module.

Module 1's own suite is exercised separately; this file tests the machinery.
"""

from __future__ import annotations

import pytest

from harness.calibration import (
    PENDING_PRIMARY_SOURCE,
    CalibrationCase,
    CalibrationSuite,
    CaseKind,
    Comparator,
)
from harness.registry import ModuleSpec, Registry
from tiers.errors import CalibrationBlocked, NotAuthorised, ProbeError, RegimeViolation
from tiers.provenance import Citation, CitationIndex, Provenance, Verification
from tiers.tier import Regime, Tier

VERIFIED = Citation(
    key="CITE-OK",
    authors="A. Author",
    title="A Paper",
    venue="A Venue",
    year=2000,
    locator="doi:10.0/0",
    claim="the quantity is 7",
    verification=Verification.PRIMARY_SOURCE,
)

UNVERIFIED = Citation(
    key="CITE-PENDING",
    authors="B. Author",
    title="Another Paper",
    venue="Another Venue",
    year=2001,
    locator="doi:10.0/1",
    claim="the quantity is 9",
    verification=Verification.UNVERIFIED,
    verification_note="primary source not reachable from this environment",
)


def a_case(
    case_id: str,
    kind: CaseKind,
    expected: object,
    provenance: Provenance,
) -> CalibrationCase:
    return CalibrationCase(
        case_id=case_id,
        kind=kind,
        target_id="synthetic",
        target_factory=lambda: 7,
        quantity="q",
        comparator=Comparator.EQUAL,
        expected=expected,
        expectation_provenance=provenance,
        assertion=f"q equals {expected}",
        rationale="machinery test",
    )


def a_suite(*, ground_truth_verified: bool = True, pending: bool = False) -> CalibrationSuite:
    citation_key = "CITE-OK" if ground_truth_verified else "CITE-PENDING"
    return CalibrationSuite(
        module_id="modules.synthetic",
        cases=(
            a_case(
                "GT",
                CaseKind.PUBLISHED_GROUND_TRUTH,
                PENDING_PRIMARY_SOURCE if pending else 7,
                Provenance(citation_key=citation_key),
            ),
            a_case("POS", CaseKind.POSITIVE_CONTROL, 7, Provenance(computation_id="C-1")),
            a_case("NEG", CaseKind.NEGATIVE_CONTROL, 7, Provenance(computation_id="C-2")),
        ),
        citations=CitationIndex(citations=(VERIFIED, UNVERIFIED)),
    )


def correct_measure(target, case):  # noqa: ANN001 - test double
    return 7


def wrong_measure(target, case):  # noqa: ANN001 - test double
    return 8


# -- suite construction -----------------------------------------------------


def test_a_suite_without_a_positive_control_is_refused() -> None:
    with pytest.raises(CalibrationBlocked, match="positive-control"):
        CalibrationSuite(
            module_id="m",
            cases=(
                a_case("GT", CaseKind.PUBLISHED_GROUND_TRUTH, 7, Provenance(citation_key="CITE-OK")),
                a_case("NEG", CaseKind.NEGATIVE_CONTROL, 7, Provenance(computation_id="C")),
            ),
            citations=CitationIndex(citations=(VERIFIED,)),
        )


def test_a_suite_without_published_ground_truth_is_refused() -> None:
    with pytest.raises(CalibrationBlocked, match="published-ground-truth"):
        CalibrationSuite(
            module_id="m",
            cases=(
                a_case("POS", CaseKind.POSITIVE_CONTROL, 7, Provenance(computation_id="C")),
                a_case("NEG", CaseKind.NEGATIVE_CONTROL, 7, Provenance(computation_id="C")),
            ),
            citations=CitationIndex(citations=(VERIFIED,)),
        )


def test_an_unknown_citation_key_is_refused() -> None:
    with pytest.raises(Exception, match="Unknown citation key"):
        CalibrationSuite(
            module_id="m",
            cases=(
                a_case("GT", CaseKind.PUBLISHED_GROUND_TRUTH, 7, Provenance(citation_key="CITE-NOPE")),
                a_case("POS", CaseKind.POSITIVE_CONTROL, 7, Provenance(computation_id="C")),
                a_case("NEG", CaseKind.NEGATIVE_CONTROL, 7, Provenance(computation_id="C")),
            ),
            citations=CitationIndex(citations=(VERIFIED,)),
        )


def test_an_unverified_citation_note_is_mandatory() -> None:
    with pytest.raises(Exception, match="verification_note"):
        Citation(
            key="K",
            authors="A",
            title="T",
            venue="V",
            year=2000,
            locator="L",
            claim="C",
            verification=Verification.UNVERIFIED,
        )


# -- gate 1: citation verification -----------------------------------------


def test_a_verified_suite_is_not_blocked() -> None:
    status = a_suite().gate()
    assert not status.blocked
    assert status.blocking_citations == ()


def test_an_unverified_citation_blocks_the_module() -> None:
    suite = a_suite(ground_truth_verified=False)
    status = suite.gate()
    assert status.blocked
    assert status.blocking_citations == ("CITE-PENDING",)
    with pytest.raises(CalibrationBlocked, match="refuses to run"):
        suite.require_unblocked()


def test_a_pending_expected_value_blocks_the_module() -> None:
    suite = a_suite(pending=True)
    status = suite.gate()
    assert status.blocked
    assert any("transcribed from the primary source" in r for r in status.blocking_reasons)


# -- manifest ---------------------------------------------------------------


def test_the_manifest_states_every_assertion_without_running_anything() -> None:
    manifest = a_suite().manifest()
    assert "calibration_suite module=modules.synthetic n_cases=3" in manifest
    assert manifest.count("assertion=") == 3
    assert manifest.count("rationale=") == 3
    assert "citations:" in manifest
    assert "[CITE-OK]" in manifest
    assert "verification=primary-source" in manifest
    assert "calibration_blocked=False" in manifest


def test_the_manifest_shows_the_pending_marker() -> None:
    assert "PENDING_PRIMARY_SOURCE" in a_suite(pending=True).manifest()


# -- gate 2: execution ------------------------------------------------------


def test_running_without_a_measurement_implementation_raises() -> None:
    with pytest.raises(NotAuthorised, match="no measurement implementation"):
        a_suite().run(None)


def test_a_correct_measure_satisfies_the_suite() -> None:
    report = a_suite().run(correct_measure)
    assert report.satisfied
    assert report.failures == ()


def test_a_wrong_measure_fails_the_suite() -> None:
    report = a_suite().run(wrong_measure)
    assert not report.satisfied
    assert {o.case_id for o in report.failures} == {"GT", "POS", "NEG"}


def test_a_blocked_suite_refuses_to_run_even_with_a_measure() -> None:
    with pytest.raises(CalibrationBlocked):
        a_suite(ground_truth_verified=False).run(correct_measure)


def test_comparators() -> None:
    assert Comparator.AT_MOST.holds(3, 5)
    assert not Comparator.AT_MOST.holds(6, 5)
    assert Comparator.AT_LEAST.holds(6, 5)
    assert Comparator.IN_SET.holds(3, {1, 2, 3})


# -- the regime router ------------------------------------------------------


def a_spec(tiers: set[Tier]) -> ModuleSpec:
    return ModuleSpec(
        module_id="modules.synthetic",
        title="synthetic",
        declared_tiers=frozenset(tiers),
        prereg_path="does/not/matter.md",
        runner_path="harness/runner.py",
        suite=a_suite(),
    )


def test_the_router_returns_the_spec_for_a_legal_pairing() -> None:
    registry = Registry()
    registry.register(a_spec({Tier.P}))
    spec = registry.route("modules.synthetic", tier=Tier.P, regime=Regime.DEDUCTIVE)
    assert spec.module_id == "modules.synthetic"


def test_the_router_refuses_a_proof_under_the_probabilistic_regime() -> None:
    registry = Registry()
    registry.register(a_spec({Tier.P}))
    with pytest.raises(RegimeViolation, match="Repetition adds nothing"):
        registry.route("modules.synthetic", tier=Tier.P, regime=Regime.PROBABILISTIC)


def test_the_router_refuses_a_tier_the_module_did_not_declare() -> None:
    registry = Registry()
    registry.register(a_spec({Tier.P}))
    with pytest.raises(RegimeViolation, match="declared tiers"):
        registry.route("modules.synthetic", tier=Tier.S, regime=Regime.PROBABILISTIC)


def test_the_router_refuses_a_sample_under_the_deductive_regime() -> None:
    registry = Registry()
    registry.register(a_spec({Tier.S}))
    with pytest.raises(RegimeViolation, match="probabilistic regime"):
        registry.route("modules.synthetic", tier=Tier.S, regime=Regime.DEDUCTIVE)


def test_a_module_must_declare_at_least_one_tier() -> None:
    with pytest.raises(ProbeError, match="at least one tier"):
        a_spec(set())


def test_a_suite_belonging_to_another_module_is_refused() -> None:
    with pytest.raises(CalibrationBlocked, match="belongs to"):
        ModuleSpec(
            module_id="modules.other",
            title="other",
            declared_tiers=frozenset({Tier.P}),
            prereg_path="p.md",
            runner_path="harness/runner.py",
            suite=a_suite(),
        )


def test_an_unregistered_module_cannot_be_routed() -> None:
    with pytest.raises(ProbeError, match="no module registered"):
        Registry().route("modules.absent", tier=Tier.P, regime=Regime.DEDUCTIVE)
