"""Results and the integrity rules that make the tier label mean something.

Section 3:
  * exactly one tier label per result
  * assigned programmatically by the code path that produced it
  * never set by hand, never upgraded post hoc
  * results of different tiers may not be combined, averaged or compared

The mechanism: ``Result`` cannot be constructed without a mint token held
privately by this module, and the three factories below are the only holders.
Each factory demands the evidence its tier requires.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Any, Iterable

from .distribution import SeedDistribution
from .errors import ProvenanceError, SamplingError, SpaceError, TierViolation
from .provenance import Provenance
from .space import EnumeratedSpace
from .tier import Tier


class _MintToken:
    """Unforgeable-enough marker: only this module holds an instance."""

    __slots__ = ()


_MINT = _MintToken()


@dataclass(frozen=True)
class Result:
    """A single measured or proven quantity, with its tier and its provenance.

    Frozen: the tier label cannot be reassigned after construction. Attempting
    to construct one directly (without a factory) raises ``TierViolation``.
    """

    tier: Tier
    metric: str
    value: Any
    provenance: Provenance
    target: str
    #: Tier P only: the deductive argument that makes this a proof.
    derivation: str | None = None
    #: Tier E only: the space that was exhausted.
    space: EnumeratedSpace | None = None
    #: Tier S only: the raw per-seed distribution.
    distribution: SeedDistribution | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    _mint: Any = None

    def __post_init__(self) -> None:
        if self._mint is not _MINT:
            raise TierViolation(
                "Result objects are minted by tiers.result.prove/enumerated/sampled only. "
                "The tier label is assigned by the code path that produced the result, "
                "never by hand (section 3)."
            )
        if not self.metric.strip():
            raise ProvenanceError("Result.metric must be non-empty")
        if not self.target.strip():
            raise ProvenanceError("Result.target must be non-empty")

    # -- integrity: no post-hoc relabelling ---------------------------------
    # ``__setattr__`` is installed just below the class body: a frozen
    # dataclass generates its own and refuses to be given one in the body.

    def relabel(self, tier: Tier) -> "Result":
        raise TierViolation(
            "There is no relabel operation. Re-derive the result through the code "
            "path that earns the tier you want."
        )

    def with_repetitions(self, n: int) -> "Result":
        if self.tier is Tier.P:
            raise TierViolation(
                "Repetition adds nothing to a Tier P result. A proof does not become "
                "truer on the thousandth run (section 3)."
            )
        return mint(
            tier=self.tier,
            metric=self.metric,
            value=self.value,
            provenance=self.provenance,
            target=self.target,
            derivation=self.derivation,
            space=self.space,
            distribution=self.distribution,
            payload={**self.payload, "repetitions": n},
        )

    # -- integrity: no cross-tier arithmetic or comparison ------------------

    def _guard(self, other: object, op: str) -> "Result":
        if not isinstance(other, Result):
            raise TierViolation(
                f"Refusing to {op} a Result with a bare {type(other).__name__}: the "
                "result of that operation would carry no tier label."
            )
        if other.tier is not self.tier:
            raise TierViolation(
                f"Refusing to {op} a Tier {self.tier.value} result with a Tier "
                f"{other.tier.value} result. Results of different tiers may not be "
                "combined, averaged, or compared (section 3)."
            )
        return other

    def __add__(self, other: object) -> Any:
        self._guard(other, "add")
        raise TierViolation(
            "Arithmetic on Result objects is not defined even within a tier; "
            "combine the underlying values explicitly and mint a new result "
            "through the appropriate factory."
        )

    __sub__ = __add__
    __mul__ = __add__
    __truediv__ = __add__

    def __lt__(self, other: object) -> bool:
        self._guard(other, "compare")
        return bool(self.value < other.value)  # type: ignore[union-attr]

    def __gt__(self, other: object) -> bool:
        self._guard(other, "compare")
        return bool(self.value > other.value)  # type: ignore[union-attr]

    def __le__(self, other: object) -> bool:
        self._guard(other, "compare")
        return bool(self.value <= other.value)  # type: ignore[union-attr]

    def __ge__(self, other: object) -> bool:
        self._guard(other, "compare")
        return bool(self.value >= other.value)  # type: ignore[union-attr]

    # -- rendering ----------------------------------------------------------

    def render(self) -> str:
        """One line, no prose. Tier E nulls carry their space on this same line."""
        head = f"tier={self.tier.value} target={self.target} metric={self.metric}"
        if self.tier is Tier.S and self.distribution is not None:
            body = self.distribution.render()
        else:
            body = f"value={self.value}"
        tail = self.provenance.render()
        if self.tier is Tier.E and self.space is not None:
            body = f"{body} {self.space.render()}"
        return f"{head} {body} {tail}"

    def to_dict(self) -> dict:
        out: dict[str, Any] = {
            "tier": self.tier.value,
            "target": self.target,
            "metric": self.metric,
            "value": self.value,
            "provenance": self.provenance.to_dict(),
            "payload": self.payload,
        }
        if self.derivation is not None:
            out["derivation"] = self.derivation
        if self.space is not None:
            out["space"] = self.space.to_dict()
        if self.distribution is not None:
            out["distribution"] = self.distribution.to_dict()
        return out


def _result_setattr(self: Result, name: str, value: Any) -> None:
    if name == "tier":
        raise TierViolation(
            "A tier label can never be upgraded or reassigned post hoc (section 3)."
        )
    raise TierViolation(
        f"Result is immutable; {name!r} cannot be reassigned after the result was minted."
    )


Result.__setattr__ = _result_setattr  # type: ignore[method-assign]


def mint(
    *,
    tier: Tier,
    metric: str,
    value: Any,
    provenance: Provenance,
    target: str,
    derivation: str | None = None,
    space: EnumeratedSpace | None = None,
    distribution: SeedDistribution | None = None,
    payload: dict[str, Any] | None = None,
) -> Result:
    """Internal minting. Module-private by convention; factories below are the API."""
    return Result(
        tier=tier,
        metric=metric,
        value=value,
        provenance=provenance,
        target=target,
        derivation=derivation,
        space=space,
        distribution=distribution,
        payload=dict(payload or {}),
        _mint=_MINT,
    )


# ---------------------------------------------------------------------------
# The three code paths. A tier label exists only because one of these ran.
# ---------------------------------------------------------------------------


def prove(
    *,
    metric: str,
    value: Any,
    target: str,
    provenance: Provenance,
    derivation: str,
    payload: dict[str, Any] | None = None,
) -> Result:
    """Tier P. Requires the deductive argument in ``derivation``."""
    if not derivation or not derivation.strip():
        raise TierViolation(
            "Tier P requires the deductive argument that makes it a proof. "
            "A value with no derivation is not proven."
        )
    return mint(
        tier=Tier.P,
        metric=metric,
        value=value,
        provenance=provenance,
        target=target,
        derivation=derivation,
        payload=payload,
    )


def enumerated(
    *,
    metric: str,
    value: Any,
    target: str,
    provenance: Provenance,
    space: EnumeratedSpace,
    payload: dict[str, Any] | None = None,
) -> Result:
    """Tier E. Requires the exact space enumerated."""
    if not isinstance(space, EnumeratedSpace):
        raise SpaceError("Tier E requires an EnumeratedSpace; 'no result found' is meaningless without one")
    return mint(
        tier=Tier.E,
        metric=metric,
        value=value,
        provenance=provenance,
        target=target,
        space=space,
        payload=payload,
    )


def sampled(
    *,
    metric: str,
    target: str,
    provenance: Provenance,
    distribution: SeedDistribution,
    payload: dict[str, Any] | None = None,
) -> Result:
    """Tier S. Requires the full seed distribution; the value IS the distribution."""
    if not isinstance(distribution, SeedDistribution):
        raise SamplingError("Tier S requires a SeedDistribution, never a single point")
    return mint(
        tier=Tier.S,
        metric=metric,
        value=distribution.median,
        provenance=provenance,
        target=target,
        distribution=distribution,
        payload=payload,
    )


# ---------------------------------------------------------------------------
# Aggregation, guarded
# ---------------------------------------------------------------------------


def require_same_tier(results: Iterable[Result], op: str) -> Tier:
    results = list(results)
    if not results:
        raise TierViolation(f"Refusing to {op} an empty set of results")
    tiers = {r.tier for r in results}
    if len(tiers) != 1:
        raise TierViolation(
            f"Refusing to {op} results across tiers {sorted(t.value for t in tiers)}. "
            "Results of different tiers may not be combined, averaged, or compared "
            "(section 3)."
        )
    return tiers.pop()


def mean_value(results: Iterable[Result]) -> float:
    """Mean of the values of same-tier results. Raises on mixed tiers, and on Tier P."""
    results = list(results)
    tier = require_same_tier(results, "average")
    if tier is Tier.P:
        raise TierViolation(
            "Averaging Tier P results is meaningless: a proof does not have a mean."
        )
    return statistics.fmean(float(r.value) for r in results)


@dataclass(frozen=True, slots=True)
class ResultSet:
    """A homogeneous-tier collection. Heterogeneous collections are refused."""

    results: tuple[Result, ...]

    def __post_init__(self) -> None:
        require_same_tier(self.results, "collect")

    @property
    def tier(self) -> Tier:
        return self.results[0].tier

    def render(self) -> str:
        return "\n".join(r.render() for r in self.results)
