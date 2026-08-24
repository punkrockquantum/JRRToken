"""Stage B: bound tightness under composition."""

from __future__ import annotations

import pytest

from core.targets import BlockRestrictedMap, IteratedPowerMap
from modules.degree.measure import degree_upper_bound, exact_degree
from verify.anf import algebraic_degree

ROUNDS = range(1, 9)


def test_the_iterated_map_is_a_genuine_composition() -> None:
    """Evaluated by iterating, not by the closed form it equals."""
    t = IteratedPowerMap.create(9, 3, 4)
    assert t.effective_exponent == pow(3, 4, 511)
    assert [t(x) for x in range(16)] == [
        IteratedPowerMap.create(9, 3, 4).field.pow(x, pow(3, 4, 511)) for x in range(16)
    ]


@pytest.mark.parametrize("n", (9, 11))
def test_iterated_exact_degree_matches_its_closed_form_and_verify(n: int) -> None:
    for r in ROUNDS:
        t = IteratedPowerMap.create(n, 3, r)
        assert exact_degree(t) == t.expected_degree == algebraic_degree(t, n, n), (n, r)


def test_the_exact_degree_of_a_composition_decreases_somewhere() -> None:
    """The property no monotone doubling bound can reproduce."""
    degrees = [exact_degree(IteratedPowerMap.create(9, 3, r)) for r in ROUNDS]
    assert any(b < a for a, b in zip(degrees, degrees[1:])), degrees


def test_the_naive_bound_is_monotone_and_therefore_cannot_track_it() -> None:
    bounds = [degree_upper_bound(IteratedPowerMap.create(9, 3, r)).value for r in ROUNDS]
    assert all(b >= a for a, b in zip(bounds, bounds[1:]))


@pytest.mark.parametrize("n", (9, 11))
def test_the_bound_stays_sound_under_composition(n: int) -> None:
    for r in ROUNDS:
        t = IteratedPowerMap.create(n, 3, r)
        assert degree_upper_bound(t).value >= exact_degree(t), (n, r)


def test_the_composed_gap_is_not_zero() -> None:
    """gap=0 on uncomposed controls validated the implementation, not this."""
    gaps = [
        degree_upper_bound(IteratedPowerMap.create(9, 3, r)).value
        - exact_degree(IteratedPowerMap.create(9, 3, r))
        for r in ROUNDS
    ]
    assert max(gaps) >= 4


# -- the known-ceiling control ---------------------------------------------


def test_the_block_restricted_map_never_exceeds_its_ceiling() -> None:
    for r in range(1, 8):
        b = BlockRestrictedMap.create(12, 5, 3, r)
        assert exact_degree(b) <= b.degree_ceiling, r
        assert exact_degree(b) == algebraic_degree(b, 12, 12)


def test_the_naive_bound_breaches_the_known_ceiling() -> None:
    """The bound exceeds a value that is a theorem about the target."""
    breaches = [
        r
        for r in range(1, 8)
        if degree_upper_bound(BlockRestrictedMap.create(12, 5, 3, r)).value
        > BlockRestrictedMap.create(12, 5, 3, r).degree_ceiling
    ]
    assert len(breaches) >= 4


def test_the_worst_composed_gap_reaches_ten_bits() -> None:
    gaps = [
        degree_upper_bound(BlockRestrictedMap.create(12, 5, 3, r)).value
        - exact_degree(BlockRestrictedMap.create(12, 5, 3, r))
        for r in range(1, 8)
    ]
    assert max(gaps) >= 10


def test_block_restriction_is_refused_outside_the_state() -> None:
    with pytest.raises(ValueError, match=r"active must lie"):
        BlockRestrictedMap.create(12, 13, 3, 1)


def test_composed_controls_refuse_out_of_range_inputs() -> None:
    for target, n in ((IteratedPowerMap.create(9, 3, 2), 9), (BlockRestrictedMap.create(12, 5, 3, 2), 12)):
        with pytest.raises(ValueError, match="out of range"):
            target(1 << n)


def test_zero_rounds_is_refused() -> None:
    with pytest.raises(ValueError, match="rounds must be at least 1"):
        IteratedPowerMap.create(9, 3, 0)
