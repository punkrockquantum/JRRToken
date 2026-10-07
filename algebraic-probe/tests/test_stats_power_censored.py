"""Power analysis and censored regression."""

from __future__ import annotations

import math
import random

import pytest

from stats.censored import fit_both, ols_fit, tobit_fit
from stats.power import (
    DetectabilityComparison,
    one_sample_min_detectable_effect,
    one_sample_power,
    witness_draws_required,
    witness_min_detectable,
    witness_power,
    zero_witness_upper_bound,
)


def test_witness_power_matches_the_closed_form() -> None:
    assert witness_power(50, 0.05) == pytest.approx(1 - 0.95**50)
    assert witness_power(1, 0.3) == pytest.approx(0.3)


def test_min_detectable_at_80_percent_power_with_50_seeds() -> None:
    value = witness_min_detectable(50, 0.80)
    assert value == pytest.approx(1 - 0.2 ** (1 / 50))
    assert value == pytest.approx(0.03167621427, rel=1e-9)


def test_min_detectable_and_power_are_inverses() -> None:
    p = witness_min_detectable(50, 0.80)
    assert witness_power(50, p) == pytest.approx(0.80)


def test_draws_required_is_the_smallest_n_that_reaches_the_power() -> None:
    n = witness_draws_required(0.05, 0.80)
    assert witness_power(n, 0.05) >= 0.80
    assert witness_power(n - 1, 0.05) < 0.80


def test_zero_witness_upper_bound_is_clopper_pearson() -> None:
    assert zero_witness_upper_bound(50, 0.95) == pytest.approx(1 - 0.05 ** (1 / 50))
    assert zero_witness_upper_bound(50, 0.95) == pytest.approx(0.05815507912, rel=1e-9)


def test_the_probe_is_powerless_beyond_dimension_four_at_fifty_seeds() -> None:
    """The pre-registered consequence in PREREG-M1 section 9.1, recomputed here."""
    detectable = witness_min_detectable(50, 0.80)
    assert 2.0**-4 >= detectable
    assert 2.0**-5 < detectable


def test_one_sample_power_round_trip() -> None:
    effect = one_sample_min_detectable_effect(64, alpha=0.05, power=0.80)
    assert one_sample_power(64, effect, alpha=0.05) == pytest.approx(0.80, abs=1e-6)


def test_detectability_comparison_states_the_ratio() -> None:
    comparison = DetectabilityComparison(
        metric="witness_probability",
        n=50,
        power=0.80,
        min_detectable=witness_min_detectable(50, 0.80),
        meaningful=2.0**-8,
        meaningful_derivation="Schwartz-Zippel floor 2^-k at probe dimension k = 8",
    )
    assert comparison.ratio_meaningful_over_detectable == pytest.approx(0.1233180823, rel=1e-8)
    assert "meaningful_over_detectable=0.1233" in comparison.render()


def test_a_meaningful_effect_without_a_derivation_is_refused() -> None:
    with pytest.raises(ValueError, match="derivation"):
        DetectabilityComparison(
            metric="m",
            n=50,
            power=0.8,
            min_detectable=0.03,
            meaningful=0.5,
            meaningful_derivation="   ",
        )


# ---------------------------------------------------------------------------
# Censored regression
# ---------------------------------------------------------------------------

TRUE_INTERCEPT = 2.0
TRUE_SLOPE = 0.5
# Chosen so that censoring bites across the whole range of x rather than only at
# its top end: with a ceiling that only the largest x values reach, the surviving
# uncensored subsample is barely truncated and a fit that simply discards
# censored observations looks correct. It is not, and this fixture shows it.
TRUE_SIGMA = 5.0
CENSOR_LIMIT = 10.0


def simulated_run(seed: int = 20260824, n: int = 120):
    rng = random.Random(seed)
    xs = [i * 0.5 for i in range(n)]
    latent = [TRUE_INTERCEPT + TRUE_SLOPE * x + rng.gauss(0.0, TRUE_SIGMA) for x in xs]
    observed = [min(y, CENSOR_LIMIT) for y in latent]
    censored = [y >= CENSOR_LIMIT for y in latent]
    return xs, observed, censored


def test_censoring_is_actually_present_in_the_fixture() -> None:
    xs, _, censored = simulated_run()
    assert 0 < sum(censored) < len(censored)
    # censoring reaches the low-x half too, not only the tail
    half = len(xs) // 2
    assert any(censored[:half])


def test_discarding_censored_observations_is_not_the_same_as_modelling_them() -> None:
    """The censored observations carry information: a fit that keeps only the
    uncensored rows is attenuated, and the Tobit fit is not."""
    xs, ys, censored = simulated_run()
    kept_x = [x for x, c in zip(xs, censored) if not c]
    kept_y = [y for y, c in zip(ys, censored) if not c]
    uncensored_only = ols_fit(kept_x, kept_y)
    tobit = tobit_fit(xs, ys, censored, limits=[CENSOR_LIMIT] * len(xs))
    assert abs(uncensored_only.slope - TRUE_SLOPE) > 0.15
    assert abs(tobit.slope - TRUE_SLOPE) < 0.05
    assert tobit.slope > uncensored_only.slope + 0.15


def test_tobit_recovers_the_generating_slope_and_ols_does_not() -> None:
    xs, ys, censored = simulated_run()
    tobit = tobit_fit(xs, ys, censored, limits=[CENSOR_LIMIT] * len(xs))
    ols = ols_fit(xs, ys, n_censored=sum(censored))
    assert tobit.slope == pytest.approx(TRUE_SLOPE, rel=0.10)
    # 86 of 120 observations are censored, so intercept and scale are recovered
    # with correspondingly wider sampling error than the slope.
    assert tobit.intercept == pytest.approx(TRUE_INTERCEPT, abs=1.5)
    assert tobit.sigma == pytest.approx(TRUE_SIGMA, rel=0.25)
    assert abs(ols.slope - TRUE_SLOPE) > abs(tobit.slope - TRUE_SLOPE)
    assert ols.slope < tobit.slope  # naive OLS is attenuated by the ceiling


def test_fit_both_reports_the_shift_between_the_two_fits() -> None:
    xs, ys, censored = simulated_run()
    comparison = fit_both(xs, ys, censored, limits=[CENSOR_LIMIT] * len(xs))
    assert comparison.slope_shift_pct > 20.0
    rendered = comparison.render()
    assert "method=ols-naive" in rendered
    assert "method=tobit-right-censored" in rendered
    assert "slope_shift_tobit_vs_ols_pct=" in rendered


def test_tobit_matches_ols_when_nothing_is_censored() -> None:
    xs, ys, _ = simulated_run()
    uncensored = [False] * len(xs)
    tobit = tobit_fit(xs, ys, uncensored)
    ols = ols_fit(xs, ys)
    assert tobit.slope == pytest.approx(ols.slope, rel=1e-3)


def test_a_fully_censored_sample_is_refused() -> None:
    xs = [float(i) for i in range(10)]
    with pytest.raises(ValueError, match="not identified"):
        tobit_fit(xs, [1.0] * 10, [True] * 10)


def test_tobit_loglik_beats_ols_loglik_on_censored_data() -> None:
    xs, ys, censored = simulated_run()
    tobit = tobit_fit(xs, ys, censored, limits=[CENSOR_LIMIT] * len(xs))
    assert math.isfinite(tobit.loglik)
    assert tobit.converged
