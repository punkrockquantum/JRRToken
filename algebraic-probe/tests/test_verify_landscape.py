"""Exhaustive landscape statistics.

The prediction 2^n/(n+1) is the falsifiable anchor of the whole landscape arm, so
it is not tested by sampling random landscapes and hoping. For small n every
possible ordering of the energies is enumerated and the mean count is asserted to
equal the prediction *exactly*, which is a test of the derivation rather than of
one realisation of it.
"""

from __future__ import annotations

from fractions import Fraction
from itertools import permutations

import pytest

from verify import landscape as L


# -- the prediction ---------------------------------------------------------


def test_the_prediction_is_two_to_the_n_over_n_plus_one() -> None:
    for n in range(1, 20):
        assert L.expected_local_minima_iid(n) == (1 << n) / (n + 1)


@pytest.mark.parametrize("n", [1, 2, 3])
def test_the_prediction_is_exact_over_every_ordering_of_the_energies(n: int) -> None:
    """The derivation, checked against brute force.

    Exchangeability says each of a state's n+1 closed-neighbourhood members is
    equally likely to be smallest. Enumerating all (2^n)! orderings and averaging
    the local-minimum count must therefore land exactly on 2^n/(n+1) -- as a
    rational, with no floating-point slack to hide in.
    """
    size = 1 << n
    total = 0
    orderings = 0
    for ordering in permutations(range(size)):
        total += len(L.local_minima([float(v) for v in ordering], n))
        orderings += 1
    mean = Fraction(total, orderings)
    assert mean == Fraction(size, n + 1), (n, mean)


def test_a_one_bit_landscape_always_has_exactly_one_minimum() -> None:
    """The degenerate case the prediction must also get right: 2/(1+1) = 1."""
    assert L.expected_local_minima_iid(1) == 1.0
    assert L.local_minima([0.0, 1.0], 1) == [0]
    assert L.local_minima([1.0, 0.0], 1) == [1]


# -- local minima ------------------------------------------------------------


def test_a_single_basin_has_one_minimum() -> None:
    """Energy = popcount: the all-zero state is the unique minimum."""
    n = 6
    values = [float(x.bit_count()) for x in range(1 << n)]
    assert L.local_minima(values, n) == [0]


def test_a_flat_landscape_has_no_strict_minima() -> None:
    """Ties disqualify: a plateau is not a strict local minimum."""
    n = 5
    assert L.local_minima([7.0] * (1 << n), n) == []


def test_both_ends_of_a_two_basin_landscape_are_found() -> None:
    n = 6
    # Energy = min(popcount, n - popcount): minima at all-zeros and all-ones.
    values = [float(min(x.bit_count(), n - x.bit_count())) for x in range(1 << n)]
    found = set(L.local_minima(values, n))
    assert found == {0, (1 << n) - 1}


def test_local_minima_refuses_a_mismatched_landscape() -> None:
    with pytest.raises(ValueError, match="expected 16 energies"):
        L.local_minima([0.0] * 15, 4)


# -- overlap -----------------------------------------------------------------


def test_the_overlap_convention() -> None:
    n = 8
    assert L.overlap(0b10101010, 0b10101010, n) == 1.0
    assert L.overlap(0b00000000, 0b11111111, n) == -1.0
    assert L.overlap(0b00000000, 0b00001111, n) == 0.0


def test_overlap_is_symmetric() -> None:
    n = 10
    for x, y in ((3, 900), (17, 17), (0, 1023), (511, 512)):
        assert L.overlap(x, y, n) == L.overlap(y, x, n)


def test_lowest_states_are_ordered_by_energy() -> None:
    values = [5.0, 1.0, 4.0, 0.0, 3.0, 2.0, 7.0, 6.0]
    assert L.lowest_states(values, 4) == [3, 1, 5, 4]


def test_lowest_states_refuses_more_than_exist() -> None:
    with pytest.raises(ValueError, match="asked for 9 states of 8"):
        L.lowest_states([0.0] * 8, 9)


def test_a_clustered_ground_state_shows_high_overlap() -> None:
    """Constructed rather than sampled: put every low-energy state in one block
    and the overlap distribution must report it."""
    n = 8
    # States whose top 4 bits are 0b1010 get low energy; everything else high.
    values = [0.0 if (x >> 4) == 0b1010 else 10.0 for x in range(1 << n)]
    distribution = L.overlap_distribution(values, n, 16)
    # All 16 share their top 4 bits and differ only in the bottom 4, so the
    # Hamming distance is at most 4 and q = 1 - 2*d/8 lies in [0, 0.75]. The
    # pairs differing in all four inner bits sit at exactly 0, and mass_above is
    # strict, so the floor is asserted on the values rather than through it.
    assert distribution.mean > 0.4
    assert min(distribution.values) == 0.0
    assert max(distribution.values) == 0.75
    assert distribution.mass_above(-0.01) == 1.0


def test_a_scattered_ground_state_shows_overlap_near_zero() -> None:
    n = 12
    # Energies decreasing in x scatter the lowest states across the cube; use a
    # spread-out fixed set instead so the test asserts the statistic, not a seed.
    chosen = {0b000000000000, 0b111111000000, 0b000000111111, 0b101010101010}
    values = [0.0 if x in chosen else 1.0 for x in range(1 << n)]
    distribution = L.overlap_distribution(values, n, 4)
    assert abs(distribution.mean) < 0.2


def test_the_overlap_histogram_covers_every_pair() -> None:
    n = 6
    values = [float((x * 37) % 64) for x in range(1 << n)]
    distribution = L.overlap_distribution(values, n, 8)
    assert distribution.n_pairs == 8 * 7 // 2
    assert sum(count for _, _, count in distribution.histogram(20)) == distribution.n_pairs


def test_the_overlap_summary_never_reports_a_bare_mean() -> None:
    n = 6
    values = [float((x * 11) % 64) for x in range(1 << n)]
    rendered = L.overlap_distribution(values, n, 8).render()
    for field in ("n_states", "n_pairs", "mean_q", "var_q", "mass_above"):
        assert field in rendered


# -- density of states -------------------------------------------------------


def test_the_moments_of_a_known_sample() -> None:
    values = [1.0, 2.0, 3.0, 4.0, 5.0]
    mean, variance, skewness, kurtosis = L.moments(values)
    assert mean == pytest.approx(3.0)
    assert variance == pytest.approx(2.0)  # population variance
    assert skewness == pytest.approx(0.0, abs=1e-12)
    assert kurtosis == pytest.approx(-1.3, abs=1e-9)


def test_a_constant_landscape_has_zero_spread() -> None:
    assert L.moments([2.0] * 10) == (2.0, 0.0, 0.0, 0.0)


def test_the_density_histogram_accounts_for_every_state() -> None:
    values = [float(x % 17) for x in range(500)]
    assert sum(c for _, _, c in L.density_of_states(values, 25)) == 500


def test_a_degenerate_density_is_a_single_bin() -> None:
    assert L.density_of_states([3.0] * 10) == [(3.0, 3.0, 10)]


# -- guards ------------------------------------------------------------------


def test_the_landscape_path_refuses_rather_than_sampling_above_its_guard() -> None:
    too_many = L.MAX_LANDSCAPE_VARS + 1
    with pytest.raises(L.LandscapeRefused, match="does not sample"):
        L.energies(lambda x: 0.0, too_many)
    with pytest.raises(L.LandscapeRefused, match="does not sample"):
        L.expected_local_minima_iid(too_many)


def test_the_guard_is_a_stated_constant() -> None:
    assert L.MAX_LANDSCAPE_VARS == 22
