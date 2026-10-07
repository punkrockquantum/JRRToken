"""Benjamini-Hochberg correction with a pre-registered, asserted family size.

Section 3, Tier S: "Benjamini-Hochberg correction across the pre-registered
family, with the family size fixed in the pre-registration and asserted at
analysis time."

The assertion is the point. ``benjamini_hochberg`` takes ``family_size`` and
raises if the number of tests handed to it differs. Silently correcting across
"however many tests I happened to run" is the failure mode this guards.
"""

from __future__ import annotations

from dataclasses import dataclass

from tiers.errors import ProbeError


class FamilySizeMismatch(ProbeError):
    """The tests presented do not match the pre-registered family size."""


@dataclass(frozen=True, slots=True)
class BHTest:
    label: str
    p_value: float

    def __post_init__(self) -> None:
        if not 0.0 <= self.p_value <= 1.0:
            raise ValueError(f"{self.label}: p-value out of range: {self.p_value!r}")


@dataclass(frozen=True, slots=True)
class BHOutcome:
    label: str
    p_value: float
    rank: int
    critical_value: float
    q_value: float
    rejected: bool


@dataclass(frozen=True, slots=True)
class BHResult:
    alpha: float
    family_size: int
    outcomes: tuple[BHOutcome, ...]

    @property
    def n_rejected(self) -> int:
        return sum(1 for o in self.outcomes if o.rejected)

    def by_label(self, label: str) -> BHOutcome:
        for outcome in self.outcomes:
            if outcome.label == label:
                return outcome
        raise KeyError(label)


def benjamini_hochberg(
    tests: list[BHTest], *, alpha: float, family_size: int
) -> BHResult:
    """Step-up BH procedure at level ``alpha`` over exactly ``family_size`` tests."""
    if not 0.0 < alpha < 1.0:
        raise ValueError(f"alpha must be in (0,1), got {alpha!r}")
    if family_size <= 0:
        raise ValueError("family_size must be positive")
    if len(tests) != family_size:
        raise FamilySizeMismatch(
            f"pre-registered family size is {family_size} but {len(tests)} tests were "
            "presented; the correction is only valid over the pre-registered family"
        )
    labels = [t.label for t in tests]
    if len(set(labels)) != len(labels):
        raise FamilySizeMismatch("test labels must be distinct within a family")

    ordered = sorted(tests, key=lambda t: (t.p_value, t.label))
    m = family_size

    # Step-up: find the largest rank k with p_(k) <= k/m * alpha.
    k_max = 0
    for i, test in enumerate(ordered, start=1):
        if test.p_value <= (i / m) * alpha:
            k_max = i

    # Monotone BH q-values (adjusted p-values), computed by a reverse pass.
    q_values: list[float] = [0.0] * m
    running = 1.0
    for i in range(m, 0, -1):
        candidate = min(1.0, ordered[i - 1].p_value * m / i)
        running = min(running, candidate)
        q_values[i - 1] = running

    outcomes = tuple(
        BHOutcome(
            label=test.label,
            p_value=test.p_value,
            rank=i,
            critical_value=(i / m) * alpha,
            q_value=q_values[i - 1],
            rejected=i <= k_max,
        )
        for i, test in enumerate(ordered, start=1)
    )
    return BHResult(alpha=alpha, family_size=family_size, outcomes=outcomes)


@dataclass(frozen=True, slots=True)
class TwoPartOutcome:
    """Section 3: significance AND a pre-registered effect-size floor.

    A result that clears significance but not the floor is recorded as a
    pass-fail and does not promote.
    """

    label: str
    q_value: float
    significant: bool
    effect_size: float
    effect_floor: float
    clears_floor: bool

    @property
    def accepted(self) -> bool:
        return self.significant and self.clears_floor

    @property
    def is_pass_fail(self) -> bool:
        """Significant but under the effect floor: the case that must not promote."""
        return self.significant and not self.clears_floor

    def render(self) -> str:
        from .pvalue import format_p

        return (
            f"label={self.label} q={format_p(self.q_value)[2:]} significant={self.significant} "
            f"effect={self.effect_size:.6g} floor={self.effect_floor:.6g} "
            f"clears_floor={self.clears_floor} accepted={self.accepted} "
            f"pass_fail={self.is_pass_fail}"
        )


def two_part_acceptance(
    bh: BHResult, effects: dict[str, float], *, effect_floor: float
) -> tuple[TwoPartOutcome, ...]:
    if set(effects) != {o.label for o in bh.outcomes}:
        raise FamilySizeMismatch(
            "effect sizes must be supplied for exactly the tests in the BH family"
        )
    return tuple(
        TwoPartOutcome(
            label=o.label,
            q_value=o.q_value,
            significant=o.rejected,
            effect_size=effects[o.label],
            effect_floor=effect_floor,
            clears_floor=abs(effects[o.label]) >= effect_floor,
        )
        for o in bh.outcomes
    )
