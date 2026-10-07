"""Module 2's blindness class, run rather than asserted.

Section 6(c). Reachability is an upper bound on influence and cannot see that two
contributions to the same output bit cancel, so it reports complete diffusion for
a function with identically-zero outputs. Both measures are injected here, so
``modules/`` and ``verify/`` stay independent.
"""

from __future__ import annotations

import pytest

from core.targets import CancellingXor
from modules.reach.blindness import cancellation as blind
from verify.dependence import constant_output_bits

N = 10
SEED = 7
SHARED = (2, 5)


def _reach(target) -> int:
    union = 0
    for rows in (target.rows_a, target.rows_b):
        for row in rows:
            union |= row
    return (union & ((1 << target.n_in) - 1)).bit_count()


def _constant(target) -> tuple[int, ...]:
    return constant_output_bits(target, target.n_in, target.n_out)


def test_the_class_returns_the_null_while_carrying_constant_outputs() -> None:
    outcome = blind.check(
        _reach,
        _constant,
        n=N,
        seed=SEED,
        shared_rows=SHARED,
        test_id="tests/test_blindness_cancellation.py",
        computation_id="M2-BLIND-001",
    )
    assert outcome.passed, outcome.observed
    assert "reports_complete=True" in outcome.observed
    assert "structure_present=True" in outcome.observed


def test_the_gate_s_wiring_runs_this_class_and_it_passes() -> None:
    """Gate G09's entry for this module. The wiring lives in the gate rather
    than in modules/, because it needs verify/ and modules/ may not import it."""
    import importlib.util
    import sys
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    name = "_readiness_under_test"
    spec = importlib.util.spec_from_file_location(
        name, root / "scripts" / "readiness_report.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)

    outcome = module._blindness_runners()["modules.reach"]()
    assert outcome.passed, outcome.observed
    assert outcome.computation_id == "READINESS-BLIND-M2-001"


def test_reachability_is_complete_while_two_output_bits_are_constant() -> None:
    target = CancellingXor.create(N, SEED, SHARED)
    assert _reach(target) == N, "every input bit is reachable"
    assert _constant(target) == SHARED, "and two output bits depend on nothing"


def test_the_predicates_can_both_fail() -> None:
    assert blind.null_predicate(N, N) is True
    assert blind.null_predicate(N - 1, N) is False
    assert blind.structure_predicate((2,)) is True
    assert blind.structure_predicate(()) is False


def test_a_measure_that_saw_the_cancellation_would_falsify_the_class() -> None:
    """What refuting it looks like: a measure tracking dependence, not reach."""
    outcome = blind.check(
        lambda target: N - len(SHARED),  # a measure that excludes the dead rows
        _constant,
        n=N,
        seed=SEED,
        shared_rows=SHARED,
        test_id="falsifier",
        computation_id="M2-BLIND-001",
    )
    assert outcome.passed is False
    assert "reports_complete=False" in outcome.observed


def test_a_counterexample_with_no_cancellation_would_be_vacuous() -> None:
    outcome = blind.check(
        _reach,
        lambda target: (),  # nothing constant
        n=N,
        seed=SEED,
        shared_rows=SHARED,
        test_id="vacuous",
        computation_id="M2-BLIND-001",
    )
    assert outcome.passed is False
    assert "structure_present=False" in outcome.observed


def test_the_construction_refuses_an_out_of_range_shared_row() -> None:
    with pytest.raises(ValueError, match="out of range"):
        CancellingXor.create(8, 1, (8,))
    with pytest.raises(ValueError, match="n must be positive"):
        CancellingXor.create(0, 1, ())
