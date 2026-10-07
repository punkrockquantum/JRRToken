"""Tier label integrity: section 3 of the brief, enforced rather than described."""

from __future__ import annotations

import pytest

from tiers import (
    EnumeratedSpace,
    Provenance,
    ProvenanceError,
    Result,
    ResultSet,
    SeedDistribution,
    Tier,
    TierViolation,
    enumerated,
    mean_value,
    prove,
    sampled,
)

PROV = Provenance(computation_id="TEST-001")


def a_space() -> EnumeratedSpace:
    return EnumeratedSpace(
        description="all 2^10 messages with the low 502 bits fixed",
        cardinality=1 << 10,
        full_cardinality=1 << 512,
        universe_description="the full 512-bit message block",
    )


def a_distribution(n: int = 30, offset: float = 0.0) -> SeedDistribution:
    return SeedDistribution(
        seeds=tuple(range(n)),
        values=tuple(float(i) + offset for i in range(n)),
    )


def test_result_cannot_be_constructed_by_hand() -> None:
    with pytest.raises(TierViolation, match="minted"):
        Result(
            tier=Tier.P,
            metric="d_ub",
            value=3,
            provenance=PROV,
            target="t",
        )


def test_factories_assign_the_tier() -> None:
    assert prove(metric="d_ub", value=3, target="t", provenance=PROV, derivation="d").tier is Tier.P
    assert (
        enumerated(metric="d", value=3, target="t", provenance=PROV, space=a_space()).tier is Tier.E
    )
    assert (
        sampled(metric="d", target="t", provenance=PROV, distribution=a_distribution()).tier
        is Tier.S
    )


def test_tier_p_requires_a_derivation() -> None:
    with pytest.raises(TierViolation, match="deductive argument"):
        prove(metric="d_ub", value=3, target="t", provenance=PROV, derivation="   ")


def test_provenance_is_mandatory() -> None:
    with pytest.raises(ProvenanceError, match="computation id or a citation key"):
        Provenance()


def test_tier_label_cannot_be_reassigned() -> None:
    result = prove(metric="d", value=1, target="t", provenance=PROV, derivation="d")
    with pytest.raises(TierViolation, match="upgraded or reassigned"):
        result.tier = Tier.S  # type: ignore[misc]
    with pytest.raises(TierViolation, match="no relabel operation"):
        result.relabel(Tier.S)


def test_result_is_immutable() -> None:
    result = prove(metric="d", value=1, target="t", provenance=PROV, derivation="d")
    with pytest.raises(TierViolation, match="immutable"):
        result.value = 2  # type: ignore[misc]


def test_cross_tier_combination_raises() -> None:
    p = prove(metric="d", value=1, target="t", provenance=PROV, derivation="d")
    e = enumerated(metric="d", value=1, target="t", provenance=PROV, space=a_space())
    s = sampled(metric="d", target="t", provenance=PROV, distribution=a_distribution())
    for left, right in ((p, e), (p, s), (e, s)):
        with pytest.raises(TierViolation, match="different tiers"):
            left + right
        with pytest.raises(TierViolation, match="different tiers"):
            left < right
        with pytest.raises(TierViolation, match="different tiers"):
            left >= right


def test_cross_tier_averaging_raises() -> None:
    p = prove(metric="d", value=1, target="t", provenance=PROV, derivation="d")
    e = enumerated(metric="d", value=2, target="t", provenance=PROV, space=a_space())
    with pytest.raises(TierViolation, match="different tiers"):
        mean_value([p, e])
    with pytest.raises(TierViolation, match="different tiers"):
        ResultSet(results=(p, e))


def test_same_tier_comparison_is_allowed() -> None:
    low = enumerated(metric="d", value=1, target="t", provenance=PROV, space=a_space())
    high = enumerated(metric="d", value=2, target="t", provenance=PROV, space=a_space())
    assert low < high
    assert high >= low
    assert mean_value([low, high]) == pytest.approx(1.5)


def test_arithmetic_on_results_is_refused_even_within_a_tier() -> None:
    a = enumerated(metric="d", value=1, target="t", provenance=PROV, space=a_space())
    b = enumerated(metric="d", value=2, target="t", provenance=PROV, space=a_space())
    with pytest.raises(TierViolation, match="Arithmetic on Result"):
        a + b


def test_combining_a_result_with_a_bare_number_raises() -> None:
    a = prove(metric="d", value=1, target="t", provenance=PROV, derivation="d")
    with pytest.raises(TierViolation, match="carry no tier label"):
        a + 1


def test_tier_p_does_not_accumulate_repetitions() -> None:
    p = prove(metric="d", value=1, target="t", provenance=PROV, derivation="d")
    with pytest.raises(TierViolation, match="thousandth run"):
        p.with_repetitions(1000)


def test_tier_s_may_record_repetitions() -> None:
    s = sampled(metric="d", target="t", provenance=PROV, distribution=a_distribution())
    assert s.with_repetitions(3).payload["repetitions"] == 3


def test_averaging_proofs_raises() -> None:
    p1 = prove(metric="d", value=1, target="t", provenance=PROV, derivation="d")
    p2 = prove(metric="d", value=2, target="t", provenance=PROV, derivation="d")
    with pytest.raises(TierViolation, match="does not have a mean"):
        mean_value([p1, p2])


def test_tiers_are_not_ordered() -> None:
    with pytest.raises(TypeError, match="not ordered"):
        Tier.P < Tier.S


def test_tier_e_render_carries_the_space_on_the_same_line() -> None:
    result = enumerated(
        metric="collision_found", value=False, target="t", provenance=PROV, space=a_space()
    )
    line = result.render()
    assert "\n" not in line
    assert "value=False" in line
    assert "|space|=1024" in line
    assert "universe=" in line
    assert "fraction=2^-502" in line


def test_tier_s_render_never_collapses_to_one_point() -> None:
    result = sampled(
        metric="trail_weight", target="t", provenance=PROV, distribution=a_distribution(50)
    )
    line = result.render()
    for field in ("n_seeds=50", "median=", "IQR=[", "min=", "max="):
        assert field in line
