"""The four-criterion promotion gate of section 7."""

from __future__ import annotations

import pytest

from harness.promotion import (
    CostComparison,
    CostRow,
    Direction,
    FalsificationCheck,
    PromotionDecision,
    ThresholdCheck,
    VerificationCheck,
)
from tiers import Provenance, prove
from tiers.errors import ProbeError

PROV = Provenance(computation_id="TEST-PROMO")


def a_result(value: float = 40.0):
    return prove(
        metric="k_HO",
        value=value,
        target="sha256-compression-parametrised r=20",
        provenance=PROV,
        derivation="d_ub(20) = 39 by the composition bound; k_HO = d_ub + 1",
    )


def a_threshold(value: float = 40.0) -> ThresholdCheck:
    return ThresholdCheck(
        metric="k_HO",
        value=value,
        threshold=63.1,
        direction=Direction.LESS_IS_BETTER,
        derivation="largest published practical hash computation, CITE-SHATTERED",
    )


def a_verification(agree: bool = True) -> VerificationCheck:
    return VerificationCheck(
        verifier_id="verify.anf.algebraic_degree",
        discovering_module="modules.degree",
        observed_by_module="39",
        observed_by_verifier="39" if agree else "41",
        shares_no_code_assertion="scripts/ci_checks.py::check_verify_does_not_import_modules",
    )


def a_cost(candidate_log2_ops: float = 40.0) -> CostComparison:
    return CostComparison(
        candidate=CostRow(
            approach="order-40 higher-order differential",
            operations=2.0**candidate_log2_ops,
            memory_bytes=1.0,
            memory_accesses=1.0,
            unit="compression-function-evaluations",
        ),
        baselines=(
            CostRow(
                approach="generic zero-sum search",
                operations=2.0**296,
                memory_bytes=1.0,
                memory_accesses=1.0,
                unit="compression-function-evaluations",
            ),
            CostRow(
                approach="brute force",
                operations=2.0**296,
                memory_bytes=1.0,
                memory_accesses=1.0,
                unit="compression-function-evaluations",
            ),
        ),
        access_cost_in_ops=1.0,
        access_cost_derivation="measured on the run host by scripts/measure_memory_cost.py",
    )


def a_falsification(survived: bool = True) -> FalsificationCheck:
    return FalsificationCheck(
        test_id="tests/test_module_degree.py::test_bound_is_not_an_indexing_artefact",
        artefact_hypotheses=(
            "the transform has an orientation defect",
            "the declared free-variable set overstates the degrees of freedom",
        ),
        ran=True,
        survived=survived,
        observed="positive control returns degree 1; intermediate control returns wt(d)",
    )


def a_decision(**overrides) -> PromotionDecision:
    kwargs = dict(
        candidate_id="M1-CAND-001",
        result=a_result(),
        threshold=a_threshold(),
        verification=a_verification(),
        cost=a_cost(),
        falsification=a_falsification(),
        scope_statement=(
            "bounds the algebraic degree over GF(2) of the 256 output bits in the 512 "
            "message bits at 20 rounds; bounds nothing at other round counts"
        ),
        commit="0" * 40,
    )
    kwargs.update(overrides)
    return PromotionDecision(**kwargs)


def test_all_four_criteria_promote() -> None:
    decision = a_decision()
    assert decision.promoted
    assert decision.failed_criteria == ()


def test_failing_the_threshold_blocks_promotion() -> None:
    decision = a_decision(threshold=a_threshold(value=100.0), result=a_result(100.0))
    assert not decision.promoted
    assert decision.failed_criteria == ("threshold",)


def test_a_disagreeing_verifier_blocks_promotion() -> None:
    decision = a_decision(verification=a_verification(agree=False))
    assert not decision.promoted
    assert "independent_verification" in decision.failed_criteria


def test_losing_on_cost_blocks_promotion() -> None:
    decision = a_decision(cost=a_cost(candidate_log2_ops=300.0))
    assert not decision.promoted
    assert "cost_comparison" in decision.failed_criteria


def test_a_failed_falsification_test_blocks_promotion() -> None:
    decision = a_decision(falsification=a_falsification(survived=False))
    assert not decision.promoted
    assert "falsification" in decision.failed_criteria


def test_a_verifier_inside_the_module_is_refused() -> None:
    with pytest.raises(ProbeError, match="must live in verify/"):
        VerificationCheck(
            verifier_id="modules.degree.selfcheck",
            discovering_module="modules.degree",
            observed_by_module="39",
            observed_by_verifier="39",
            shares_no_code_assertion="none",
        )


def test_a_threshold_without_a_derivation_is_refused() -> None:
    with pytest.raises(ProbeError, match="felt right"):
        ThresholdCheck(
            metric="k_HO",
            value=1.0,
            threshold=2.0,
            direction=Direction.LESS_IS_BETTER,
            derivation="",
        )


def test_brute_force_must_be_among_the_baselines() -> None:
    with pytest.raises(ProbeError, match="brute force"):
        CostComparison(
            candidate=CostRow("c", 2.0**10, 1.0, 1.0, "u"),
            baselines=(CostRow("generic zero-sum search", 2.0**20, 1.0, 1.0, "u"),),
            access_cost_in_ops=1.0,
            access_cost_derivation="measured",
        )


def test_cost_rows_must_share_a_unit() -> None:
    with pytest.raises(ProbeError, match="one unit"):
        CostComparison(
            candidate=CostRow("c", 2.0**10, 1.0, 1.0, "compressions"),
            baselines=(CostRow("brute force", 2.0**20, 1.0, 1.0, "cycles"),),
            access_cost_in_ops=1.0,
            access_cost_derivation="measured",
        )


def test_memory_access_cost_can_reverse_the_verdict() -> None:
    """A candidate that wins on operation count and loses on memory access."""
    memory_heavy = CostComparison(
        candidate=CostRow("table-based", operations=2.0**40, memory_bytes=2.0**40, memory_accesses=2.0**40, unit="u"),
        baselines=(
            CostRow("brute force", operations=2.0**50, memory_bytes=1.0, memory_accesses=1.0, unit="u"),
        ),
        access_cost_in_ops=2.0**12,
        access_cost_derivation="measured on the run host",
    )
    assert memory_heavy.candidate.operations < memory_heavy.baselines[0].operations
    assert memory_heavy.advantage_log2 < 0
    assert not memory_heavy.passed


def test_a_falsification_test_must_name_its_artefact_hypotheses() -> None:
    with pytest.raises(ProbeError, match="artefact hypotheses"):
        FalsificationCheck(
            test_id="t", artefact_hypotheses=(), ran=True, survived=True, observed="o"
        )


def test_a_promoted_candidate_must_carry_scope_and_commit() -> None:
    with pytest.raises(ProbeError, match="scope statement"):
        a_decision(scope_statement="  ")
    with pytest.raises(ProbeError, match="commit id"):
        a_decision(commit="")


def test_the_rendered_report_carries_every_required_field() -> None:
    rendered = a_decision().render()
    for field in (
        "candidate=",
        "promoted=",
        "tier=P",
        "criterion=threshold",
        "criterion=independent_verification",
        "criterion=cost_comparison",
        "criterion=falsification",
        "scope=",
        "commit=",
        "approach=brute force",
    ):
        assert field in rendered
