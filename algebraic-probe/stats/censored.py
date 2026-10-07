"""Censored (Tobit) regression for time-budget-censored runs, with OLS alongside.

Section 3, Tier S: "Where runs are time-budget-censored, fit with censored
(Tobit) regression, not naive OLS, and report both. In the prior work censoring
correction shifted slopes by up to 239%."

Model (Tobit type I, right-censoring, which is what a wall-clock budget
produces):

    y*_i = b0 + b1 x_i + e_i,   e_i ~ N(0, sigma^2)
    observed y_i = y*_i               if y*_i <  c_i   (run finished)
                 = c_i, flagged       if y*_i >= c_i   (budget hit)

Log-likelihood:

    sum_{uncensored} [ -log sigma + log phi((y_i - mu_i)/sigma) ]
  + sum_{censored}   [ log Phi((mu_i - c_i)/sigma) ]
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

from . import normal
from .optimize import nelder_mead

_LOG_TINY = -745.0  # log of the smallest positive normal double, floor for log(0)


@dataclass(frozen=True, slots=True)
class LinearFit:
    intercept: float
    slope: float
    sigma: float
    loglik: float
    n: int
    n_censored: int
    method: str
    converged: bool

    def render(self) -> str:
        return (
            f"method={self.method} intercept={self.intercept:.6g} slope={self.slope:.6g} "
            f"sigma={self.sigma:.6g} loglik={self.loglik:.6g} n={self.n} "
            f"n_censored={self.n_censored} converged={self.converged}"
        )


@dataclass(frozen=True, slots=True)
class CensoredComparison:
    """Both fits, and the shift between them. Reporting one alone is the bug."""

    ols: LinearFit
    tobit: LinearFit

    @property
    def slope_shift_pct(self) -> float:
        if self.ols.slope == 0.0:
            return float("inf")
        return 100.0 * (self.tobit.slope - self.ols.slope) / abs(self.ols.slope)

    def render(self) -> str:
        return (
            f"{self.ols.render()}\n{self.tobit.render()}\n"
            f"slope_shift_tobit_vs_ols_pct={self.slope_shift_pct:.4g}"
        )


def ols_fit(x: Sequence[float], y: Sequence[float], n_censored: int = 0) -> LinearFit:
    n = len(x)
    if n != len(y):
        raise ValueError("x and y must be the same length")
    if n < 3:
        raise ValueError("need at least 3 observations")
    mean_x = sum(x) / n
    mean_y = sum(y) / n
    sxx = sum((xi - mean_x) ** 2 for xi in x)
    if sxx == 0.0:
        raise ValueError("x has zero variance; slope is not identified")
    sxy = sum((xi - mean_x) * (yi - mean_y) for xi, yi in zip(x, y))
    slope = sxy / sxx
    intercept = mean_y - slope * mean_x
    resid = [yi - (intercept + slope * xi) for xi, yi in zip(x, y)]
    dof = max(n - 2, 1)
    sigma = math.sqrt(sum(r * r for r in resid) / dof)
    loglik = sum(
        -math.log(sigma) - 0.5 * math.log(2 * math.pi) - 0.5 * (r / sigma) ** 2 for r in resid
    )
    return LinearFit(
        intercept=intercept,
        slope=slope,
        sigma=sigma,
        loglik=loglik,
        n=n,
        n_censored=n_censored,
        method="ols-naive",
        converged=True,
    )


def _safe_log(value: float) -> float:
    return math.log(value) if value > 0.0 else _LOG_TINY


def tobit_fit(
    x: Sequence[float],
    y: Sequence[float],
    censored: Sequence[bool],
    limits: Sequence[float] | None = None,
) -> LinearFit:
    """Right-censored Tobit MLE. ``limits`` defaults to the observed y values."""
    n = len(x)
    if not (n == len(y) == len(censored)):
        raise ValueError("x, y and censored must be the same length")
    if n < 3:
        raise ValueError("need at least 3 observations")
    limit = list(limits) if limits is not None else list(y)
    if len(limit) != n:
        raise ValueError("limits must align with observations")
    if all(censored):
        raise ValueError("every observation is censored; the model is not identified")

    def negative_loglik(params: Sequence[float]) -> float:
        b0, b1, log_sigma = params
        sigma = math.exp(log_sigma)
        if not math.isfinite(sigma) or sigma <= 0.0:
            return float("inf")
        total = 0.0
        for xi, yi, ci, is_cens in zip(x, y, limit, censored):
            mu = b0 + b1 * xi
            if is_cens:
                total += _safe_log(normal.cdf((mu - ci) / sigma))
            else:
                z = (yi - mu) / sigma
                total += -log_sigma - 0.5 * math.log(2 * math.pi) - 0.5 * z * z
        return -total if math.isfinite(total) else float("inf")

    start_uncensored_x = [xi for xi, c in zip(x, censored) if not c]
    start_uncensored_y = [yi for yi, c in zip(y, censored) if not c]
    if len(start_uncensored_x) >= 3 and len(set(start_uncensored_x)) > 1:
        seed = ols_fit(start_uncensored_x, start_uncensored_y)
    else:
        seed = ols_fit(x, y)
    x0 = (seed.intercept, seed.slope, math.log(max(seed.sigma, 1e-8)))

    best = nelder_mead(negative_loglik, x0, step=0.25, max_iter=20000)
    # A second pass from the first solution tightens the simplex; deterministic.
    best = nelder_mead(negative_loglik, best.x, step=0.02, max_iter=20000)

    b0, b1, log_sigma = best.x
    return LinearFit(
        intercept=b0,
        slope=b1,
        sigma=math.exp(log_sigma),
        loglik=-best.fun,
        n=n,
        n_censored=sum(1 for c in censored if c),
        method="tobit-right-censored",
        converged=best.converged,
    )


def fit_both(
    x: Sequence[float],
    y: Sequence[float],
    censored: Sequence[bool],
    limits: Sequence[float] | None = None,
) -> CensoredComparison:
    return CensoredComparison(
        ols=ols_fit(x, y, n_censored=sum(1 for c in censored if c)),
        tobit=tobit_fit(x, y, censored, limits),
    )
