"""The bitsliced Keccak-f[25] against the production permutation.

``verify/keccak_columns.py`` writes the step wiring out a second time. That is
only worth something if the two readings are checked against each other, and
this file is that check: the columns are the permutation evaluated at every one
of 2^25 inputs, so agreeing with ``core.keccak.permute`` at a sample of inputs
is agreeing about the function, not about a summary of it.
"""

from __future__ import annotations

import random

import pytest

from core.keccak import KeccakF, round_constants
from verify import packed
from verify.keccak_columns import WIDTH, evaluate_at, keccak25_columns


def _sample(count: int, seed: int) -> list[int]:
    """Edge cases first, then a fixed pseudo-random spread."""
    rng = random.Random(seed)
    fixed = [0, 1, 2, 3, 1 << 24, (1 << 25) - 1, (1 << 25) - 2]
    return fixed + [rng.randrange(1 << WIDTH) for _ in range(count)]


@pytest.mark.parametrize("rounds", [0, 1, 2, 3, 5])
def test_the_columns_agree_with_the_production_permutation(rounds: int) -> None:
    columns = keccak25_columns(rounds)
    reference = KeccakF.create(lane_log2=0, n_rounds=rounds)
    for x in _sample(60, seed=rounds * 1000 + 7):
        assert evaluate_at(columns, x) == reference(x), (rounds, x)


def test_zero_rounds_is_the_identity() -> None:
    """The weakest possible case, and the one that catches a wiring error that
    happens to be self-consistent across rounds."""
    columns = keccak25_columns(0)
    for x in _sample(40, seed=1):
        assert evaluate_at(columns, x) == x


def test_every_lane_is_a_distinct_column_after_one_round() -> None:
    """A wiring mistake that drops pi or theta tends to collapse lanes onto each
    other; 25 distinct columns is cheap evidence against that."""
    columns = keccak25_columns(1)
    assert len(set(columns)) == WIDTH


def test_the_columns_span_the_whole_input_space() -> None:
    """Exhaustion, checked rather than assumed: the union of the input columns
    and their complements must account for all 2^25 positions."""
    columns = packed.input_columns(WIDTH)
    universe = packed.full_mask(WIDTH)
    for column in columns:
        assert column | (universe ^ column) == universe
        assert column.bit_count() == 1 << (WIDTH - 1), (
            "each input variable is 1 on exactly half the space"
        )


def test_the_round_constants_are_a_single_bit_at_lane_width_one() -> None:
    """The iota shortcut in the column evaluator is only valid if this holds."""
    constants = round_constants(0, 24)
    assert all(c in (0, 1) for c in constants)


def test_a_negative_round_count_is_refused() -> None:
    with pytest.raises(ValueError, match="non-negative"):
        keccak25_columns(-1)


def test_an_input_outside_the_state_is_refused_by_the_reader() -> None:
    columns = keccak25_columns(1)
    with pytest.raises(ValueError, match="out of range"):
        evaluate_at(columns, 1 << WIDTH)


def test_the_exact_degree_of_one_round_is_the_degree_of_chi() -> None:
    """One round has exactly the degree of its only non-linear step. Independent
    of every committed table: computed here, compared with a property of the
    target that is established elsewhere."""
    columns = keccak25_columns(1)
    profile = packed.degree_profile_from_columns(columns, WIDTH)
    assert max(profile) == KeccakF.create(lane_log2=0, n_rounds=1).chi_degree == 2
    assert min(profile) == 2, "chi is applied to every lane, so no lane stays affine"
