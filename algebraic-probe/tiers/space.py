"""The enumerated space that every Tier E result must carry.

Section 3, Tier E: "Every Tier E result must print the exact space enumerated,
its cardinality, and the fraction of the full space it represents."
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from fractions import Fraction

from .errors import SpaceError


@dataclass(frozen=True, slots=True)
class EnumeratedSpace:
    """A completely enumerated space, and the universe it sits inside."""

    description: str
    cardinality: int
    full_cardinality: int
    universe_description: str

    def __post_init__(self) -> None:
        if not self.description.strip():
            raise SpaceError("EnumeratedSpace.description must be non-empty")
        if not self.universe_description.strip():
            raise SpaceError("EnumeratedSpace.universe_description must be non-empty")
        if self.cardinality <= 0:
            raise SpaceError("EnumeratedSpace.cardinality must be positive")
        if self.full_cardinality < self.cardinality:
            raise SpaceError(
                "EnumeratedSpace.full_cardinality must be >= cardinality "
                f"({self.full_cardinality} < {self.cardinality})"
            )

    @property
    def fraction(self) -> Fraction:
        return Fraction(self.cardinality, self.full_cardinality)

    @property
    def log2_fraction(self) -> float:
        """log2 of the covered fraction; exact for the huge integers we use."""
        return math.log2(self.cardinality) - math.log2(self.full_cardinality)

    def render(self) -> str:
        """One line. A Tier E null must be printed with this on the same line."""
        return (
            f"space={self.description} |space|={self.cardinality} "
            f"universe={self.universe_description} |universe|={self.full_cardinality} "
            f"fraction=2^{self.log2_fraction:.4f}"
        )

    def to_dict(self) -> dict:
        return {
            "description": self.description,
            "cardinality": self.cardinality,
            "full_cardinality": self.full_cardinality,
            "universe_description": self.universe_description,
            "log2_fraction": self.log2_fraction,
        }
