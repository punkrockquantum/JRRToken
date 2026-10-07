"""The committed exhaustive table, and the gate it deliberately does not open.

Two separate jobs here.

1. A committed constant is only traceable if it can be regenerated. The slow
   test below re-runs the whole exhaustion and asserts the committed file is
   byte-equal to a fresh emission, which is what stops
   ``exhaustive_truth.py`` drifting into a table of numbers somebody once
   believed (prime directive 2.1).

2. The exhaustive cases must not have widened any gate. An exhaustive ground
   truth is a value this repository computed; the published-anchor requirement
   asks whether this repository agrees with somebody else. The tests here assert
   the calibration gate is blocked by exactly the same citations, with exactly
   the same reasons, as it was before the exhaustive cases existed.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

from harness.calibration import (
    PENDING_PRIMARY_SOURCE,
    CalibrationCase,
    CalibrationSuite,
    CaseKind,
    Comparator,
)
from modules.degree.calibration import exhaustive_truth
from modules.degree.calibration.suite import SUITE
from tiers.errors import CalibrationBlocked
from tiers.provenance import Provenance

ROOT = Path(__file__).resolve().parents[1]
TABLE = ROOT / "modules" / "degree" / "calibration" / "exhaustive_truth.py"


def _load_runner():
    """Import scripts/exhaust.py in-process so its guards can be exercised.

    The guards below only fire when something is wrong, so testing them means
    making something wrong on purpose. Without these two tests the checks are
    unexamined code that happens never to trigger -- which is what mutants
    EXHT-03 and EXHT-05 demonstrated.
    """
    spec = importlib.util.spec_from_file_location("_exhaust_under_test", ROOT / "scripts" / "exhaust.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# -- 1. the committed table regenerates ------------------------------------


@pytest.mark.slow
def test_the_committed_table_is_byte_equal_to_a_fresh_exhaustion() -> None:
    """The whole point of committing a computed constant: it can be recomputed."""
    result = subprocess.run(
        [sys.executable, "scripts/exhaust.py", "--emit-module"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == TABLE.read_text(), (
        "the committed exhaustive table is not what a fresh run produces; "
        "regenerate it with scripts/exhaust.py --emit-module"
    )


def test_the_table_declares_the_space_it_exhausted() -> None:
    assert exhaustive_truth.KECCAK_WIDTH == 25
    assert exhaustive_truth.MIMC_N == 9
    assert len(exhaustive_truth.KECCAK_EXACT) >= 5
    assert len(exhaustive_truth.MIMC_EXACT) >= 6


def test_the_keccak_rows_stop_at_saturation_and_not_before() -> None:
    """A table that stopped early would understate the degree at later rounds."""
    rows = exhaustive_truth.KECCAK_EXACT
    last = rows[-1]
    assert int(last["exact_degree"]) == exhaustive_truth.KECCAK_WIDTH - 1, (
        "the last row must be the saturated one, or rounds are missing"
    )
    for row in rows[:-1]:
        assert int(row["exact_degree"]) < exhaustive_truth.KECCAK_WIDTH - 1


def test_the_recorded_bounds_are_sound_at_every_round() -> None:
    """The falsifiable claim: a certified upper bound is never below the truth."""
    for row in exhaustive_truth.KECCAK_EXACT:
        assert int(row["module_bound"]) >= int(row["exact_degree"]), row
        assert row["sound"] is True, row
    for row in exhaustive_truth.MIMC_EXACT:
        assert int(row["naive_bound"]) >= int(row["exact_degree"]), row
        assert int(row["derived_bound"]) >= int(row["exact_degree"]), row
        assert row["sound_naive"] is True and row["sound_derived"] is True, row


def test_the_derived_bound_is_never_looser_than_the_naive_one() -> None:
    """Stage A's claim, now checkable against exact truth rather than against
    the other bound alone."""
    for row in exhaustive_truth.MIMC_EXACT:
        assert int(row["derived_bound"]) <= int(row["naive_bound"]), row


def test_the_runner_refuses_when_its_evaluation_disagrees_with_the_permutation() -> None:
    """The cross-check is load-bearing: it is the only thing standing between
    'exhausted the target' and 'exhausted something else'. Break the evaluation
    and the runner must refuse rather than report a degree."""
    runner = _load_runner()
    runner.evaluate_at = lambda columns, x: 0xDEADBEEF
    with pytest.raises(AssertionError, match="not evaluating the target it claims to"):
        runner.keccak_rows(1)


def test_soundness_is_computed_from_the_bound_and_not_asserted() -> None:
    """A recorded `sound=True` must be a comparison that was made, not a
    constant. Hand the runner a deliberately unsound bound and the field must
    flip."""
    runner = _load_runner()
    from modules.degree.measure import BoundResult

    runner.keccak_bound = lambda target: BoundResult(
        value=0, derivation="deliberately unsound, for this test", capped_by_permutation=False
    )
    rows = runner.keccak_rows(1)
    assert len(rows) == 1
    assert rows[0]["sound"] is False, rows[0]
    assert int(rows[0]["gap"]) < 0, "an unsound bound has a negative gap"


def test_the_lookup_helpers_refuse_a_round_they_have_no_row_for() -> None:
    with pytest.raises(KeyError):
        exhaustive_truth.keccak_exact_degree(999)
    with pytest.raises(KeyError):
        exhaustive_truth.mimc_exact_degree(999)


# -- 2. the gate was not widened -------------------------------------------


def test_the_suite_still_blocks_on_exactly_the_two_citations() -> None:
    status = SUITE.gate()
    assert status.blocked is True
    assert status.blocking_citations == ("CITE-BCD11", "CITE-EGLORSW20")


def test_no_exhaustive_case_carries_a_citation() -> None:
    """An exhaustive value comes from a computation. If one ever carried a
    citation key it would be claiming a provenance it does not have."""
    for case in SUITE.cases:
        if case.kind is CaseKind.EXHAUSTIVE_GROUND_TRUTH:
            assert case.expectation_provenance.citation_key is None, case.case_id
            assert case.expectation_provenance.computation_id, case.case_id


def test_the_published_cases_are_still_pending() -> None:
    """Nothing computed here was written into a published-anchor case."""
    published = [c for c in SUITE.cases if c.kind is CaseKind.PUBLISHED_GROUND_TRUTH]
    assert len(published) == 6
    for case in published:
        assert case.expected is PENDING_PRIMARY_SOURCE, case.case_id


def test_the_exhaustive_cases_run_without_the_gate_being_lifted() -> None:
    """They execute under run_controls, and gate() is identical afterwards."""
    before = SUITE.gate()
    from modules.degree.measure import measure

    report = SUITE.run_controls(measure)
    exhaustive = [
        o
        for o in report.outcomes
        if o.case_id.startswith("CAL-M1-EXH-")
    ]
    assert len(exhaustive) == 15
    assert all(o.passed for o in exhaustive), [o.render() for o in report.failures]
    assert SUITE.gate() == before


def test_run_still_refuses_despite_the_exhaustive_cases_passing() -> None:
    from modules.degree.measure import measure

    with pytest.raises(CalibrationBlocked, match="CITE-BCD11"):
        SUITE.run(measure)


def test_an_exhaustive_case_does_not_satisfy_the_published_anchor_requirement() -> None:
    """The structural claim, asserted rather than trusted to the enum's docstring:
    a suite whose only ground truth is exhaustive must still refuse to be built
    without ``allow_missing_ground_truth``."""
    common = {
        "target_factory": lambda: (lambda x: x),
        "quantity": "algebraic_degree",
        "comparator": Comparator.EQUAL,
        "expected": 1,
        "expectation_provenance": Provenance(computation_id="TEST-001"),
        "assertion": "a",
        "rationale": "b",
    }
    cases = (
        CalibrationCase(
            case_id="EXH", kind=CaseKind.EXHAUSTIVE_GROUND_TRUTH, target_id="t", **common
        ),
        CalibrationCase(
            case_id="POS", kind=CaseKind.POSITIVE_CONTROL, target_id="t", **common
        ),
        CalibrationCase(
            case_id="NEG", kind=CaseKind.NEGATIVE_CONTROL, target_id="t", **common
        ),
    )
    with pytest.raises(CalibrationBlocked, match="published-ground-truth"):
        CalibrationSuite(module_id="test.exhaustive", cases=cases, citations=SUITE.citations)


def test_the_manifest_names_the_exhaustive_cases_and_their_computation() -> None:
    manifest = SUITE.manifest()
    assert "exhaustive-ground-truth" in manifest
    assert exhaustive_truth.COMPUTATION_ID_KECCAK in manifest
    assert exhaustive_truth.COMPUTATION_ID_MIMC in manifest
    assert "calibration_blocked=True" in manifest
