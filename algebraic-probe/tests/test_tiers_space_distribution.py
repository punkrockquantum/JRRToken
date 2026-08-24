"""Tier E spaces and Tier S distributions carry what section 3 requires."""

from __future__ import annotations

import pytest

from tiers import PREFERRED_SEEDS, EnumeratedSpace, SamplingError, SeedDistribution, SpaceError


def test_space_requires_a_description_and_a_universe() -> None:
    with pytest.raises(SpaceError):
        EnumeratedSpace(
            description="  ", cardinality=4, full_cardinality=8, universe_description="u"
        )
    with pytest.raises(SpaceError):
        EnumeratedSpace(description="d", cardinality=4, full_cardinality=8, universe_description="")


def test_space_cannot_exceed_its_universe() -> None:
    with pytest.raises(SpaceError, match="full_cardinality"):
        EnumeratedSpace(
            description="d", cardinality=16, full_cardinality=8, universe_description="u"
        )


def test_space_fraction_is_exact() -> None:
    space = EnumeratedSpace(
        description="d", cardinality=1 << 20, full_cardinality=1 << 512, universe_description="u"
    )
    assert space.fraction.numerator == 1
    assert space.fraction.denominator == 1 << 492
    assert space.log2_fraction == pytest.approx(-492.0)


def test_distribution_enforces_the_seed_minimum() -> None:
    with pytest.raises(SamplingError, match="at least 30"):
        SeedDistribution(seeds=tuple(range(29)), values=tuple(float(i) for i in range(29)))


def test_distribution_rejects_repeated_seeds() -> None:
    seeds = tuple([0, 0] + list(range(1, 29)))
    with pytest.raises(SamplingError, match="distinct"):
        SeedDistribution(seeds=seeds, values=tuple(float(i) for i in range(30)))


def test_distribution_flags_below_preferred() -> None:
    small = SeedDistribution(seeds=tuple(range(30)), values=tuple(float(i) for i in range(30)))
    assert not small.meets_preferred
    assert f"seeds_below_preferred={PREFERRED_SEEDS}" in small.render()
    big = SeedDistribution(seeds=tuple(range(50)), values=tuple(float(i) for i in range(50)))
    assert big.meets_preferred


def test_quantiles_match_hand_computed_values() -> None:
    values = tuple(float(i) for i in range(1, 41))  # 1..40
    dist = SeedDistribution(seeds=tuple(range(40)), values=values)
    # Type-7 quantiles over 1..40: position = (n-1)*q
    assert dist.median == pytest.approx(20.5)
    assert dist.q1 == pytest.approx(10.75)
    assert dist.q3 == pytest.approx(30.25)
    assert dist.iqr == pytest.approx(19.5)
    assert dist.minimum == 1.0
    assert dist.maximum == 40.0


def test_censoring_flags_are_retained_and_reported() -> None:
    censored = tuple(i >= 45 for i in range(50))
    dist = SeedDistribution(
        seeds=tuple(range(50)),
        values=tuple(float(i) for i in range(50)),
        censored=censored,
    )
    assert dist.n_censored == 5
    assert "censored=5/50" in dist.render()


def test_raw_values_are_retained() -> None:
    dist = SeedDistribution(seeds=tuple(range(30)), values=tuple(float(i) for i in range(30)))
    assert dist.to_dict()["values"] == [float(i) for i in range(30)]
    assert dist.to_dict()["seeds"] == list(range(30))
