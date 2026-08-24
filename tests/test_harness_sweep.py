"""Resumable sweeps: the family is the planned family, and cells are write-once."""

from __future__ import annotations

from pathlib import Path

import pytest

from harness.sweep import Cell, SweepStore
from tiers.errors import ProbeError

PREREG = "PREREG-TEST"
CELLS = [f"r{r:02d}" for r in range(1, 5)]
SEEDS = list(range(30))


def a_store(tmp_path: Path) -> SweepStore:
    store = SweepStore(tmp_path / "sweep.sqlite")
    store.declare_plan(PREREG, cell_keys=CELLS, seeds=SEEDS, family_size=len(CELLS))
    return store


def test_plan_populates_every_cell_seed_pair(tmp_path: Path) -> None:
    with a_store(tmp_path) as store:
        assert len(store.pending(PREREG)) == len(CELLS) * len(SEEDS)
        assert store.plan(PREREG)["family_size"] == len(CELLS)


def test_family_size_must_match_the_declared_cells(tmp_path: Path) -> None:
    with SweepStore(tmp_path / "s.sqlite") as store:
        with pytest.raises(ProbeError, match="does not match"):
            store.declare_plan(PREREG, cell_keys=CELLS, seeds=SEEDS, family_size=99)


def test_redeclaring_a_different_plan_is_refused(tmp_path: Path) -> None:
    with a_store(tmp_path) as store:
        with pytest.raises(ProbeError, match="already declared"):
            store.declare_plan(PREREG, cell_keys=CELLS[:2], seeds=SEEDS, family_size=2)


def test_redeclaring_the_same_plan_is_a_no_op(tmp_path: Path) -> None:
    with a_store(tmp_path) as store:
        store.declare_plan(PREREG, cell_keys=CELLS, seeds=SEEDS, family_size=len(CELLS))
        assert len(store.pending(PREREG)) == len(CELLS) * len(SEEDS)


def test_completed_cells_drop_out_of_pending(tmp_path: Path) -> None:
    with a_store(tmp_path) as store:
        cell = Cell(cell_key="r01", seed=0)
        store.claim(PREREG, cell)
        store.complete(PREREG, cell, value=3.0)
        assert cell not in store.pending(PREREG)
        assert store.progress(PREREG)["done"] == 1


def test_a_sweep_resumes_where_it_stopped(tmp_path: Path) -> None:
    path = tmp_path / "sweep.sqlite"
    store = SweepStore(path)
    store.declare_plan(PREREG, cell_keys=CELLS, seeds=SEEDS, family_size=len(CELLS))
    for seed in SEEDS[:10]:
        store.complete(PREREG, Cell("r01", seed), value=float(seed))
    store.close()

    resumed = SweepStore(path)
    pending = resumed.pending(PREREG)
    assert len(pending) == len(CELLS) * len(SEEDS) - 10
    assert Cell("r01", 0) not in pending
    resumed.close()


def test_a_cell_cannot_be_overwritten(tmp_path: Path) -> None:
    with a_store(tmp_path) as store:
        cell = Cell("r01", 0)
        store.complete(PREREG, cell, value=1.0)
        with pytest.raises(ProbeError, match="append-only"):
            store.complete(PREREG, cell, value=2.0)


def test_censored_cells_are_retained_with_their_flag(tmp_path: Path) -> None:
    with a_store(tmp_path) as store:
        for seed in SEEDS:
            store.complete(PREREG, Cell("r02", seed), value=10.0, censored=seed % 3 == 0)
        seeds, values, censored = store.results(PREREG, "r02")
        assert seeds == SEEDS
        assert len(values) == len(SEEDS)
        assert sum(censored) == len([s for s in SEEDS if s % 3 == 0])


def test_completing_an_undeclared_cell_is_refused(tmp_path: Path) -> None:
    with a_store(tmp_path) as store:
        with pytest.raises(ProbeError, match="not part of the declared plan"):
            store.complete(PREREG, Cell("r99", 0), value=1.0)


def test_an_undeclared_plan_cannot_be_read(tmp_path: Path) -> None:
    with SweepStore(tmp_path / "s.sqlite") as store:
        with pytest.raises(ProbeError, match="no sweep plan"):
            store.plan("PREREG-ABSENT")


def test_duplicate_seeds_in_a_plan_are_refused(tmp_path: Path) -> None:
    with SweepStore(tmp_path / "s.sqlite") as store:
        with pytest.raises(ProbeError, match="seeds must be distinct"):
            store.declare_plan(PREREG, cell_keys=CELLS, seeds=[1, 1, 2], family_size=len(CELLS))
