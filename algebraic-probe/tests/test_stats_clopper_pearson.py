"""The exact binomial interval, pinned against closed forms and known values.

Clopper-Pearson is solved here by bisection on an exact binomial tail rather
than through an inverse incomplete beta, so the tests have to establish two
separate things: that the tail is the binomial tail, and that the bisection lands
on the standard bounds.
"""

from __future__ import annotations

import math

import pytest

from stats.power import (
    binomial_tail_at_most,
    clopper_pearson_interval,
    zero_witness_upper_bound,
)


# -- the tail ---------------------------------------------------------------


def test_the_tail_is_the_binomial_tail() -> None:
    """Against a directly summed reference, not against itself."""
    for n in (1, 5, 17, 50):
        for p in (0.0, 0.01, 0.3, 0.5, 0.75, 1.0):
            for s in range(n + 1):
                reference = sum(
                    math.comb(n, k) * p**k * (1.0 - p) ** (n - k) for k in range(s + 1)
                )
                assert binomial_tail_at_most(s, n, p) == pytest.approx(reference, abs=1e-12)


def test_the_whole_tail_is_one() -> None:
    for n in (1, 10, 50):
        for p in (0.0, 0.25, 1.0):
            assert binomial_tail_at_most(n, n, p) == pytest.approx(1.0, abs=1e-9)


def test_the_tail_is_monotone_decreasing_in_p() -> None:
    """The property the bisection relies on. If it failed, the search would
    converge on the wrong side and nothing else here would notice."""
    n, s = 40, 12
    previous = 2.0
    for step in range(101):
        p = step / 100.0
        value = binomial_tail_at_most(s, n, p)
        assert value <= previous + 1e-12, (p, value, previous)
        previous = value


def test_the_tail_refuses_impossible_arguments() -> None:
    with pytest.raises(ValueError, match=r"successes must be in"):
        binomial_tail_at_most(5, 4, 0.5)
    with pytest.raises(ValueError, match=r"successes must be in"):
        binomial_tail_at_most(-1, 4, 0.5)
    with pytest.raises(ValueError, match="p must be in"):
        binomial_tail_at_most(1, 4, 1.5)


# -- the interval -----------------------------------------------------------


def test_zero_successes_agrees_with_the_closed_form_already_in_the_module() -> None:
    """Two independent routes to the same number.

    ``zero_witness_upper_bound`` is one-sided at confidence c: p_upper solves
    (1-p)^n = 1-c. The two-sided interval at confidence c puts (1-c)/2 in each
    tail, so its upper bound must equal the one-sided bound at (1+c)/2.
    """
    for n in (30, 50, 100, 365):
        for confidence in (0.90, 0.95, 0.99):
            _, upper = clopper_pearson_interval(0, n, confidence)
            one_sided = zero_witness_upper_bound(n, (1.0 + confidence) / 2.0)
            assert upper == pytest.approx(one_sided, abs=1e-12), (n, confidence)


def test_known_published_values() -> None:
    """Textbook Clopper-Pearson values, to four places."""
    low, high = clopper_pearson_interval(25, 50, 0.95)
    assert low == pytest.approx(0.3553, abs=5e-5)
    assert high == pytest.approx(0.6447, abs=5e-5)

    low, high = clopper_pearson_interval(1, 50, 0.95)
    assert low == pytest.approx(0.00051, abs=5e-5)
    assert high == pytest.approx(0.10647, abs=5e-5)

    low, high = clopper_pearson_interval(0, 10, 0.95)
    assert low == 0.0
    assert high == pytest.approx(0.3085, abs=5e-5)


def test_the_endpoints_are_degenerate_only_where_they_must_be() -> None:
    assert clopper_pearson_interval(0, 50, 0.95)[0] == 0.0
    assert clopper_pearson_interval(50, 50, 0.95)[1] == 1.0
    # ...and not otherwise.
    low, high = clopper_pearson_interval(1, 50, 0.95)
    assert low > 0.0 and high < 1.0


def test_the_interval_contains_the_point_estimate() -> None:
    for successes in range(0, 51, 5):
        low, high = clopper_pearson_interval(successes, 50, 0.95)
        assert low <= successes / 50 <= high, successes


def test_the_interval_is_symmetric_under_relabelling_success_and_failure() -> None:
    """P(success) = p is P(failure) = 1-p relabelled; the interval must mirror."""
    for successes in (0, 3, 17, 25, 44, 50):
        low, high = clopper_pearson_interval(successes, 50, 0.95)
        mirror_low, mirror_high = clopper_pearson_interval(50 - successes, 50, 0.95)
        assert low == pytest.approx(1.0 - mirror_high, abs=1e-9), successes
        assert high == pytest.approx(1.0 - mirror_low, abs=1e-9), successes


def test_a_higher_confidence_gives_a_wider_interval() -> None:
    narrow = clopper_pearson_interval(20, 50, 0.90)
    wide = clopper_pearson_interval(20, 50, 0.99)
    assert wide[0] < narrow[0]
    assert wide[1] > narrow[1]


def test_more_draws_give_a_narrower_interval_at_the_same_rate() -> None:
    small = clopper_pearson_interval(10, 20, 0.95)
    large = clopper_pearson_interval(100, 200, 0.95)
    assert (large[1] - large[0]) < (small[1] - small[0])


def test_the_bounds_satisfy_their_defining_tail_equations() -> None:
    """The definition, checked directly rather than through a reference table:
    at the lower bound, P(X >= s) equals the tail mass; at the upper,
    P(X <= s) does."""
    n, successes, confidence = 50, 12, 0.95
    tail = (1.0 - confidence) / 2.0
    low, high = clopper_pearson_interval(successes, n, confidence)
    assert 1.0 - binomial_tail_at_most(successes - 1, n, low) == pytest.approx(tail, abs=1e-6)
    assert binomial_tail_at_most(successes, n, high) == pytest.approx(tail, abs=1e-6)


def test_the_interval_refuses_impossible_arguments() -> None:
    with pytest.raises(ValueError, match="n_draws must be positive"):
        clopper_pearson_interval(0, 0, 0.95)
    with pytest.raises(ValueError, match=r"successes must be in"):
        clopper_pearson_interval(51, 50, 0.95)
    with pytest.raises(ValueError, match="confidence must be in"):
        clopper_pearson_interval(1, 50, 1.0)
