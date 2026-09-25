"""Tests for the Poseidon widening driver.

None of these invoke a solver. That is the point of the preview and of reading
the grid out of the document: the parts of a sweep that can be got wrong -- the
grid, the coverage accounting, the exclusivity refusal -- are all checkable
without spending an hour of solver time to find out.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import sweep as W  # noqa: E402
from provenance import PreRegistration, load_prereg  # noqa: E402

PREREG = W.PREREG_PATH


def test_the_grid_comes_out_of_the_pre_registration() -> None:
    """Fourteen cells: two widths crossed with {2,4} full and {1,2,3} partial,
    plus the named leading-partial case in each width."""
    grid = W.shapes_from_prereg(load_prereg(PREREG))
    assert len(grid) == 14
    assert W.Shape(2, 2, 1) in grid
    assert W.Shape(3, 4, 3) in grid
    assert {s.width for s in grid} == {2, 3}


def test_the_leading_partial_case_is_in_the_grid_by_name() -> None:
    """poseidon_like splits full rounds as rounds_full // 2 first, so
    rounds_full=1 opens the ladder on a partial round. PREREG-002 names that
    case rather than letting it turn up as an accident of the grid, because it
    is the case the hardcoded d^r prediction got wrong."""
    grid = W.shapes_from_prereg(load_prereg(PREREG))
    leading = [s for s in grid if s.leading_partial]
    assert [s.label() for s in leading] == ["t2-f1-p2", "t3-f1-p2"]
    assert all(s.rounds_full == 1 for s in leading)


def test_a_document_the_parser_cannot_read_stops_the_sweep(tmp_path: Path) -> None:
    """Falling back to a default grid would run a sweep the pre-registration
    does not describe while naming it in the log."""
    doc = PreRegistration(
        path=tmp_path / "PREREG-bad.md",
        text="irrelevant",
        fields={"widths": "2 and 3", "shapes": "whatever the operator feels like"},
    )
    with pytest.raises(W.SweepRefused) as excinfo:
        W.shapes_from_prereg(doc)
    assert "does not state a crossed grid" in str(excinfo.value)


def test_a_document_naming_no_widths_stops_the_sweep(tmp_path: Path) -> None:
    doc = PreRegistration(
        path=tmp_path / "PREREG-bad.md",
        text="irrelevant",
        fields={"widths": "as many as seem interesting", "shapes": "x"},
    )
    with pytest.raises(W.SweepRefused) as excinfo:
        W.shapes_from_prereg(doc)
    assert "names no integers" in str(excinfo.value)


def test_the_preview_builds_nothing() -> None:
    """A real preview. The sibling project shipped one that constructed its
    runner and wrote a log, which made the flag worse than useless: it left a
    second, non-compliant record behind."""
    calls: list[object] = []
    original = W.run_ladder
    W.run_ladder = lambda *a, **k: calls.append(a)  # type: ignore[assignment]
    try:
        text = W.preview()
    finally:
        W.run_ladder = original  # type: ignore[assignment]
    assert not calls
    assert "14 cells" in text
    assert "t2-f1-p2" in text
    assert "leading_partial=True" in text


def test_a_running_solver_stops_the_sweep_before_it_starts(monkeypatch) -> None:
    """Wall-clock is the cost gate's observable, so a contended sweep produces
    numbers about the scheduler. Refused up front rather than annotated after."""
    monkeypatch.setattr(W, "contending_solvers", lambda: ("Singular",))
    with pytest.raises(W.SweepRefused) as excinfo:
        W.run_sweep(prime=101, budget_seconds=1.0)
    assert "another solver is already running" in str(excinfo.value)
    assert "Singular" in str(excinfo.value)


def test_an_only_filter_that_selects_nothing_is_refused(monkeypatch) -> None:
    monkeypatch.setattr(W, "contending_solvers", lambda: ())
    with pytest.raises(W.SweepRefused) as excinfo:
        W.run_sweep(prime=101, budget_seconds=1.0, only="t9-f9-p9")
    assert "selected none of the grid" in str(excinfo.value)


def test_a_spent_budget_records_the_cells_it_never_attempted(monkeypatch) -> None:
    """A sweep that quietly covers a third of its grid and reports on the third
    is how a negative result gets manufactured. Every unattempted cell is in
    the report, and the report says the grid is not covered."""
    monkeypatch.setattr(W, "contending_solvers", lambda: ())
    monkeypatch.setattr(W, "run_ladder", lambda *a, **k: _stub_ladder())
    report = W.run_sweep(prime=101, budget_seconds=0.0, max_rounds=1, timeout=1.0)
    assert len(report.cells) == 14
    assert not report.attempted
    assert len(report.unattempted) == 14
    assert all("budget" in c.reason for c in report.unattempted)
    rendered = report.render()
    assert "14 of 14 cells" in rendered
    assert "the grid is not covered" in rendered
    assert "NOT ATTEMPTED" in rendered


def test_a_covered_sweep_says_nothing_about_coverage(monkeypatch) -> None:
    monkeypatch.setattr(W, "contending_solvers", lambda: ())
    monkeypatch.setattr(W, "run_ladder", lambda *a, **k: _stub_ladder())
    report = W.run_sweep(
        prime=101, budget_seconds=600.0, only="t2-f2-p1", max_rounds=1, timeout=1.0
    )
    assert len(report.attempted) == 1
    assert not report.unattempted
    assert "COVERAGE" not in report.render()
    assert "no-deviation" in report.render()


def _stub_ladder():
    """A ladder object with no solver behind it.

    Used to test the sweep's accounting, never its measurements: every field
    here is fabricated, so no test in this file asserts anything about a
    degree, a wall or a second.
    """
    from ladder import Ladder, Rung

    rung = Rung(
        rounds=1, n_variables=2, n_equations=2, status="solved", seconds=0.01,
        peak_memory_mb=1.0, ideal_degree=3, max_degree=3, basis_size=2,
        matrix_cells=None, predicted_degree=3, rational_solutions=None,
        solvers_agree=True,
    )
    return Ladder(
        spec_render="spec=stub", spec_digest="stub", problem_render="stub",
        rungs=(rung,), validation_passed=True, roundtrip_passed=True,
        wall_at=None, planted=True, solver_versions=("stub/0",),
    )


def test_the_report_carries_the_budget_it_actually_ran_at(monkeypatch) -> None:
    """run_sweep's docstring said a departure from the document was recorded
    while nothing recorded it -- a claim the code did not keep, which is the
    failure this layer is built against."""
    monkeypatch.setattr(W, "contending_solvers", lambda: ())
    monkeypatch.setattr(W, "run_ladder", lambda *a, **k: _stub_ladder())
    report = W.run_sweep(
        prime=101, budget_seconds=600.0, only="t2-f2-p1", timeout=30.0, max_rounds=2
    )
    assert report.timeout_seconds == 30.0
    assert report.max_rounds == 2
    assert report.prereg_timeout_seconds == 900.0
    assert report.prereg_max_rounds == 10
    assert not report.as_pre_registered
    rendered = report.render()
    assert "DEPARTURE" in rendered
    assert "is not the pre-registered measurement" in rendered


def test_a_pre_registered_run_reports_no_departure(monkeypatch) -> None:
    monkeypatch.setattr(W, "contending_solvers", lambda: ())
    monkeypatch.setattr(W, "run_ladder", lambda *a, **k: _stub_ladder())
    report = W.run_sweep(prime=101, budget_seconds=600.0, only="t2-f2-p1")
    assert report.as_pre_registered
    assert report.timeout_seconds == 900.0
    assert report.max_rounds == 10
    assert "DEPARTURE" not in report.render()


def test_a_cell_that_raises_does_not_kill_the_sweep(monkeypatch) -> None:
    """The first width-3 cell raised in the round-trip test and the sweep died
    with seven cells measured, seven never attempted, and no report saying so.
    The coverage accounting is the sweep's whole purpose, so an unanticipated
    exception cannot be allowed to take it with it."""
    monkeypatch.setattr(W, "contending_solvers", lambda: ())
    seen: list[int] = []

    def flaky(spec, **kwargs):
        seen.append(spec.width)
        if spec.width == 3:
            raise RuntimeError("expected 1 free rate elements")
        return _stub_ladder()

    monkeypatch.setattr(W, "run_ladder", flaky)
    report = W.run_sweep(prime=101, budget_seconds=600.0, max_rounds=1, timeout=1.0)

    assert 3 in seen, "the width-3 cells must still have been attempted"
    assert len(report.attempted) == 7
    assert len(report.failures) == 7
    assert not report.unattempted
    rendered = report.render()
    assert "PIPELINE FAILURE" in rendered
    assert "defects in this code, not properties of the primitive" in rendered
    assert "expected 1 free rate elements" in rendered


def test_a_failed_cell_is_not_counted_as_unattempted(monkeypatch) -> None:
    """A cell nobody got to and a cell that broke the pipeline are different
    facts, and only one of them is a bug report."""
    monkeypatch.setattr(W, "contending_solvers", lambda: ())
    monkeypatch.setattr(
        W, "run_ladder", lambda *a, **k: (_ for _ in ()).throw(ValueError("boom"))
    )
    report = W.run_sweep(
        prime=101, budget_seconds=600.0, only="t2-f2-p1", max_rounds=1, timeout=1.0
    )
    assert len(report.failures) == 1
    assert not report.unattempted
    assert not report.attempted
    assert "COVERAGE" not in report.render()
