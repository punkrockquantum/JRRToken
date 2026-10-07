"""The standard-library normal distribution and p-value formatting."""

from __future__ import annotations

import math

import pytest

from stats import format_p
from stats import normal
from stats.pvalue import UNDERFLOW_FLOOR


def test_cdf_at_known_points() -> None:
    assert normal.cdf(0.0) == pytest.approx(0.5, abs=1e-15)
    # Phi(1.959963984540054) = 0.975 exactly to double precision.
    assert normal.cdf(1.959963984540054) == pytest.approx(0.975, abs=1e-12)
    assert normal.cdf(-1.959963984540054) == pytest.approx(0.025, abs=1e-12)
    assert normal.cdf(1.2815515655446004) == pytest.approx(0.9, abs=1e-12)


def test_sf_avoids_cancellation_in_the_tail() -> None:
    assert normal.sf(8.0) == pytest.approx(6.220960574271786e-16, rel=1e-9)
    assert normal.sf(0.0) == pytest.approx(0.5, abs=1e-15)


def test_pdf_at_zero() -> None:
    assert normal.pdf(0.0) == pytest.approx(1.0 / math.sqrt(2 * math.pi), abs=1e-15)


def test_ppf_round_trips_through_cdf() -> None:
    for p in (1e-8, 1e-4, 0.001, 0.01, 0.025, 0.1, 0.3, 0.5, 0.7, 0.9, 0.975, 0.999, 1 - 1e-8):
        assert normal.cdf(normal.ppf(p)) == pytest.approx(p, rel=1e-12, abs=1e-15)


def test_ppf_known_quantiles() -> None:
    assert normal.ppf(0.975) == pytest.approx(1.959963984540054, rel=1e-12)
    assert normal.ppf(0.8) == pytest.approx(0.8416212335729143, rel=1e-12)
    assert normal.ppf(0.5) == pytest.approx(0.0, abs=1e-12)


def test_ppf_rejects_out_of_range() -> None:
    for bad in (0.0, 1.0, -0.1, 1.1):
        with pytest.raises(ValueError):
            normal.ppf(bad)


def test_underflowed_p_values_never_print_as_zero() -> None:
    assert format_p(0.0) == "p < 1e-300"
    assert format_p(UNDERFLOW_FLOOR / 10) == "p < 1e-300"
    assert "0.00e+00" not in format_p(0.0)


def test_representable_p_values_print_in_full() -> None:
    assert format_p(0.05) == "p=5.000000e-02"
    assert format_p(1e-200) == "p=1.000000e-200"


def test_out_of_range_p_raises() -> None:
    with pytest.raises(ValueError):
        format_p(1.5)
