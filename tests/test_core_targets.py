"""The controls of section 5, checked in-repo by exhaustive ANF.

This is what turns each control's analytically stated value into provenance: the
number the calibration suite will assert is recomputed here from the function
itself, not taken from the docstring that states the theorem.
"""

from __future__ import annotations

import pytest

from core.gf2 import GF2n
from core.targets import InverseMap, LinearMapGF2, PowerMap, RandomFunction
from verify.anf import algebraic_degree, degree_profile

LINEAR_N = 12
LINEAR_SEED = 20260824
POWER_N = 9
INVERSE_N = 9
RANDOM_N = 12
RANDOM_SEED = 20260825


# -- positive control -------------------------------------------------------


def test_positive_control_is_invertible() -> None:
    linear = LinearMapGF2.random_invertible(LINEAR_N, LINEAR_SEED)
    assert linear.is_invertible
    images = {linear(x) for x in range(1 << LINEAR_N)}
    assert len(images) == 1 << LINEAR_N


def test_positive_control_has_degree_one_in_every_output_bit() -> None:
    """M1-CTRL-LIN-001."""
    linear = LinearMapGF2.random_invertible(LINEAR_N, LINEAR_SEED)
    assert degree_profile(linear, LINEAR_N, LINEAR_N) == (1,) * LINEAR_N
    assert linear.expected_degree == 1


def test_positive_control_is_deterministic_in_its_seed() -> None:
    a = LinearMapGF2.random_invertible(LINEAR_N, LINEAR_SEED)
    b = LinearMapGF2.random_invertible(LINEAR_N, LINEAR_SEED)
    assert a.rows == b.rows
    c = LinearMapGF2.random_invertible(LINEAR_N, LINEAR_SEED + 1)
    assert c.rows != a.rows


# -- intermediate control ---------------------------------------------------


def test_power_map_degree_equals_the_hamming_weight_of_the_exponent() -> None:
    """M1-CTRL-POW-001: every exponent at n = 9, exhaustively."""
    for d in range(1, (1 << POWER_N) - 1):
        power = PowerMap.create(POWER_N, d)
        observed = algebraic_degree(power, POWER_N, POWER_N)
        assert observed == bin(d).count("1") == power.expected_degree, d


def test_power_map_intermediate_value_is_not_an_endpoint() -> None:
    power = PowerMap.create(11, 31)
    assert power.expected_degree == 5
    assert 1 < power.expected_degree < 11 - 1


def test_cube_map_has_degree_two() -> None:
    cube = PowerMap.create(POWER_N, 3)
    assert algebraic_degree(cube, POWER_N, POWER_N) == 2


# -- blindness class --------------------------------------------------------


def test_inverse_map_has_the_maximal_degree_for_a_permutation() -> None:
    """M1-CTRL-INV-001."""
    inverse = InverseMap.create(INVERSE_N)
    assert algebraic_degree(inverse, INVERSE_N, INVERSE_N) == INVERSE_N - 1
    assert inverse.expected_degree == INVERSE_N - 1


def test_inverse_map_is_an_involution_off_zero() -> None:
    field = GF2n(INVERSE_N)
    inverse = InverseMap.create(INVERSE_N)
    for x in range(1 << INVERSE_N):
        assert inverse(inverse(x)) == x
        if x:
            assert field.mul(x, inverse(x)) == 1


# -- negative control -------------------------------------------------------


def test_negative_control_saturates_the_degree() -> None:
    """M1-CTRL-RND-001."""
    random_function = RandomFunction.create(RANDOM_N, RANDOM_N, RANDOM_SEED)
    assert algebraic_degree(random_function, RANDOM_N, RANDOM_N) >= RANDOM_N - 1


def test_negative_control_states_its_own_failure_probability() -> None:
    random_function = RandomFunction.create(RANDOM_N, RANDOM_N, RANDOM_SEED)
    assert random_function.prob_degree_is_n == 0.5
    assert random_function.prob_degree_at_least_n_minus_1 == pytest.approx(
        1 - 2.0 ** (-(RANDOM_N + 1))
    )


def test_negative_control_is_deterministic_in_its_seed() -> None:
    a = RandomFunction.create(RANDOM_N, RANDOM_N, RANDOM_SEED)
    b = RandomFunction.create(RANDOM_N, RANDOM_N, RANDOM_SEED)
    c = RandomFunction.create(RANDOM_N, RANDOM_N, RANDOM_SEED + 1)
    assert [a(x) for x in range(64)] == [b(x) for x in range(64)]
    assert [a(x) for x in range(64)] != [c(x) for x in range(64)]


def test_negative_control_rejects_out_of_range_inputs() -> None:
    random_function = RandomFunction.create(8, 8, 1)
    with pytest.raises(ValueError, match="out of range"):
        random_function(256)


# -- the four controls are genuinely different ------------------------------


def test_the_controls_span_the_range_of_the_measured_quantity() -> None:
    """Degree 1, then wt(d) = 5, then n-1: an endpoint, a middle, an endpoint."""
    linear = LinearMapGF2.random_invertible(9, LINEAR_SEED)
    middle = PowerMap.create(9, 31)
    top = InverseMap.create(9)
    degrees = [
        algebraic_degree(linear, 9, 9),
        algebraic_degree(middle, 9, 9),
        algebraic_degree(top, 9, 9),
    ]
    assert degrees == [1, 5, 8]
