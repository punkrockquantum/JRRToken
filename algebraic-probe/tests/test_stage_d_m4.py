"""Module 4: higher-order differentials implied by Module 1's degree bounds."""

from __future__ import annotations

import pytest

from core.mimc import MiMC
from core.targets import InverseMap, IteratedPowerMap, PowerMap
from modules.degree.measure import degree_upper_bound, exact_degree, mimc_derived_bound
from modules.hod.blindness import multiplicative_coset as mcoset
from modules.hod.measure import (
    HODRefused,
    derivative_vanishes,
    implied_order,
    last_nontrivial_round,
    useful_until,
)
from modules.hod.spec import SPEC

FIELDS = (9, 11, 13)


def test_the_implied_order_is_the_degree_plus_one() -> None:
    r = implied_order(4, 9, round_index=3)
    assert r.order == 5 and r.log2_data == 5 and r.exists
    assert "vanishes identically" in r.derivation


def test_an_order_above_the_variable_count_does_not_exist() -> None:
    assert not implied_order(9, 9, round_index=1).exists
    assert implied_order(8, 9, round_index=1).exists


def test_a_negative_degree_is_refused() -> None:
    with pytest.raises(HODRefused):
        implied_order(-1, 9, 1)


# -- the Tier P claim, checked empirically -----------------------------------


@pytest.mark.parametrize("rounds", (1, 2, 3, 4))
def test_the_derivative_at_the_implied_order_vanishes(rounds: int) -> None:
    target = MiMC.create(n=9, n_rounds=rounds)
    degree = exact_degree(target)
    assert derivative_vanishes(target, degree + 1, seed=7)


@pytest.mark.parametrize("rounds", (1, 2, 3, 4))
def test_the_derivative_one_order_below_does_not_vanish(rounds: int) -> None:
    """Without this the vanishing test would pass for any dimension."""
    target = MiMC.create(n=9, n_rounds=rounds)
    degree = exact_degree(target)
    assert not derivative_vanishes(target, degree, seed=7)


def test_the_subspace_check_refuses_above_its_guard() -> None:
    with pytest.raises(HODRefused, match="does not sample"):
        derivative_vanishes(MiMC.create(n=9, n_rounds=1), 21, seed=1)
    with pytest.raises(HODRefused, match="no .* subspace exists"):
        derivative_vanishes(MiMC.create(n=9, n_rounds=1), 10, seed=1)


# -- D2: what the exact degrees change ---------------------------------------


@pytest.mark.parametrize("n", FIELDS)
def test_the_doubling_bound_gives_up_rounds_against_the_exact_degree(n: int) -> None:
    rounds = range(1, 10)
    naive = [degree_upper_bound(MiMC.create(n=n, n_rounds=r)).value for r in rounds]
    exact = [exact_degree(MiMC.create(n=n, n_rounds=r)) for r in rounds]
    lost = last_nontrivial_round(exact, n) - last_nontrivial_round(naive, n)
    assert lost >= 3, (n, lost)


@pytest.mark.parametrize("n", FIELDS)
def test_the_derived_bound_recovers_most_of_the_lost_rounds(n: int) -> None:
    rounds = range(1, 10)
    naive = [degree_upper_bound(MiMC.create(n=n, n_rounds=r)).value for r in rounds]
    derived = [mimc_derived_bound(MiMC.create(n=n, n_rounds=r)).value for r in rounds]
    exact = [exact_degree(MiMC.create(n=n, n_rounds=r)) for r in rounds]
    assert (
        last_nontrivial_round(naive, n)
        < last_nontrivial_round(derived, n)
        <= last_nontrivial_round(exact, n)
    )


def test_useful_until_and_last_nontrivial_round_differ() -> None:
    """Existing and being useful are different questions."""
    bounds = [2, 4, 8, 8]  # orders 3, 5, 9, 9 against n = 9
    # Every order exists (all <= 9), so the distinguisher is available throughout.
    assert useful_until(bounds, 9) == 4
    # But from r=3 the order equals the variable count, which is exhaustive
    # evaluation rather than a distinguisher.
    assert last_nontrivial_round(bounds, 9) == 2
    # An order above the variable count does not even exist.
    assert useful_until([9, 9, 9], 9) == 0


# -- the blindness class -----------------------------------------------------


def test_the_class_has_saturated_degree() -> None:
    target = mcoset.counterexample(9)
    assert exact_degree(target) == 8


def test_the_coset_integral_holds_for_the_class() -> None:
    assert mcoset.integral_holds(9, 7)


def test_the_same_integral_does_not_hold_for_a_random_function() -> None:
    """Otherwise the coset sum would be vacuous rather than a distinguisher."""
    from core.targets import RandomFunction

    subgroup = mcoset.subgroup_of_order(9, 7)
    random_function = RandomFunction.create(9, 9, 42)
    sums = [mcoset.coset_sum(random_function, 9, subgroup, m) for m in (1, 2, 3)]
    assert any(s != 0 for s in sums)


def test_the_blindness_test_reports_the_data_asymmetry() -> None:
    from verify.anf import algebraic_degree

    outcome = mcoset.check(
        lambda t, n: algebraic_degree(t, n, n),
        9,
        7,
        test_id="tests/test_stage_d_m4.py",
        computation_id="M4-BLIND-001",
    )
    assert outcome.passed
    assert "degree_implied_data=2^9" in outcome.observed
    assert "coset_distinguisher_data=7" in outcome.observed


def test_a_subgroup_order_that_does_not_divide_is_refused() -> None:
    with pytest.raises(ValueError, match="does not divide"):
        mcoset.subgroup_of_order(9, 5)


# -- registration and the calibration block ----------------------------------


def test_the_module_ships_calibration_blocked_with_its_reason() -> None:
    status = SPEC.suite.gate()
    assert status.blocked
    assert any("no published-ground-truth case" in r for r in status.blocking_reasons)


def test_the_controls_pass_through_the_module_path() -> None:
    report = SPEC.suite.run_controls(SPEC.measure)
    assert report.satisfied, report.render()
    assert len(report.outcomes) == 3


def test_running_controls_does_not_lift_the_block() -> None:
    from tiers.errors import CalibrationBlocked

    SPEC.suite.run_controls(SPEC.measure)
    assert SPEC.suite.gate().blocked
    with pytest.raises(CalibrationBlocked):
        SPEC.suite.run(SPEC.measure)


def test_a_suite_without_ground_truth_must_state_why() -> None:
    from harness.calibration import CalibrationSuite
    from tiers.errors import CalibrationBlocked
    from tiers.provenance import CitationIndex

    with pytest.raises(CalibrationBlocked, match="must state"):
        CalibrationSuite(
            module_id="m",
            cases=SPEC.suite.cases,
            citations=CitationIndex(citations=()),
            allow_missing_ground_truth=True,
            missing_ground_truth_reason="   ",
        )
