"""The packed exhaustive path against the reference exhaustive path.

``verify/packed.py`` exists only because ``verify/anf.py`` cannot reach 25
variables. It is worth having only if it computes the same thing, so every test
here pins it against ``anf.py`` on targets small enough for both, rather than
against values written out by hand.
"""

from __future__ import annotations

import pytest

from core.keccak import KeccakF
from core.mimc import MiMC
from core.targets import (
    BlockRestrictedMap,
    InverseMap,
    IteratedPowerMap,
    LinearMapGF2,
    PowerMap,
    RandomFunction,
)
from verify import anf, packed


def _targets():
    return [
        ("linear n=8", LinearMapGF2.random_invertible(8, 7), 8, 8),
        ("linear n=10", LinearMapGF2.random_invertible(10, 11), 10, 10),
        ("power n=9 d=31", PowerMap.create(9, 31), 9, 9),
        ("power n=11 d=3", PowerMap.create(11, 3), 11, 11),
        ("inverse n=9", InverseMap.create(9), 9, 9),
        ("random n=10", RandomFunction.create(10, 10, 5), 10, 10),
        ("mimc n=9 r=3", MiMC.create(n=9, n_rounds=3, seed=0), 9, 9),
        ("mimc n=9 r=6", MiMC.create(n=9, n_rounds=6, seed=0), 9, 9),
        ("iterated n=11 e=3 r=5", IteratedPowerMap.create(11, 3, 5), 11, 11),
        ("block n=11 active=6", BlockRestrictedMap.create(11, 6, 3, 2), 11, 11),
        ("keccak-f[25] r=1 (low bits)", KeccakF.create(0, 1), 11, 11),
    ]


@pytest.mark.parametrize("label,target,n,m", _targets(), ids=lambda v: v if isinstance(v, str) else "")
def test_the_packed_path_agrees_with_the_reference_path_per_output_bit(label, target, n, m) -> None:
    """Not just the maximum: every output bit's degree must match."""
    reference = anf.degree_profile(target, n, m)
    columns = packed.pack_truth_table(target, n, m)
    observed = packed.degree_profile_from_columns(columns, n)
    assert observed == reference, label


def test_the_packed_path_agrees_on_the_collapsed_degree() -> None:
    target = PowerMap.create(11, 31)
    assert packed.algebraic_degree_packed(target, 11, 11) == anf.algebraic_degree(target, 11, 11)


def test_input_columns_hold_the_input_variables() -> None:
    """Bit x of column i must be bit i of x -- the property the whole path rests on."""
    n = 6
    columns = packed.input_columns(n)
    for i, column in enumerate(columns):
        for x in range(1 << n):
            assert (column >> x) & 1 == (x >> i) & 1, (i, x)


def test_low_mask_selects_exactly_the_positions_with_the_bit_clear() -> None:
    n = 5
    for index in range(n):
        mask = packed.low_mask(n, index)
        for x in range(1 << n):
            assert bool((mask >> x) & 1) == (not (x >> index) & 1), (index, x)


def test_weight_masks_partition_the_space_by_hamming_weight() -> None:
    n = 7
    masks = packed.weight_masks(n)
    assert len(masks) == n + 1
    for weight, mask in enumerate(masks):
        for x in range(1 << n):
            assert bool((mask >> x) & 1) == (x.bit_count() == weight), (weight, x)
    # A partition: every position in exactly one mask.
    union = 0
    for mask in masks:
        assert union & mask == 0, "weight classes must be disjoint"
        union |= mask
    assert union == packed.full_mask(n)


def test_the_moebius_transform_matches_the_reference_transform() -> None:
    target = RandomFunction.create(9, 9, 17)
    n = 9
    for out_bit in range(9):
        reference = anf.mobius(anf.truth_table(target, n, out_bit))
        column = packed.pack_truth_table(target, n, 9)[out_bit]
        got = packed.moebius_column(column, n)
        for index, coefficient in enumerate(reference):
            assert (got >> index) & 1 == coefficient, (out_bit, index)


def test_the_zero_function_has_degree_minus_one_in_both_paths() -> None:
    """A degree of -1 must not be confused with a non-zero constant of degree 0."""
    assert packed.degree_of_column(0, 6) == -1
    assert anf.degree_from_anf([0] * 64) == -1


def test_a_non_zero_constant_has_degree_zero() -> None:
    n = 5
    # f(x) = 1 everywhere: the ANF is the single empty monomial.
    column = packed.full_mask(n)
    assert packed.degree_of_column(packed.moebius_column(column, n), n) == 0


def test_the_packed_path_refuses_rather_than_sampling_above_its_guard() -> None:
    too_many = packed.MAX_PACKED_VARS + 1
    with pytest.raises(packed.ExhaustionRefused, match="does not sample"):
        packed.full_mask(too_many)
    with pytest.raises(packed.ExhaustionRefused, match="does not sample"):
        packed.pack_truth_table(lambda x: x, too_many, 1)


def test_the_guard_is_stated_as_a_constant_not_buried_in_a_branch() -> None:
    assert packed.MAX_PACKED_VARS == 26
    assert packed.MAX_PACKED_VARS > anf.MAX_EXHAUSTIVE_VARS, (
        "the packed path exists to reach further than the reference path; if it "
        "does not, it has no reason to exist"
    )


def test_a_variable_index_outside_the_space_is_refused() -> None:
    with pytest.raises(ValueError, match="out of range"):
        packed.low_mask(4, 4)
