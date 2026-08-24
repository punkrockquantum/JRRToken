"""Standard normal pdf/cdf/quantile, standard library only.

No third-party dependency (DECISIONS.md D-004), so these are written out and
pinned against published values in tests/test_stats_normal.py.
"""

from __future__ import annotations

import math

SQRT_2 = math.sqrt(2.0)
SQRT_2PI = math.sqrt(2.0 * math.pi)


def pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / SQRT_2PI


def cdf(x: float) -> float:
    return 0.5 * math.erfc(-x / SQRT_2)


def sf(x: float) -> float:
    """Survival function 1 - cdf(x), computed without cancellation."""
    return 0.5 * math.erfc(x / SQRT_2)


# Acklam's rational approximation to the inverse normal CDF, refined by one
# Halley step against math.erfc. Relative accuracy after refinement is below
# 1e-14 over the tested range; test_stats_normal.py checks round-tripping.
_A = (
    -3.969683028665376e01,
    2.209460984245205e02,
    -2.759285104469687e02,
    1.383577518672690e02,
    -3.066479806614716e01,
    2.506628277459239e00,
)
_B = (
    -5.447609879822406e01,
    1.615858368580409e02,
    -1.556989798598866e02,
    6.680131188771972e01,
    -1.328068155288572e01,
)
_C = (
    -7.784894002430293e-03,
    -3.223964580411365e-01,
    -2.400758277161838e00,
    -2.549732539343734e00,
    4.374664141464968e00,
    2.938163982698783e00,
)
_D = (
    7.784695709041462e-03,
    3.224671290700398e-01,
    2.445134137142996e00,
    3.754408661907416e00,
)
_P_LOW = 0.02425
_P_HIGH = 1.0 - _P_LOW


def ppf(p: float) -> float:
    """Inverse CDF (quantile function)."""
    if not 0.0 < p < 1.0:
        raise ValueError(f"ppf requires 0 < p < 1, got {p!r}")
    if p < _P_LOW:
        q = math.sqrt(-2.0 * math.log(p))
        x = (((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q + _C[4]) * q + _C[5]) / (
            (((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1.0
        )
    elif p <= _P_HIGH:
        q = p - 0.5
        r = q * q
        x = (((((_A[0] * r + _A[1]) * r + _A[2]) * r + _A[3]) * r + _A[4]) * r + _A[5]) * q / (
            ((((_B[0] * r + _B[1]) * r + _B[2]) * r + _B[3]) * r + _B[4]) * r + 1.0
        )
    else:
        q = math.sqrt(-2.0 * math.log(1.0 - p))
        x = -(((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q + _C[4]) * q + _C[5]) / (
            (((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1.0
        )
    # One Halley refinement step.
    e = cdf(x) - p
    u = e * SQRT_2PI * math.exp(x * x / 2.0)
    return x - u / (1.0 + x * u / 2.0)
