"""The landscape blindness class, run against the exhaustive measures.

Section 6(c): the class is implemented and run, not asserted. Both measures are
injected here so ``modules/`` and ``verify/`` stay independent, exactly as the
three earlier blindness tests do it.

The demonstration has two halves and both must hold. The degree measure must
return the *same* answer for the hierarchical landscape and the structureless
one -- blindness is an inability to separate, not merely saturation on each. And
the overlap distribution must separate them -- otherwise the counterexample
carries no structure and the class is vacuous.
"""

from __future__ import annotations

import pytest

from core.landscape import HierarchicalEnergy
from modules.degree.blindness import landscape_geometry as blind
from verify import landscape as L
from verify import packed

N = 12
SEED = 20260920
OUTER_WEIGHT = 0.7
N_LOWEST = 64


def _degree(target) -> tuple[int, int]:
    """(max, min) exact degree over output bits, exhaustive."""
    columns = packed.pack_truth_table(target, target.n_in, target.n_out)
    profile = packed.degree_profile_from_columns(columns, target.n_in)
    return max(profile), min(profile)


def _mean_overlap(target) -> float:
    values = L.energies(target.energy, target.n_in)
    return L.overlap_distribution(values, target.n_in, N_LOWEST).mean


# -- the demonstration -------------------------------------------------------


@pytest.mark.parametrize("n_outer", [2, 4, 6])
def test_the_class_returns_the_same_null_while_carrying_structure(n_outer: int) -> None:
    outcome = blind.check(
        _degree,
        _mean_overlap,
        n=N,
        n_outer=n_outer,
        outer_weight=OUTER_WEIGHT,
        seed=SEED,
        test_id=f"BLIND-M1-LANDSCAPE-{n_outer}",
        computation_id="M1-LANDSCAPE-001",
    )
    assert outcome.passed, outcome.observed
    assert "same_null=True" in outcome.observed
    assert "structure_present=True" in outcome.observed


def test_the_degree_measure_cannot_separate_the_two_regimes() -> None:
    """Stated directly, not only through the blindness wrapper."""
    hierarchical = blind.counterexample(N, 4, OUTER_WEIGHT, SEED)
    structureless = blind.control(N, SEED)
    assert _degree(hierarchical) == _degree(structureless)


def test_the_overlap_measure_does_separate_them() -> None:
    """The other half. Without this the class would be vacuous."""
    hierarchical = blind.counterexample(N, 4, OUTER_WEIGHT, SEED)
    structureless = blind.control(N, SEED)
    assert _mean_overlap(hierarchical) > _mean_overlap(structureless) + 0.02


def test_the_control_sits_at_the_structureless_prediction() -> None:
    """The single-level model must actually be structureless, or the contrast
    is with the wrong thing."""
    structureless = blind.control(N, SEED)
    assert abs(_mean_overlap(structureless)) < 0.05
    values = L.energies(structureless.energy, N)
    observed = len(L.local_minima(values, N))
    predicted = L.expected_local_minima_iid(N)
    assert 0.85 < observed / predicted < 1.15, (observed, predicted)


# -- the predicates ----------------------------------------------------------


def test_the_null_predicate_requires_identical_profiles() -> None:
    assert blind.null_predicate((12, 11), (12, 11)) is True
    assert blind.null_predicate((12, 11), (12, 10)) is False
    assert blind.null_predicate((12, 11), (11, 11)) is False


def test_the_structure_predicate_requires_a_margin() -> None:
    assert blind.structure_predicate(0.13, 0.00) is True
    assert blind.structure_predicate(0.01, 0.00) is False, "inside the margin"
    assert blind.structure_predicate(0.00, 0.13) is False


# -- the falsifier -----------------------------------------------------------


def test_a_degree_measure_that_separated_them_would_fail_the_class() -> None:
    """The class is falsifiable, and this is what falsifying it looks like.

    If the degree profile differed between the two regimes, the instrument would
    be sensitive to landscape geometry and there would be no blindness to record.
    """
    separating = lambda t: (t.n_outer, 0)  # noqa: E731 - a measure that sees the hierarchy
    outcome = blind.check(
        separating,
        _mean_overlap,
        n=N,
        n_outer=4,
        outer_weight=OUTER_WEIGHT,
        seed=SEED,
        test_id="BLIND-M1-LANDSCAPE-FALSIFIER",
        computation_id="M1-LANDSCAPE-001",
    )
    assert outcome.passed is False
    assert "same_null=False" in outcome.observed


def test_a_counterexample_without_structure_would_fail_the_class() -> None:
    """The other way it can fail: the measures agree, but there is nothing there."""
    outcome = blind.check(
        _degree,
        lambda t: 0.0,  # an overlap measure that reports no clustering anywhere
        n=N,
        n_outer=4,
        outer_weight=OUTER_WEIGHT,
        seed=SEED,
        test_id="BLIND-M1-LANDSCAPE-VACUOUS",
        computation_id="M1-LANDSCAPE-001",
    )
    assert outcome.passed is False
    assert "structure_present=False" in outcome.observed


# -- the construction --------------------------------------------------------


def test_the_two_models_are_refused_when_mislabelled() -> None:
    with pytest.raises(ValueError, match="must carry weight 0"):
        HierarchicalEnergy.create(10, n_outer=0, outer_weight=0.5)
    with pytest.raises(ValueError, match="wearing a hierarchy's label"):
        HierarchicalEnergy.create(10, n_outer=3, outer_weight=0.0)
    with pytest.raises(ValueError, match=r"n_outer must be in \[0, n\)"):
        HierarchicalEnergy.create(10, n_outer=10, outer_weight=0.5)


def test_the_boolean_view_stays_in_range() -> None:
    target = blind.counterexample(10, 3, OUTER_WEIGHT, SEED)
    for x in range(1 << 10):
        assert 0 <= target(x) < (1 << target.m)


def test_states_in_a_block_share_a_cluster() -> None:
    target = blind.counterexample(10, 3, OUTER_WEIGHT, SEED)
    assert target.n_clusters == 8
    assert target.cluster_of(0b0000000000) == 0
    assert target.cluster_of(0b1110000000) == 7
    assert target.cluster_of(0b1110000001) == 7
    assert blind.control(10, SEED).cluster_of(0b1110000001) == 0


def test_the_predicted_density_fluctuation_shrinks_with_cluster_count() -> None:
    """The quantity that explains why the density of states stops separating."""
    previous = None
    for n_outer in (2, 4, 6, 8):
        target = blind.counterexample(14, n_outer, OUTER_WEIGHT, SEED)
        value = target.density_of_states_mean_fluctuation
        assert value == pytest.approx((OUTER_WEIGHT / target.n_clusters) ** 0.5)
        if previous is not None:
            assert value < previous
        previous = value
    assert blind.control(14, SEED).density_of_states_mean_fluctuation == 0.0
