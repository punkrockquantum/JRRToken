"""The independent verification path: exact ANF by Moebius transform."""

from __future__ import annotations

import pytest

from verify.anf import (
    MAX_EXHAUSTIVE_VARS,
    ExhaustionRefused,
    algebraic_degree,
    algebraic_degree_bit,
    degree_from_anf,
    degree_profile,
    derivative_vanishes,
    mobius,
    monomial_present,
    subspace_sum,
    truth_table,
)


def test_mobius_on_hand_computed_tables() -> None:
    # x = x0 + 2*x1; index i of the ANF is the variable-set mask.
    assert mobius([0, 0, 0, 1]) == [0, 0, 0, 1]  # x0 AND x1 -> monomial x0x1
    assert mobius([0, 1, 1, 0]) == [0, 1, 1, 0]  # x0 XOR x1
    assert mobius([1, 1, 1, 1]) == [1, 0, 0, 0]  # constant 1
    assert mobius([0, 0, 0, 0]) == [0, 0, 0, 0]  # zero function


def test_mobius_is_an_involution() -> None:
    table = [0, 1, 1, 0, 1, 0, 0, 1]
    assert mobius(mobius(table)) == table


def test_degree_of_the_zero_function_is_minus_one() -> None:
    assert degree_from_anf([0, 0, 0, 0]) == -1
    assert degree_from_anf([1, 0, 0, 0]) == 0
    assert degree_from_anf([0, 0, 0, 1]) == 2


def test_degrees_of_small_explicit_functions() -> None:
    assert algebraic_degree_bit(lambda x: (x & 1) ^ ((x >> 1) & 1), 2, 0) == 1
    assert algebraic_degree_bit(lambda x: (x & 1) & ((x >> 1) & 1), 2, 0) == 2
    assert algebraic_degree_bit(lambda x: (x & 1) & ((x >> 1) & 1) & ((x >> 2) & 1), 3, 0) == 3
    assert algebraic_degree_bit(lambda x: 1, 3, 0) == 0


def test_vectorial_degree_is_the_maximum_over_output_bits() -> None:
    def f(x: int) -> int:
        low = x & 1
        high = (x & 1) & ((x >> 1) & 1) & ((x >> 2) & 1)
        return low | (high << 1)

    assert degree_profile(f, 3, 2) == (1, 3)
    assert algebraic_degree(f, 3, 2) == 3


def test_monomial_presence() -> None:
    def f(x: int) -> int:
        return (x & 1) & ((x >> 1) & 1)

    assert monomial_present(f, 2, 0, 0b11)
    assert not monomial_present(f, 2, 0, 0b01)


def test_derivative_of_order_degree_plus_one_vanishes() -> None:
    def f(x: int) -> int:  # degree 2
        return (x & 1) & ((x >> 1) & 1)

    assert derivative_vanishes(f, [0b001, 0b010, 0b100])
    assert not derivative_vanishes(f, [0b001, 0b010])


def test_subspace_sum_of_a_linear_function_vanishes_at_order_two() -> None:
    def f(x: int) -> int:
        return (x & 1) ^ ((x >> 1) & 1) ^ ((x >> 2) & 1)

    assert subspace_sum(f, [0b001, 0b010]) == 0
    assert subspace_sum(f, [0b001]) == 1


def test_repeated_basis_vectors_are_refused() -> None:
    with pytest.raises(ValueError, match="distinct"):
        subspace_sum(lambda x: x, [1, 1])


def test_the_exhaustion_guard_refuses_rather_than_sampling() -> None:
    with pytest.raises(ExhaustionRefused, match="does not sample"):
        truth_table(lambda x: x, MAX_EXHAUSTIVE_VARS + 1, 0)


def test_truth_table_length_and_content() -> None:
    table = truth_table(lambda x: x, 3, 0)
    assert len(table) == 8
    assert table == [0, 1, 0, 1, 0, 1, 0, 1]


def test_mobius_rejects_non_power_of_two_tables() -> None:
    with pytest.raises(ValueError, match="power of two"):
        mobius([0, 1, 1])
