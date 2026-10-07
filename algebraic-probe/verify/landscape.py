"""Exhaustive landscape statistics over the hypercube.

Tier E throughout: every function here consumes the whole of {0,1}^n and nothing
is sampled. These are the statistics that separate a landscape whose local
behaviour is random from one whose global organisation is hierarchical --
precisely the distinction that a measure of algebraic degree does not make.

Three quantities, and one of them deliberately fails to separate:

  local minima     Count of states below all n neighbours. Under a landscape of
                   i.i.d. continuous energies the expectation is exactly
                   2^n / (n+1), derived in ``expected_local_minima_iid`` from
                   exchangeability and nothing else. A hierarchical landscape
                   departs from it.

  overlap P(q)     The distribution of q = 1 - 2*d_H(x,y)/n over pairs of
                   low-energy states. Scattered ground states put their mass at
                   q = 0; clustered ones put an atom at the overlap forced by a
                   shared block.

  density of       The histogram of energies. For the pair of models in
  states           ``core.landscape`` this is standard normal in *both* regimes
                   by construction, so it separates nothing. It is computed
                   anyway, because a statistic that cannot distinguish two cases
                   is worth demonstrating rather than assuming.

Nothing here imports ``modules/`` and nothing in ``modules/`` may import it
(``scripts/ci_checks.py``).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Sequence

#: 2^n floats plus 2^n * n neighbour comparisons. Above this the exhaustive
#: landscape stops fitting in a working set one machine holds comfortably.
#: Raising it is a deliberate act, recorded in DECISIONS.md. See D-038.
MAX_LANDSCAPE_VARS = 22


class LandscapeRefused(Exception):
    """The requested exhaustive landscape exceeds the declared size guard."""


def _check_size(n: int) -> None:
    if n < 1:
        raise ValueError("n must be at least 1")
    if n > MAX_LANDSCAPE_VARS:
        raise LandscapeRefused(
            f"exhaustive landscape over {n} variables exceeds the guard of "
            f"{MAX_LANDSCAPE_VARS}; this path does not sample"
        )


def energies(energy: Callable[[int], float], n: int) -> list[float]:
    """E(x) at every one of the 2^n states, in state order."""
    _check_size(n)
    return [energy(x) for x in range(1 << n)]


# ---------------------------------------------------------------------------
# Local minima
# ---------------------------------------------------------------------------


def expected_local_minima_iid(n: int) -> float:
    """Expected number of local minima for i.i.d. continuous energies: 2^n/(n+1).

    Derivation, in full, because this number is the falsifiable prediction and
    must not be a constant somebody believed:

      A state x and its n neighbours are n+1 states whose energies are i.i.d.
      from a continuous distribution. Exchangeability makes each of the n+1
      equally likely to be the smallest, and continuity makes ties probability
      zero, so P(x is strictly below all its neighbours) = 1/(n+1). Expectation
      is linear whether or not the events are independent -- and they are not,
      since neighbours share states -- so summing over the 2^n states gives
      2^n/(n+1) exactly.

    Computation M1-LAND-DERIVE-001. No citation is relied on and none is claimed.
    """
    _check_size(n)
    return (1 << n) / (n + 1)


def local_minima(values: Sequence[float], n: int) -> list[int]:
    """States strictly below all n of their single-bit-flip neighbours."""
    _check_size(n)
    if len(values) != 1 << n:
        raise ValueError(f"expected {1 << n} energies, got {len(values)}")
    found = []
    for x in range(1 << n):
        here = values[x]
        for bit in range(n):
            if values[x ^ (1 << bit)] <= here:
                break
        else:
            found.append(x)
    return found


# ---------------------------------------------------------------------------
# The overlap distribution
# ---------------------------------------------------------------------------


def lowest_states(values: Sequence[float], count: int) -> list[int]:
    """The ``count`` states of least energy, lowest first."""
    if count < 1:
        raise ValueError("count must be positive")
    if count > len(values):
        raise ValueError(f"asked for {count} states of {len(values)}")
    return sorted(range(len(values)), key=lambda x: values[x])[:count]


def overlap(x: int, y: int, n: int) -> float:
    """q = 1 - 2*d_H(x,y)/n, the spin overlap in the +-1 convention.

    q = 1 for identical states, q = -1 for complementary ones, and q = 0 when the
    states differ in exactly half their bits.
    """
    if n < 1:
        raise ValueError("n must be at least 1")
    return 1.0 - 2.0 * (x ^ y).bit_count() / n


@dataclass(frozen=True, slots=True)
class OverlapDistribution:
    """P(q) over pairs of low-energy states, with the summary that must go with it."""

    n: int
    n_states: int
    n_pairs: int
    values: tuple[float, ...]

    @property
    def mean(self) -> float:
        return sum(self.values) / len(self.values) if self.values else 0.0

    @property
    def variance(self) -> float:
        if len(self.values) < 2:
            return 0.0
        mu = self.mean
        return sum((v - mu) ** 2 for v in self.values) / len(self.values)

    def mass_above(self, threshold: float) -> float:
        """Fraction of pairs whose overlap exceeds ``threshold``.

        The statistic that separates a scattered ground state from a clustered
        one: scattered states put essentially no mass at high overlap.
        """
        if not self.values:
            return 0.0
        return sum(1 for v in self.values if v > threshold) / len(self.values)

    def histogram(self, bins: int = 20) -> list[tuple[float, float, int]]:
        """(low, high, count) over q in [-1, 1]."""
        if bins < 1:
            raise ValueError("bins must be positive")
        width = 2.0 / bins
        counts = [0] * bins
        for v in self.values:
            index = min(int((v + 1.0) / width), bins - 1)
            counts[index] += 1
        return [(-1.0 + i * width, -1.0 + (i + 1) * width, c) for i, c in enumerate(counts)]

    def render(self) -> str:
        return (
            f"n_states={self.n_states} n_pairs={self.n_pairs} "
            f"mean_q={self.mean:.6g} var_q={self.variance:.6g} "
            f"mass_above_0.5={self.mass_above(0.5):.6g}"
        )


def overlap_distribution(
    values: Sequence[float], n: int, n_lowest: int
) -> OverlapDistribution:
    """P(q) over all pairs drawn from the ``n_lowest`` lowest-energy states."""
    _check_size(n)
    states = lowest_states(values, n_lowest)
    pairs = [
        overlap(states[i], states[j], n)
        for i in range(len(states))
        for j in range(i + 1, len(states))
    ]
    return OverlapDistribution(
        n=n, n_states=len(states), n_pairs=len(pairs), values=tuple(pairs)
    )


# ---------------------------------------------------------------------------
# Density of states
# ---------------------------------------------------------------------------


def density_of_states(values: Sequence[float], bins: int = 40) -> list[tuple[float, float, int]]:
    """Histogram of the energies, over their observed range."""
    if bins < 1:
        raise ValueError("bins must be positive")
    if not values:
        raise ValueError("no energies")
    low, high = min(values), max(values)
    if high == low:
        return [(low, high, len(values))]
    width = (high - low) / bins
    counts = [0] * bins
    for v in values:
        index = min(int((v - low) / width), bins - 1)
        counts[index] += 1
    return [(low + i * width, low + (i + 1) * width, c) for i, c in enumerate(counts)]


def moments(values: Sequence[float]) -> tuple[float, float, float, float]:
    """(mean, variance, skewness, excess kurtosis) of the density of states.

    A standard normal density of states has (0, 1, 0, 0). Both regimes of
    ``core.landscape`` are constructed to hit it, which is why these moments do
    not separate them.
    """
    if len(values) < 2:
        raise ValueError("need at least two values")
    count = len(values)
    mean = sum(values) / count
    centred = [v - mean for v in values]
    m2 = sum(c * c for c in centred) / count
    m3 = sum(c**3 for c in centred) / count
    m4 = sum(c**4 for c in centred) / count
    if m2 == 0.0:
        return mean, 0.0, 0.0, 0.0
    sd = math.sqrt(m2)
    return mean, m2, m3 / sd**3, m4 / m2**2 - 3.0
