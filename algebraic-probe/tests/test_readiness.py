"""The go/no-go decision is computed from gates, and the computation is tested.

A decision nobody can re-derive is an opinion with a number next to it.
"""

from __future__ import annotations

import pytest

from harness.readiness import BlockClass, Decision, Gate, ReadinessReport, evaluate
from scripts.readiness_report import INVENTORY, build_report


def a_gate(gate_id: str, passed: bool, *, blocking: bool = True) -> Gate:
    return Gate(
        gate_id=gate_id,
        name=f"gate-{gate_id}",
        requirement="test",
        block_class=BlockClass.BUILD,
        check=lambda: (passed, "detail"),
        blocking=blocking,
    )


def a_module(*gates: Gate):
    return evaluate(
        module_id="MX",
        title="t",
        quantity="q",
        declared_tiers="P",
        depends_on=(),
        gates=gates,
    )


# -- the decision rule ------------------------------------------------------


def test_go_requires_every_blocking_gate() -> None:
    assert a_module(a_gate("A", True), a_gate("B", True)).decision is Decision.GO


def test_one_failing_blocking_gate_yields_no_go() -> None:
    module = a_module(a_gate("A", True), a_gate("B", False))
    assert module.decision is Decision.NO_GO
    assert module.shortest_path_to_go == ("B:gate-B",)


def test_there_is_no_partial_credit() -> None:
    """Twelve of thirteen is NO-GO, the same as zero of thirteen."""
    mostly = a_module(*[a_gate(str(i), True) for i in range(12)], a_gate("last", False))
    none = a_module(*[a_gate(str(i), False) for i in range(13)])
    assert mostly.decision is none.decision is Decision.NO_GO
    assert mostly.n_passed == 12


def test_a_failing_non_blocking_gate_does_not_change_the_decision() -> None:
    module = a_module(a_gate("A", True), a_gate("B", False, blocking=False))
    assert module.decision is Decision.GO
    assert module.blocking_failures == ()


def test_a_check_that_raises_counts_as_failed() -> None:
    def explode() -> tuple[bool, str]:
        raise RuntimeError("boom")

    gate = Gate("X", "explodes", "test", BlockClass.BUILD, explode)
    outcome = gate.evaluate()
    assert outcome.passed is False
    assert "RuntimeError" in outcome.detail


def test_a_passing_gate_carries_no_block_class() -> None:
    assert a_gate("A", True).evaluate().block_class is BlockClass.NONE
    assert a_gate("A", False).evaluate().block_class is BlockClass.BUILD


# -- aggregation ------------------------------------------------------------


def test_root_causes_are_ordered_by_modules_blocked() -> None:
    shared = evaluate("M1", "t", "q", "P", (), (a_gate("A", False), a_gate("B", False)))
    single = evaluate("M2", "t", "q", "P", (), (a_gate("A", False), a_gate("B", True)))
    report = ReadinessReport(commit="c", modules=(shared, single))
    causes = report.root_causes()
    assert causes[0] == ("A:gate-A", 2)
    assert ("B:gate-B", 1) in causes


def test_the_report_separates_go_from_no_go() -> None:
    good = evaluate("M1", "t", "q", "P", (), (a_gate("A", True),))
    bad = evaluate("M2", "t", "q", "P", (), (a_gate("A", False),))
    report = ReadinessReport(commit="c", modules=(good, bad))
    assert report.go == ("M1",)
    assert report.no_go == ("M2",)


# -- the real inventory -----------------------------------------------------


def test_the_inventory_is_the_six_modules_of_the_brief() -> None:
    assert [s.module_id for s in INVENTORY] == ["M1", "M2", "M3", "M4", "M5", "M6"]


def test_module_4_declares_its_dependency_on_module_1() -> None:
    m4 = next(s for s in INVENTORY if s.module_id == "M4")
    assert m4.depends_on == ("M1",)


@pytest.mark.slow
def test_the_live_report_is_reproducible_and_every_module_is_no_go() -> None:
    first = build_report()
    second = build_report()
    assert first.render() == second.render()
    assert first.go == ()
    assert len(first.no_go) == 6


@pytest.mark.slow
def test_module_1_blocks_on_exactly_three_gates() -> None:
    report = build_report()
    m1 = next(m for m in report.modules if m.module_id == "M1")
    assert m1.n_passed == 10
    assert [o.gate_id for o in m1.blocking_failures] == ["G01", "G07", "G11"]
    assert set(m1.block_classes) == {"operator", "build"}


@pytest.mark.slow
def test_the_missing_primary_target_blocks_every_module() -> None:
    report = build_report()
    top_cause, count = report.root_causes()[0]
    assert count == 6
    assert top_cause in ("G01:primary-target-present", "G11:measurement-registered")


@pytest.mark.slow
def test_the_readiness_report_carries_no_prose_conclusions() -> None:
    from reports.lint import lint_text

    assert lint_text(build_report().render(), path="readiness") == []
