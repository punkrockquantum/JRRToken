"""Power analysis, run *before* a sweep, not after it.

Section 3, Tier S: "Power analysis before the run, stating the smallest effect
detectable at 80% power, and a comparison of that figure to the effect size
that would actually be meaningful. If detectable is far below meaningful, say
so numerically."

``DetectabilityComparison`` is the object that says it numerically. It emits a
ratio and no adjective.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from . import normal

DEFAULT_POWER = 0.80
DEFAULT_ALPHA = 0.05


# ---------------------------------------------------------------------------
# Bernoulli witness search: "does a witness exist among N independent draws?"
# The exact model for Module 1's sampled lower-bound probe.
# ---------------------------------------------------------------------------


def witness_power(n_draws: int, p_success: float) -> float:
    """P(at least one witness in n draws) = 1 - (1-p)^n."""
    if n_draws <= 0:
        raise ValueError("n_draws must be positive")
    if not 0.0 <= p_success <= 1.0:
        raise ValueError("p_success must be in [0,1]")
    return 1.0 - (1.0 - p_success) ** n_draws


def witness_min_detectable(n_draws: int, power: float = DEFAULT_POWER) -> float:
    """Smallest per-draw success probability detected at ``power``.

    Solves 1-(1-p)^n = power  =>  p = 1 - (1-power)^(1/n).
    """
    if n_draws <= 0:
        raise ValueError("n_draws must be positive")
    if not 0.0 < power < 1.0:
        raise ValueError("power must be in (0,1)")
    return 1.0 - (1.0 - power) ** (1.0 / n_draws)


def witness_draws_required(p_success: float, power: float = DEFAULT_POWER) -> int:
    """Smallest n with 1-(1-p)^n >= power."""
    if not 0.0 < p_success < 1.0:
        raise ValueError("p_success must be in (0,1)")
    if not 0.0 < power < 1.0:
        raise ValueError("power must be in (0,1)")
    return math.ceil(math.log(1.0 - power) / math.log(1.0 - p_success))


def zero_witness_upper_bound(n_draws: int, confidence: float = 0.95) -> float:
    """Exact one-sided Clopper-Pearson upper bound on p after 0 successes in n.

    p_upper = 1 - (1-confidence)^(1/n). This is what a Tier S null of the form
    "no witness found in N draws" is entitled to say, and nothing stronger.
    """
    if n_draws <= 0:
        raise ValueError("n_draws must be positive")
    if not 0.0 < confidence < 1.0:
        raise ValueError("confidence must be in (0,1)")
    return 1.0 - (1.0 - confidence) ** (1.0 / n_draws)


def binomial_tail_at_most(successes: int, n_draws: int, p: float) -> float:
    """P(X <= successes) for X ~ Binomial(n, p), summed exactly.

    ``math.comb`` is exact integer arithmetic, so the only error here is the
    floating-point powers -- there is no normal approximation and no continuity
    correction to argue about.
    """
    if not 0 <= successes <= n_draws:
        raise ValueError("successes must be in [0, n_draws]")
    if not 0.0 <= p <= 1.0:
        raise ValueError("p must be in [0,1]")
    return math.fsum(
        math.comb(n_draws, k) * p**k * (1.0 - p) ** (n_draws - k)
        for k in range(successes + 1)
    )


def clopper_pearson_interval(
    successes: int, n_draws: int, confidence: float = 0.95
) -> tuple[float, float]:
    """Exact two-sided Clopper-Pearson interval for a binomial proportion.

    ``zero_witness_upper_bound`` covers the one case a Tier S null needs -- zero
    successes -- in closed form. This covers the rest, which is what reporting an
    observed witness *rate* requires: a rate quoted without an interval is the
    single point section 3 forbids.

    Solved by bisection on the exact binomial tail rather than through an inverse
    incomplete beta, so the whole statistical layer stays standard-library only
    (D-004). The bounds are the standard ones: the lower is the largest p making
    P(X >= successes) no more than (1-confidence)/2, the upper the smallest p
    making P(X <= successes) no more than (1-confidence)/2.
    """
    if n_draws <= 0:
        raise ValueError("n_draws must be positive")
    if not 0 <= successes <= n_draws:
        raise ValueError("successes must be in [0, n_draws]")
    if not 0.0 < confidence < 1.0:
        raise ValueError("confidence must be in (0,1)")

    tail = (1.0 - confidence) / 2.0

    def bisect(predicate) -> float:
        lo, hi = 0.0, 1.0
        for _ in range(200):
            mid = (lo + hi) / 2.0
            if predicate(mid):
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2.0

    if successes == 0:
        lower = 0.0
    else:
        # P(X >= s | p) = 1 - P(X <= s-1 | p), increasing in p.
        lower = bisect(lambda p: 1.0 - binomial_tail_at_most(successes - 1, n_draws, p) <= tail)

    if successes == n_draws:
        upper = 1.0
    else:
        # P(X <= s | p) is decreasing in p, so bisect on its complement.
        upper = bisect(lambda p: binomial_tail_at_most(successes, n_draws, p) > tail)

    return lower, upper


# ---------------------------------------------------------------------------
# Normal-approximation power for a mean shift (the generic Tier S cell)
# ---------------------------------------------------------------------------


def one_sample_min_detectable_effect(
    n: int, *, alpha: float = DEFAULT_ALPHA, power: float = DEFAULT_POWER, two_sided: bool = True
) -> float:
    """Smallest standardised effect (Cohen's d) detected at ``power``."""
    if n <= 1:
        raise ValueError("n must exceed 1")
    z_alpha = normal.ppf(1.0 - (alpha / 2.0 if two_sided else alpha))
    z_beta = normal.ppf(power)
    return (z_alpha + z_beta) / math.sqrt(n)


def one_sample_power(
    n: int, effect: float, *, alpha: float = DEFAULT_ALPHA, two_sided: bool = True
) -> float:
    if n <= 1:
        raise ValueError("n must exceed 1")
    z_alpha = normal.ppf(1.0 - (alpha / 2.0 if two_sided else alpha))
    lam = abs(effect) * math.sqrt(n)
    return normal.sf(z_alpha - lam) + (normal.cdf(-z_alpha - lam) if two_sided else 0.0)


# ---------------------------------------------------------------------------
# The mandated comparison
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class DetectabilityComparison:
    """Detectable-at-80%-power versus meaningful, stated as a ratio."""

    metric: str
    n: int
    power: float
    min_detectable: float
    meaningful: float
    meaningful_derivation: str

    def __post_init__(self) -> None:
        if self.min_detectable <= 0.0 or self.meaningful <= 0.0:
            raise ValueError("min_detectable and meaningful must be positive")
        if not self.meaningful_derivation.strip():
            raise ValueError(
                "the meaningful effect size must state its derivation "
                "(prime directive 2.2: no thresholds chosen because they feel right)"
            )

    @property
    def ratio_meaningful_over_detectable(self) -> float:
        return self.meaningful / self.min_detectable

    def render(self) -> str:
        return (
            f"metric={self.metric} n={self.n} power={self.power:.2f} "
            f"min_detectable={self.min_detectable:.6g} meaningful={self.meaningful:.6g} "
            f"meaningful_over_detectable={self.ratio_meaningful_over_detectable:.4g} "
            f"meaningful_derivation={self.meaningful_derivation}"
        )
