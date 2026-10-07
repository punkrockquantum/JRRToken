"""Module 3's blindness class, run rather than asserted.

Section 6(c). The threshold is one-sided -- it asks whether a probability exceeds
the random level -- and an impossible differential lies on the other side. Both
measures are injected here so ``modules/`` and ``verify/`` stay independent.
"""

from __future__ import annotations

import pytest

from modules.differential.blindness import impossible as blind
from verify.differential import differential_uniformity, impossible_fraction


def _uniformity(target, n):
    return differential_uniformity(target, n)


def _impossible(target, n):
    return impossible_fraction(target, n, n)


#: n=11 costs 2^22 evaluations, about 43 seconds per call, so it sits above the
#: default sweep budget and the guard refuses it. The n=11 confirmation of the
#: exactly-one-half claim is evidence worth keeping, so it is kept and the budget
#: is raised *here*, at the call site, which is what naming ``budget_bits``
#: explicitly is for.
WIDE_BUDGET_BITS = 22


@pytest.mark.parametrize("n", [7, 9])
def test_the_class_returns_the_null_while_half_its_table_is_impossible(n: int) -> None:
    outcome = blind.check(
        _uniformity,
        _impossible,
        n=n,
        test_id="tests/test_blindness_impossible.py",
        computation_id="M3-BLIND-001",
    )
    assert outcome.passed, outcome.observed
    assert "barely_above_random=True" in outcome.observed
    assert "structure_present=True" in outcome.observed


@pytest.mark.parametrize("n", [7, 9])
def test_the_impossible_fraction_is_exactly_one_half(n: int) -> None:
    """Not approximately: the derivative of a quadratic power map is two-to-one
    onto half the space, so the other half is empty exactly."""
    assert _impossible(blind.counterexample(n), n) == 0.5


@pytest.mark.slow
def test_the_impossible_fraction_is_still_exactly_one_half_at_eleven() -> None:
    """The widest measured confirmation, kept and paid for explicitly.

    ``EXPECTED_IMPOSSIBLE_FRACTION`` is documented as measured at n = 7, 9 and
    11, so dropping 11 when the sweep guard arrived would have quietly narrowed
    the evidence behind a claim the README and the blindness statement both make.
    Instead the budget is raised at this call site and the test is marked slow.
    """
    target = blind.counterexample(11)
    assert impossible_fraction(target, 11, 11, budget_bits=WIDE_BUDGET_BITS) == 0.5


def test_a_sweep_above_the_budget_is_refused_rather_than_run() -> None:
    """The guard exists because the cost has two exponents and the old one
    bounded a single variable count: at n=18 a sweep is 2^36 evaluations, which
    passes a guard of `MAX_DDT_VARS = 18` and never finishes."""
    from verify.differential import DDTRefused, MAX_ROW_SWEEP_BITS

    assert MAX_ROW_SWEEP_BITS == 18
    target = blind.counterexample(11)
    with pytest.raises(DDTRefused, match=r"costs 2\^22.*budget of 2\^18"):
        impossible_fraction(target, 11, 11)
    with pytest.raises(DDTRefused, match=r"costs 2\^22.*budget of 2\^18"):
        differential_uniformity(target, 11)


@pytest.mark.parametrize("n", [7, 9])
def test_the_best_differential_is_exactly_one_bit_above_random(n: int) -> None:
    assert _uniformity(blind.counterexample(n), n) == 2


def test_the_predicates_can_both_fail() -> None:
    assert blind.null_predicate(2, 9) is True
    assert blind.null_predicate(4, 9) is False, "a uniformity of 4 is two bits up"
    assert blind.structure_predicate(0.5) is True
    assert blind.structure_predicate(0.0) is False


def test_a_measure_that_saw_the_impossibility_would_falsify_the_class() -> None:
    outcome = blind.check(
        lambda t, n: 64,  # a measure reporting a strong differential
        _impossible,
        n=7,
        test_id="falsifier",
        computation_id="M3-BLIND-001",
    )
    assert outcome.passed is False
    assert "barely_above_random=False" in outcome.observed


def test_a_counterexample_with_no_impossible_structure_would_be_vacuous() -> None:
    outcome = blind.check(
        _uniformity,
        lambda t, n: 0.0,
        n=7,
        test_id="vacuous",
        computation_id="M3-BLIND-001",
    )
    assert outcome.passed is False
    assert "structure_present=False" in outcome.observed


def test_the_class_refuses_an_even_field_where_the_map_is_not_apn() -> None:
    with pytest.raises(ValueError, match="not a permutation"):
        blind.counterexample(8)


def test_the_gate_wiring_runs_this_class() -> None:
    import importlib.util
    import sys
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    name = "_readiness_m3"
    spec = importlib.util.spec_from_file_location(
        name, root / "scripts" / "readiness_report.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    outcome = module._blindness_runners()["modules.differential"]()
    assert outcome.passed, outcome.observed
