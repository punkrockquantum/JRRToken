"""Module 3's measurement path: differential characteristics.

Section 9 declares the quantity as "characteristic probability and step count"
and the tiers as **E and S**. This is the first module in the repository whose
declared tiers include S, and therefore the first place the statistical layer has
anything to do: a differential probability estimated from samples is exactly the
object a confidence interval and a multiple-testing correction were built for.

Three quantities:

  ``differential_probability``  Tier E where the input space is exhaustible:
                                count the inputs satisfying
                                ``f(x) ^ f(x ^ din) == dout`` and divide. Exact,
                                no estimate.

  ``sampled_probability``       Tier S otherwise: draw seeds, count hits, report
                                the rate with an exact Clopper-Pearson interval.
                                Never a bare point estimate.

  ``characteristic_steps``      The rounds a characteristic covers while its
                                probability stays above the random level. A
                                count, not a probability.

What a differential probability is not. It is the probability for *one* pair
``(din, dout)``. A target can have every full-output differential at the random
level and still carry a truncated differential of probability 1 on a subset of
output bits -- ``blindness/truncated.py`` exhibits exactly that. So this module
reports a probability for a stated pair and never claims the target has no
exploitable differential.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any, Sequence

from stats.power import clopper_pearson_interval
from tiers.errors import ProbeError

#: 2^n evaluations per differential. Above this the exact path refuses rather
#: than silently switching to an estimate. Raising it is a deliberate act,
#: recorded in DECISIONS.md.
MAX_EXACT_DIFFERENTIAL_VARS = 18

#: Budget for a whole-row sweep, as an **exponent sum** rather than a variable
#: count.
#:
#: ``max_differential_hits`` asks for the largest count in a row, and this module
#: gets it by counting each ``(din, dout)`` pair separately -- which is the
#: module's declared method and is deliberately *not* the single-pass tally
#: ``verify/differential.py`` uses, because two paths that share an algorithm are
#: not two paths. The cost of that choice is 2^(n+m) evaluations, so
#: ``MAX_EXACT_DIFFERENTIAL_VARS`` is the wrong guard for it: bounding n alone
#: permits 2^36 at n=m=18, which is not a computation that finishes.
#:
#: Callers that want a larger sweep pass ``budget_bits`` explicitly, so raising
#: it is visible at the call site.
MAX_ROW_SWEEP_BITS = 18

#: Seeds per Tier S cell, matching PREREG-M1's declared value so the two modules
#: do not disagree about what a sampled cell is.
SEEDS_PER_CELL = 50

CONFIDENCE = 0.95


class DifferentialRefused(ProbeError):
    """The requested differential quantity has no path or exceeds a guard."""


@dataclass(frozen=True, slots=True)
class ExactDifferential:
    """Tier E. The probability, counted rather than estimated."""

    din: int
    dout: int
    hits: int
    trials: int
    n_in: int
    n_out: int

    @property
    def probability(self) -> float:
        return self.hits / self.trials

    @property
    def log2_probability(self) -> float:
        """log2 p, or -inf when the differential is impossible."""
        import math

        return math.log2(self.probability) if self.hits else float("-inf")

    @property
    def random_level_log2(self) -> float:
        """What a random function of this shape would give: 2^-n_out."""
        return float(-self.n_out)

    @property
    def above_random_level(self) -> bool:
        return self.log2_probability > self.random_level_log2

    def render(self) -> str:
        return (
            f"din={self.din:#x} dout={self.dout:#x} hits={self.hits}/{self.trials} "
            f"p=2^{self.log2_probability:.4g} random=2^{self.random_level_log2:.4g} "
            f"above_random={self.above_random_level}"
        )


def differential_probability(
    target: Any, din: int, dout: int, n: int | None = None, m: int | None = None
) -> ExactDifferential:
    """Tier E. Exhaust the input space and count.

    ``din`` must be non-zero: the zero input difference gives the zero output
    difference with probability 1 for every function, which is not a property of
    the target and is refused rather than reported.
    """
    n = n if n is not None else target.n_in
    m = m if m is not None else target.n_out
    if din == 0:
        raise DifferentialRefused(
            "the zero input difference holds with probability 1 for every "
            "function; it says nothing about the target"
        )
    if not 0 < din < (1 << n):
        raise DifferentialRefused(f"input difference {din:#x} is not an {n}-bit value")
    if not 0 <= dout < (1 << m):
        raise DifferentialRefused(f"output difference {dout:#x} is not an {m}-bit value")
    if n > MAX_EXACT_DIFFERENTIAL_VARS:
        raise DifferentialRefused(
            f"exact differential over {n} variables exceeds the guard of "
            f"{MAX_EXACT_DIFFERENTIAL_VARS}; this path does not estimate"
        )
    hits = sum(1 for x in range(1 << n) if target(x) ^ target(x ^ din) == dout)
    return ExactDifferential(
        din=din, dout=dout, hits=hits, trials=1 << n, n_in=n, n_out=m
    )


@dataclass(frozen=True, slots=True)
class SampledDifferential:
    """Tier S. A rate with an interval, never a point."""

    din: int
    dout: int
    hits: int
    seeds: int
    ci_low: float
    ci_high: float
    n_out: int

    @property
    def rate(self) -> float:
        return self.hits / self.seeds

    @property
    def random_level(self) -> float:
        return 2.0**-self.n_out

    @property
    def interval_excludes_random_level(self) -> bool:
        """Whether the interval's lower bound sits above the random level.

        The only claim a sampled cell is entitled to make, and it is about the
        interval rather than the point estimate.
        """
        return self.ci_low > self.random_level

    def render(self) -> str:
        return (
            f"din={self.din:#x} dout={self.dout:#x} hits={self.hits}/{self.seeds} "
            f"rate={self.rate:.6g} ci=[{self.ci_low:.6g},{self.ci_high:.6g}] "
            f"random={self.random_level:.6g} "
            f"excludes_random={self.interval_excludes_random_level}"
        )


def sampled_probability(
    target: Any,
    din: int,
    dout: int,
    seeds: Sequence[int],
    n: int | None = None,
    m: int | None = None,
) -> SampledDifferential:
    """Tier S. One draw per seed, with an exact interval on the rate."""
    n = n if n is not None else target.n_in
    m = m if m is not None else target.n_out
    if din == 0:
        raise DifferentialRefused("the zero input difference is refused")
    if len(set(seeds)) != len(seeds):
        raise DifferentialRefused(
            "seeds must be distinct: repeated seeds are not independent draws"
        )
    if len(seeds) < SEEDS_PER_CELL:
        raise DifferentialRefused(
            f"a Tier S cell needs {SEEDS_PER_CELL} seeds; got {len(seeds)}"
        )
    hits = 0
    for seed in seeds:
        x = random.Random(seed).randrange(1 << n)
        if target(x) ^ target(x ^ din) == dout:
            hits += 1
    low, high = clopper_pearson_interval(hits, len(seeds), CONFIDENCE)
    return SampledDifferential(
        din=din, dout=dout, hits=hits, seeds=len(seeds), ci_low=low, ci_high=high, n_out=m
    )


def characteristic_steps(
    probabilities_by_round: Sequence[float], n_out: int
) -> int:
    """Rounds a characteristic covers while staying above the random level.

    Counted from round 1 and stopping at the first round that falls to or below
    2^-n_out: a characteristic that has decayed to the random level has stopped
    being a characteristic, and continuing to count would report a step that
    carries no advantage.
    """
    if n_out < 1:
        raise DifferentialRefused("n_out must be positive")
    floor = 2.0**-n_out
    steps = 0
    for probability in probabilities_by_round:
        if probability <= floor:
            break
        steps += 1
    return steps


def measure(target: Any, case: Any) -> Any:
    """Dispatch on the quantity the calibration case names."""
    quantity = case.quantity
    parameters = getattr(case, "parameters", {}) or {}
    if quantity == "differential_probability_log2":
        din = parameters["din"]
        dout = parameters["dout"]
        return differential_probability(target, din, dout).log2_probability
    if quantity == "differential_hits":
        return differential_probability(
            target, parameters["din"], parameters["dout"]
        ).hits
    if quantity == "max_differential_hits":
        din = parameters["din"]
        budget = parameters.get("budget_bits", MAX_ROW_SWEEP_BITS)
        cost = target.n_in + target.n_out
        if cost > budget:
            raise DifferentialRefused(
                f"the largest count over a row of {target.n_out} output "
                f"differences on {target.n_in} input bits costs 2^{cost} "
                f"evaluations, above the sweep budget of 2^{budget}; set "
                f"budget_bits in the case parameters to raise it"
            )
        best = 0
        for dout in range(1 << target.n_out):
            hits = differential_probability(target, din, dout).hits
            best = max(best, hits)
        return best
    raise DifferentialRefused(f"no measurement path for quantity {quantity!r}")
