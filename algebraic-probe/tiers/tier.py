"""The three-tier epistemic label.

Section 3 of the brief. The label is assigned by which code path produced the
result (see ``tiers.result`` factories), never by hand, and never upgraded.
"""

from __future__ import annotations

import enum


class Tier(enum.Enum):
    """Exactly three labels. No fourth, no "unknown", no "provisional"."""

    P = "P"  # PROVEN: deductive. True or false, not sampled.
    E = "E"  # EXHAUSTED-IN-SPACE: complete enumeration of a stated space.
    S = "S"  # SAMPLED: probabilistic search with random restarts.

    @property
    def long_name(self) -> str:
        return {
            Tier.P: "PROVEN",
            Tier.E: "EXHAUSTED-IN-SPACE",
            Tier.S: "SAMPLED",
        }[self]

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.value

    # Ordering between tiers is deliberately undefined. There is no sense in
    # which Tier P is "greater than" Tier S; they answer different questions.
    def __lt__(self, other: object) -> bool:
        raise TypeError(
            "Tier labels are not ordered. A proof is not a bigger number than a sample."
        )

    __gt__ = __lt__
    __le__ = __lt__
    __ge__ = __lt__


#: Regimes the harness can run a module under. Section 3.1: a module declares
#: its tier at registration time and the harness refuses the wrong regime.
class Regime(enum.Enum):
    DEDUCTIVE = "deductive"  # single evaluation; repetition adds nothing
    ENUMERATIVE = "enumerative"  # one complete pass over a stated space
    PROBABILISTIC = "probabilistic"  # many independent seeds, pooled


#: The only legal pairing of declared tier and execution regime.
TIER_REGIME: dict[Tier, Regime] = {
    Tier.P: Regime.DEDUCTIVE,
    Tier.E: Regime.ENUMERATIVE,
    Tier.S: Regime.PROBABILISTIC,
}
