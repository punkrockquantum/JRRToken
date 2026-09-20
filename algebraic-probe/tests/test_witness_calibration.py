"""The witness probe against exactly-known degrees.

The load-bearing test here is the soundness one. A degree of exactly d means
every derivative of order d+1 vanishes identically, so a probe that ever
witnesses above d contradicts a theorem rather than drawing badly. That check
had no ground truth to run against until the exhaustive arm produced one.

The rate tests are deliberately weaker in kind: they assert the shape of what
was measured and that it is reported with an interval, not that it takes any
particular value. A test that pinned a measured rate to a constant would be
asserting a result rather than checking one.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

from modules.degree.calibration import witness_truth
from modules.degree.calibration.exhaustive_truth import KECCAK_EXACT

ROOT = Path(__file__).resolve().parents[1]
TABLE = ROOT / "modules" / "degree" / "calibration" / "witness_truth.py"


def _cells():
    return [cell for entry in witness_truth.WITNESS_CELLS for cell in entry["cells"]]


# -- the deductive arm ------------------------------------------------------


def test_the_probe_never_witnesses_above_the_exact_degree() -> None:
    """Tier P. Falsifiable, and the reason this file exists."""
    assert witness_truth.soundness_violations() == []
    above = [c for c in _cells() if not c["witness_possible"]]
    assert above, "a run with no cells above the exact degree tests nothing"
    for cell in above:
        assert cell["witnessed"] == 0, cell
        assert cell["rate"] == 0.0, cell


def test_the_deductive_arm_covers_every_target_that_was_measured() -> None:
    """Each measured target must contribute at least one cell above its degree;
    otherwise the soundness claim is vacuous for that target."""
    for entry in witness_truth.WITNESS_CELLS:
        if not entry["cells"]:
            continue  # skipped on cost, reported as such
        above = [c for c in entry["cells"] if not c["witness_possible"]]
        assert above, entry["target"]


def test_witness_possible_is_derived_from_the_exact_degree() -> None:
    for entry in witness_truth.WITNESS_CELLS:
        for cell in entry["cells"]:
            assert cell["witness_possible"] == (cell["k"] <= entry["exact_degree"]), cell


def test_the_keccak_degrees_used_here_are_the_exhaustive_ones() -> None:
    """The two tables must agree, or the soundness claim rests on a stale number."""
    exhaustive = {int(r["rounds"]): int(r["exact_degree"]) for r in KECCAK_EXACT}
    for entry in witness_truth.WITNESS_CELLS:
        target = str(entry["target"])
        if not target.startswith("keccak-f[25] rounds="):
            continue
        rounds = int(target.rsplit("=", 1)[1])
        assert entry["exact_degree"] == exhaustive[rounds], target


# -- the sampled arm --------------------------------------------------------


def test_every_rate_carries_an_interval_and_never_stands_alone() -> None:
    """Section 3: never a single point."""
    for cell in _cells():
        assert cell["ci_low"] <= cell["rate"] <= cell["ci_high"], cell
        assert cell["seeds"] == witness_truth.SEEDS_PER_CELL


def test_the_seed_count_meets_the_pre_registered_minimum() -> None:
    from tiers.distribution import MIN_SEEDS, PREFERRED_SEEDS

    assert witness_truth.SEEDS_PER_CELL >= MIN_SEEDS
    assert witness_truth.SEEDS_PER_CELL == PREFERRED_SEEDS == 50


def test_the_rate_is_consistent_with_the_recorded_count() -> None:
    for cell in _cells():
        assert cell["rate"] == pytest.approx(cell["witnessed"] / cell["seeds"], abs=1e-9)


def test_skipped_cells_state_their_cost_rather_than_disappearing() -> None:
    skipped = [s for entry in witness_truth.WITNESS_CELLS for s in entry["skipped"]]
    assert skipped, "the guard should be exercised by at least one target"
    for skip in skipped:
        assert skip["cost_evaluations_per_seed"] == 2 ** skip["k"]
        assert skip["k"] > witness_truth.MAX_PROBE_DIM


def test_the_cost_guard_records_what_it_skips_rather_than_dropping_it() -> None:
    """The property above, asserted of the code rather than of committed data.

    Reading the table only shows that some past run recorded a skip; it says
    nothing about whether the guard still records one. Mutant WTNS-05 removed the
    recording and the table-reading test stayed green.
    """
    runner = _load_runner()
    from core.targets import PowerMap

    target = PowerMap.create(11, 31)  # exact degree wt(31) = 5
    runner.MAX_PROBE_DIM = 2
    entry = runner._cells_for("power-map-gf2n n=11 d=31", target, 11, 5)

    assert [c["k"] for c in entry["cells"]] == [1, 2], "cells within the guard must still run"
    skipped = entry["skipped"]
    # The sweep runs to exact + 2 = 7, so everything from 3 upward is over the guard.
    assert [s["k"] for s in skipped] == [3, 4, 5, 6, 7], "every cell over the guard must be recorded"
    for skip in skipped:
        assert skip["cost_evaluations_per_seed"] == 2 ** skip["k"]


def test_every_probe_dimension_is_either_measured_or_recorded_as_skipped() -> None:
    """No dimension may fall between the two: a silent gap is what the guard is
    meant to make impossible."""
    runner = _load_runner()
    from core.targets import PowerMap

    target = PowerMap.create(11, 31)
    for guard in (1, 3, 5, 20):
        runner.MAX_PROBE_DIM = guard
        entry = runner._cells_for("t", target, 11, 5)
        seen = sorted([c["k"] for c in entry["cells"]] + [s["k"] for s in entry["skipped"]])
        assert seen == [1, 2, 3, 4, 5, 6, 7], (guard, seen)


# -- regeneration -----------------------------------------------------------


@pytest.mark.slow
def test_the_committed_table_is_byte_equal_to_a_fresh_run() -> None:
    result = subprocess.run(
        [sys.executable, "scripts/witness_calibration.py", "--emit-module"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == TABLE.read_text(), (
        "the committed witness table is not what a fresh run produces; regenerate "
        "with scripts/witness_calibration.py --emit-module"
    )


def _load_runner():
    spec = importlib.util.spec_from_file_location(
        "_witness_under_test", ROOT / "scripts" / "witness_calibration.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_a_probe_that_witnessed_above_the_degree_would_be_recorded_as_a_violation() -> None:
    """The guard tested by breaking it: the soundness flag must be computed, not
    a constant that happens to be False on clean data."""
    runner = _load_runner()
    from core.targets import PowerMap

    target = PowerMap.create(9, 3)  # exact degree 2
    honest = runner.measure_cell(target, 3, 9, exact=2)
    assert honest["soundness_violated"] is False

    # Same cell, but claim the exact degree is 1. The probe does witness at
    # k = 2 <= 3, so a flag derived from the comparison must now fire.
    rigged = runner.measure_cell(target, 2, 9, exact=1)
    assert rigged["witness_possible"] is False
    assert rigged["witnessed"] > 0, "expected the probe to witness at k=2 for a degree-2 map"
    assert rigged["soundness_violated"] is True


def test_the_runner_exits_non_zero_when_soundness_is_violated() -> None:
    """A violation must fail the command, not merely be printed among the rows."""
    runner = _load_runner()
    runner.collect = lambda: [
        {
            "target": "rigged",
            "n": 9,
            "exact_degree": 1,
            "cells": [
                {
                    "k": 2,
                    "exact_degree": 1,
                    "witness_possible": False,
                    "witnessed": 7,
                    "seeds": 50,
                    "rate": 0.14,
                    "ci_low": 0.0,
                    "ci_high": 1.0,
                    "worst_case_p": 0.25,
                    "soundness_violated": True,
                }
            ],
            "skipped": [],
        }
    ]
    assert runner.main([]) == 1
