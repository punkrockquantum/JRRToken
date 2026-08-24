"""Stage A: the MiMC divergence, the derived bound, and the saturation blindness.

The load-bearing assertions are soundness (no bound below the truth) and that the
derived bound is a strict improvement rather than a relabelling.
"""

from __future__ import annotations

import pytest

from core.mimc import MiMC
from modules.degree.blindness import saturated_power as sp
from modules.degree.measure import (
    MAX_EXACT_VARS,
    MeasurementRefused,
    degree_upper_bound,
    exact_degree,
    max_weight_up_to,
    measure,
    mimc_derived_bound,
)
from verify.anf import algebraic_degree

FIELDS = (9, 11, 13)
ROUNDS = range(1, 8)


def _mimc(n: int, r: int) -> MiMC:
    return MiMC.create(n=n, n_rounds=r, seed=0)


# -- A1: the naive path is sound, not defective -----------------------------


@pytest.mark.parametrize("n", FIELDS)
def test_the_naive_bound_never_falls_below_the_exact_degree(n: int) -> None:
    for r in ROUNDS:
        target = _mimc(n, r)
        assert degree_upper_bound(target).value >= exact_degree(target), (n, r)


@pytest.mark.parametrize("n", FIELDS)
def test_the_naive_bound_doubles_until_the_permutation_cap(n: int) -> None:
    values = [degree_upper_bound(_mimc(n, r)).value for r in ROUNDS]
    for previous, current in zip(values, values[1:]):
        assert current in (2 * previous, n - 1) or previous == n - 1


# -- A2: the two models, and what separates them ----------------------------


def _model_p(n: int, r: int) -> int:
    return bin(pow(3, r, (1 << n) - 1)).count("1")


def test_the_pure_power_model_is_not_an_upper_bound() -> None:
    """Its predicted drop at r=4 does not occur, so it under-predicts."""
    assert _model_p(9, 3) == 4
    assert _model_p(9, 4) == 3  # the predicted drop
    assert exact_degree(_mimc(9, 4)) == 4  # which did not happen
    assert _model_p(9, 4) < exact_degree(_mimc(9, 4))


@pytest.mark.parametrize("n", FIELDS)
def test_the_measured_degree_lies_between_the_two_models(n: int) -> None:
    for r in ROUNDS:
        target = _mimc(n, r)
        exact = exact_degree(target)
        assert _model_p(n, r) <= exact <= mimc_derived_bound(target).value, (n, r)


# -- A3: the derived bound ---------------------------------------------------


def test_max_weight_up_to_is_the_largest_all_ones_value() -> None:
    assert max_weight_up_to(1) == 1
    assert max_weight_up_to(2) == 1  # 1 is the largest all-ones <= 2
    assert max_weight_up_to(3) == 2
    assert max_weight_up_to(243) == 7  # 127 = 2^7-1 <= 243 < 255
    assert max_weight_up_to(255) == 8
    assert max_weight_up_to(511) == 9
    with pytest.raises(ValueError):
        max_weight_up_to(0)


@pytest.mark.parametrize("n", FIELDS)
def test_the_derived_bound_is_sound(n: int) -> None:
    for r in ROUNDS:
        target = _mimc(n, r)
        assert mimc_derived_bound(target).value >= exact_degree(target), (n, r)


@pytest.mark.parametrize("n", FIELDS)
def test_the_derived_bound_never_loses_to_the_naive_one(n: int) -> None:
    for r in ROUNDS:
        target = _mimc(n, r)
        assert mimc_derived_bound(target).value <= degree_upper_bound(target).value


def test_the_derived_bound_strictly_improves_somewhere() -> None:
    """A bound that only ever ties is a relabelling, not an improvement."""
    improvements = [
        r
        for r in ROUNDS
        if mimc_derived_bound(_mimc(13, r)).value < degree_upper_bound(_mimc(13, r)).value
    ]
    assert len(improvements) >= 4


def test_the_mean_gap_falls_by_more_than_half_at_n13() -> None:
    naive = [degree_upper_bound(_mimc(13, r)).value - exact_degree(_mimc(13, r)) for r in ROUNDS]
    derived = [mimc_derived_bound(_mimc(13, r)).value - exact_degree(_mimc(13, r)) for r in ROUNDS]
    assert sum(derived) * 2 < sum(naive)


def test_the_derived_bound_carries_its_derivation() -> None:
    assert "exponent support" in mimc_derived_bound(_mimc(9, 4)).derivation


def test_the_derived_quantity_is_refused_for_non_mimc_targets() -> None:
    from core.targets import PowerMap

    class Case:
        quantity = "algebraic_degree_upper_bound_derived"

    with pytest.raises(MeasurementRefused, match="specific to the MiMC"):
        measure(PowerMap.create(9, 3), Case())


# -- A4: the mechanism is not an artefact of one field size -----------------


def test_both_exact_paths_agree_across_field_sizes() -> None:
    for n in FIELDS:
        for r in ROUNDS:
            target = _mimc(n, r)
            assert exact_degree(target) == algebraic_degree(target, n, n), (n, r)


def test_the_exact_path_refuses_above_its_guard_rather_than_approximating() -> None:
    target = _mimc(17, 4)
    assert target.n > MAX_EXACT_VARS
    with pytest.raises(MeasurementRefused, match="does not approximate"):
        exact_degree(target)


def test_the_derived_bound_still_applies_where_the_exact_path_refuses() -> None:
    assert mimc_derived_bound(_mimc(17, 4)).value == 6


# -- A5: the saturation blindness class -------------------------------------


@pytest.mark.parametrize("n", FIELDS)
def test_a_saturating_permutation_exponent_exists(n: int) -> None:
    exponents = sp.saturating_exponents(n)
    assert exponents
    for e in exponents:
        assert bin(e).count("1") == n - 1


@pytest.mark.parametrize("n", FIELDS)
def test_the_class_has_maximal_degree_and_the_measure_returns_its_null(n: int) -> None:
    target = sp.counterexample(n)
    assert exact_degree(target) == n - 1
    assert degree_upper_bound(target).value == n - 1
    outcome = sp.check(
        lambda t, nn: algebraic_degree(t, nn, nn),
        n,
        test_id="tests/test_stage_a.py",
        computation_id=f"A5-{n}",
    )
    assert outcome.passed


@pytest.mark.parametrize("n", FIELDS)
def test_one_exponentiation_inverts_the_class(n: int) -> None:
    """Checked over the whole field, not asserted."""
    target = sp.counterexample(n)
    assert sp.is_inverted_by_one_exponentiation(n, target.exponent)


def test_the_blindness_test_can_fail() -> None:
    outcome = sp.check(
        lambda t, nn: nn - 3, 9, test_id="synthetic", computation_id="synthetic"
    )
    assert not outcome.passed


def test_the_class_is_distinct_from_the_inverse_map() -> None:
    from modules.degree.blindness import inverse_map

    assert sp.counterexample(9).exponent != (1 << 9) - 2
    assert "univariate" in sp.BLINDNESS_STATEMENT
    assert "x*y = 1" in inverse_map.BLINDNESS_STATEMENT
