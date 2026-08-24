"""The seed distribution every Tier S result must carry.

Section 3, Tier S:
  - minimum 30 independent seeds per cell, 50 preferred
  - report the full distribution, never a single point
  - retain the raw per-seed values
"""

from __future__ import annotations

from dataclasses import dataclass

from .errors import SamplingError

MIN_SEEDS = 30
PREFERRED_SEEDS = 50


def _quantile(sorted_values: list[float], q: float) -> float:
    """Linear-interpolation quantile (type 7, the R/numpy default).

    Written out rather than imported so the statistical layer has no
    third-party dependency; ``tests/test_stats_quantile.py`` pins it against
    hand-computed values.
    """
    if not sorted_values:
        raise SamplingError("quantile of an empty sample")
    if len(sorted_values) == 1:
        return sorted_values[0]
    pos = (len(sorted_values) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(sorted_values) - 1)
    frac = pos - lo
    return sorted_values[lo] * (1.0 - frac) + sorted_values[hi] * frac


@dataclass(frozen=True, slots=True)
class SeedDistribution:
    """Raw per-seed values plus the summary that must always accompany them."""

    seeds: tuple[int, ...]
    values: tuple[float, ...]
    censored: tuple[bool, ...] = ()

    def __post_init__(self) -> None:
        if len(self.seeds) != len(self.values):
            raise SamplingError(
                f"seeds/values length mismatch: {len(self.seeds)} vs {len(self.values)}"
            )
        if len(set(self.seeds)) != len(self.seeds):
            raise SamplingError("seeds must be distinct: repeated seeds are not independent runs")
        if len(self.seeds) < MIN_SEEDS:
            raise SamplingError(
                f"Tier S requires at least {MIN_SEEDS} independent seeds per cell; got {len(self.seeds)}"
            )
        if self.censored and len(self.censored) != len(self.values):
            raise SamplingError("censored flags must align with values")

    @property
    def n_seeds(self) -> int:
        return len(self.seeds)

    @property
    def meets_preferred(self) -> bool:
        return self.n_seeds >= PREFERRED_SEEDS

    @property
    def n_censored(self) -> int:
        return sum(1 for flag in self.censored if flag)

    @property
    def sorted_values(self) -> list[float]:
        return sorted(self.values)

    @property
    def median(self) -> float:
        return _quantile(self.sorted_values, 0.5)

    @property
    def q1(self) -> float:
        return _quantile(self.sorted_values, 0.25)

    @property
    def q3(self) -> float:
        return _quantile(self.sorted_values, 0.75)

    @property
    def iqr(self) -> float:
        return self.q3 - self.q1

    @property
    def minimum(self) -> float:
        return min(self.values)

    @property
    def maximum(self) -> float:
        return max(self.values)

    def render(self) -> str:
        """Never a single point: the summary always carries the spread."""
        line = (
            f"n_seeds={self.n_seeds} median={self.median:.6g} "
            f"IQR=[{self.q1:.6g},{self.q3:.6g}] min={self.minimum:.6g} max={self.maximum:.6g}"
        )
        if self.censored:
            line += f" censored={self.n_censored}/{self.n_seeds}"
        if not self.meets_preferred:
            line += f" seeds_below_preferred={PREFERRED_SEEDS}"
        return line

    def to_dict(self) -> dict:
        return {
            "seeds": list(self.seeds),
            "values": list(self.values),
            "censored": list(self.censored),
            "n_seeds": self.n_seeds,
            "median": self.median,
            "q1": self.q1,
            "q3": self.q3,
            "iqr": self.iqr,
            "min": self.minimum,
            "max": self.maximum,
        }
