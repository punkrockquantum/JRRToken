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
def test_the_live_report_is_reproducible() -> None:
    first = build_report()
    second = build_report()
    assert first.render() == second.render()


@pytest.mark.slow
def test_module_1_clears_every_module_level_gate() -> None:
    report = build_report()
    m1 = next(m for m in report.modules if m.module_id == "M1")
    assert m1.blocking_failures == ()
    assert m1.n_passed == len(m1.outcomes)


@pytest.mark.slow
def test_module_1_is_partial_because_some_targets_are_blocked() -> None:
    """The point of per-target evaluation: a validated target is not held
    hostage by an unrelated absent one."""
    report = build_report()
    m1 = next(m for m in report.modules if m.module_id == "M1")
    assert m1.decision is Decision.PARTIAL
    blocked = {t.target_id: [o.gate_id for o in t.blocking_failures] for t in m1.targets
               if t.decision is Decision.NO_GO}
    assert set(blocked) == {
        "sha256-compression-parametrised",
        "keccak-f[25]",
        "mimc-gf2n[9]",
    }
    assert blocked["keccak-f[25]"] == ["T02"]
    assert blocked["mimc-gf2n[9]"] == ["T02"]
    assert "T01" in blocked["sha256-compression-parametrised"]
    assert len(m1.targets_go) == 4


@pytest.mark.slow
def test_the_authorised_runs_are_exactly_the_clear_targets() -> None:
    report = build_report()
    assert set(report.authorised_runs) == {
        ("M1", "linear-map-gf2"),
        ("M1", "power-map-gf2n"),
        ("M1", "inverse-map-gf2n"),
        ("M1", "random-function-sha256-prf"),
    }


@pytest.mark.slow
def test_modules_without_a_package_remain_no_go() -> None:
    report = build_report()
    assert set(report.no_go) == {"M2", "M3", "M4", "M5", "M6"}


@pytest.mark.slow
def test_the_readiness_report_carries_no_prose_conclusions() -> None:
    from reports.lint import lint_text

    assert lint_text(build_report().render(), path="readiness") == []
