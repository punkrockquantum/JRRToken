"""The exhaustive dependence path -- Module 2's independent verifier.

Pinned against hand-constructed functions whose dependence is known by
inspection, not against the module it verifies.
"""

from __future__ import annotations

import pytest

from core.targets import CancellingXor, LinearMapGF2
from verify.dependence import (
    MAX_DEPENDENCE_VARS,
    DependenceRefused,
    constant_output_bits,
    dependence_matrix,
    dependent_input_bits,
    reachability_contains_dependence,
)


def test_the_identity_depends_on_exactly_its_own_bit() -> None:
    matrix = dependence_matrix(lambda x: x, 6, 6)
    assert matrix == [1 << i for i in range(6)]


def test_a_constant_function_depends_on_nothing() -> None:
    assert dependence_matrix(lambda x: 0b1010, 5, 4) == [0, 0, 0, 0]
    assert constant_output_bits(lambda x: 0b1010, 5, 4) == (0, 1, 2, 3)


def test_a_projection_depends_on_one_bit() -> None:
    matrix = dependence_matrix(lambda x: (x >> 2) & 1, 5, 1)
    assert matrix == [1 << 2]


def test_an_xor_of_two_bits_depends_on_both() -> None:
    matrix = dependence_matrix(lambda x: ((x >> 1) ^ (x >> 3)) & 1, 5, 1)
    assert matrix == [(1 << 1) | (1 << 3)]


def test_an_and_of_two_bits_depends_on_both() -> None:
    matrix = dependence_matrix(lambda x: ((x >> 0) & (x >> 2)) & 1, 4, 1)
    assert matrix == [(1 << 0) | (1 << 2)]


def test_dependence_visible_only_at_low_inputs_is_still_found() -> None:
    """The accumulation is load-bearing, and this is what tests it.

    ``f(x) = x0 AND NOT x1`` depends on bit 0, but only when bit 1 is clear. The
    *last* input without bit 0 set has bit 1 set, so the final comparison shows no
    difference: a path that assigned rather than accumulated would conclude bit 0
    is irrelevant. Mutant RCH-08 does exactly that, and every other function in
    this file happens to differ at its last input too, so nothing else catches it.
    """

    def f(x: int) -> int:
        return (x & 1) & (~(x >> 1) & 1)

    matrix = dependence_matrix(f, 2, 1)
    assert matrix == [0b11], "both bits influence the output somewhere"

    # Wider, so the guard bit is not the top bit either.
    def g(x: int) -> int:
        return (x & 1) & (~(x >> 3) & 1)

    assert dependence_matrix(g, 5, 1) == [0b01001]


def test_a_cancelling_pair_reads_as_constant() -> None:
    """x ^ x: reachable from x by any operation-wise analysis, constant in fact."""
    assert dependence_matrix(lambda x: x ^ x, 6, 6) == [0] * 6


def test_an_invertible_linear_map_depends_on_everything_somewhere() -> None:
    target = LinearMapGF2.random_invertible(8, 3)
    assert dependent_input_bits(target, 8, 8) == (1 << 8) - 1


def test_the_cancelling_xor_target_matches_its_construction() -> None:
    target = CancellingXor.create(10, 7, (2, 5))
    assert constant_output_bits(target, 10, 10) == target.constant_output_bits == (2, 5)


def test_soundness_helper_reports_escaping_bits() -> None:
    target = LinearMapGF2.random_invertible(6, 11)
    full = (1 << 6) - 1
    holds, escaping = reachability_contains_dependence(target, 6, 6, full)
    assert holds and escaping == 0
    # A reachable set missing bit 0 must be reported as unsound.
    holds, escaping = reachability_contains_dependence(target, 6, 6, full ^ 1)
    assert not holds and escaping == 1


def test_the_path_refuses_rather_than_sampling_above_its_guard() -> None:
    with pytest.raises(DependenceRefused, match="does not sample"):
        dependence_matrix(lambda x: x, MAX_DEPENDENCE_VARS + 1, 1)


def test_the_guard_is_a_stated_constant() -> None:
    assert MAX_DEPENDENCE_VARS == 18
