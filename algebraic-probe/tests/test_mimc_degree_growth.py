"""MiMC's exact degree growth over GF(2^n), Tier E.

Why this file exists. Outside review argued that degree analysis for ARX is
mature and well-tooled, while the live, repeatedly-revised claims are in
arithmetisation-oriented land -- and named MiMC's degree growth turning out
linear rather than exponential as the example. That is checkable here, because
n = 9, 11 and 13 are all inside the module's exact-ANF guard.

These are the numbers the README quotes, so they are pinned here rather than left
to a paragraph. Every value is an exhaustive ANF computation over the whole input
space: Tier E, no sampling, no citation. The shape is measured in this repository
and reported as such -- it is deliberately *not* stated as agreement with any
published result, because the papers are behind the same egress block as E-04 and
Class 2 forbids substituting a value I derived for a published anchor.
"""

from __future__ import annotations

import pytest

from core.mimc import MiMC
from modules.degree.measure import exact_degree, mimc_bound, mimc_derived_bound
from verify import anf

#: Exact degree of r-round MiMC over GF(2^n), r = 1..10, by exhaustive ANF.
#: Regenerate with the loop in ``test_the_growth_sequence_is_what_is_committed``.
GROWTH = {
    9: (2, 2, 4, 4, 6, 8, 8, 8, 8, 8),
    11: (2, 2, 4, 4, 6, 8, 10, 10, 10, 10),
    13: (2, 2, 4, 4, 6, 8, 10, 10, 12, 12),
}

ROUNDS = tuple(range(1, 11))


def _measured(n: int) -> tuple[int, ...]:
    return tuple(exact_degree(MiMC.create(n=n, n_rounds=r, seed=0)) for r in ROUNDS)


@pytest.mark.parametrize("n", sorted(GROWTH))
def test_the_growth_sequence_is_what_is_committed(n: int) -> None:
    """The committed table must be what a fresh exhaustion produces."""
    assert _measured(n) == GROWTH[n]


@pytest.mark.parametrize("n", sorted(GROWTH))
def test_the_independent_path_agrees(n: int) -> None:
    """``verify/anf.py`` shares no code with the module's exact path."""
    for r in ROUNDS:
        target = MiMC.create(n=n, n_rounds=r, seed=0)
        assert anf.algebraic_degree(target, n, n) == GROWTH[n][r - 1], (n, r)


@pytest.mark.parametrize("n", sorted(GROWTH))
def test_growth_is_far_slower_than_doubling(n: int) -> None:
    """The substantive observation, stated as an inequality that could fail.

    Naive doubling predicts 2^r. If the exact degree tracked it, the two would
    saturate at the same round. They do not: doubling saturates at r = 3 or 4
    while the exact degree needs 6 to 9 rounds.
    """
    exact = GROWTH[n]
    doubling = tuple(min(2**r, n - 1) for r in ROUNDS)
    cap = n - 1

    first_exact_saturation = next(r for r, d in zip(ROUNDS, exact) if d >= cap)
    first_doubling_saturation = next(r for r, d in zip(ROUNDS, doubling) if d >= cap)

    assert first_exact_saturation > first_doubling_saturation + 2, (
        n,
        first_exact_saturation,
        first_doubling_saturation,
    )


@pytest.mark.parametrize("n", sorted(GROWTH))
def test_growth_before_saturation_is_approximately_linear(n: int) -> None:
    """Per-round increments stay bounded by a small constant before the cap.

    A doubling process has increments that grow without bound until it
    saturates; these do not. The assertion is on the increments rather than on a
    fitted slope, because an increment is a measurement and a slope is a model.
    """
    exact = GROWTH[n]
    cap = n - 1
    before = [d for d in exact if d < cap]
    increments = [b - a for a, b in zip(before, before[1:])]
    assert increments, (n, before)
    assert max(increments) <= 2, (n, increments)
    assert sum(increments) / len(increments) < 2.0, (n, increments)


@pytest.mark.parametrize("n", sorted(GROWTH))
def test_both_bounds_stay_sound_at_every_round(n: int) -> None:
    """Soundness, re-asserted here because this file is what the README cites."""
    for r in ROUNDS:
        target = MiMC.create(n=n, n_rounds=r, seed=0)
        exact = GROWTH[n][r - 1]
        assert mimc_bound(target).value >= exact, (n, r)
        assert mimc_derived_bound(target).value >= exact, (n, r)


def test_the_growth_prefix_is_the_same_across_field_sizes() -> None:
    """A measured regularity worth recording: until the permutation cap bites,
    the sequence does not depend on n."""
    shortest_cap = min(n - 1 for n in GROWTH)
    prefixes = {
        n: tuple(d for d in GROWTH[n] if d < shortest_cap) for n in sorted(GROWTH)
    }
    distinct = set(prefixes.values())
    assert len(distinct) == 1, prefixes


def test_the_rounds_given_up_by_doubling_is_three_to_five() -> None:
    """The number the report and README both quote."""
    given_up = {}
    for n, exact in GROWTH.items():
        cap = n - 1
        doubling = tuple(min(2**r, cap) for r in ROUNDS)
        given_up[n] = next(r for r, d in zip(ROUNDS, exact) if d >= cap) - next(
            r for r, d in zip(ROUNDS, doubling) if d >= cap
        )
    assert given_up == {9: 3, 11: 3, 13: 5}, given_up
