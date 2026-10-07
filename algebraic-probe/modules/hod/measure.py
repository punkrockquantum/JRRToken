"""Module 4's measurement path.

A degree bound d implies every (d+1)-order differential vanishes identically.
That is deductive, so the implied order is Tier P whenever the degree bound is.

The vanishing is also checked empirically here, by summing the target over a
(d+1)-dimensional affine subspace. That check uses this module's own subspace
summation, not ``verify/`` -- the two must stay independent.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any, Sequence

from tiers.errors import ProbeError


class HODRefused(ProbeError):
    """The requested higher-order quantity has no path or exceeds a guard."""


#: Summing over a subspace costs 2^k target evaluations; above this the check
#: refuses rather than sampling a subset of the subspace.
MAX_SUBSPACE_DIM = 20


@dataclass(frozen=True, slots=True)
class HODResult:
    """The distinguisher implied by a degree bound at one round."""

    round_index: int
    degree_bound: int
    n_variables: int
    order: int  # d + 1
    log2_data: int  # log2 of the chosen-input requirement
    exists: bool  # is there a subspace of that dimension at all
    derivation: str

    @property
    def saturated(self) -> bool:
        """The degree has reached the permutation maximum, so no order below the
        full input space is guaranteed to vanish."""
        return self.degree_bound >= self.n_variables - 1

    def render(self) -> str:
        return (
            f"round={self.round_index} degree_bound={self.degree_bound} "
            f"order={self.order} log2_data={self.log2_data} exists={self.exists} "
            f"saturated={self.saturated}"
        )


def implied_order(degree_bound: int, n_variables: int, round_index: int) -> HODResult:
    """Tier P given a Tier P degree bound: deg <= d => every (d+1)-order
    derivative is identically zero."""
    if degree_bound < 0:
        raise HODRefused("a degree bound must be non-negative")
    order = degree_bound + 1
    return HODResult(
        round_index=round_index,
        degree_bound=degree_bound,
        n_variables=n_variables,
        order=order,
        log2_data=order,
        exists=order <= n_variables,
        derivation=(
            f"algebraic degree at most {degree_bound}, so every derivative of order "
            f"{order} vanishes identically; the distinguisher needs a "
            f"{order}-dimensional affine subspace, which exists iff "
            f"{order} <= {n_variables}"
        ),
    )


def useful_until(bounds_by_round: Sequence[int], n_variables: int) -> int:
    """Last round at which the implied order still fits the input space.

    Returns 0 when no round qualifies. This is the round at which the
    distinguisher stops being available, which is the quantity the brief asks
    for.
    """
    last = 0
    for index, bound in enumerate(bounds_by_round, start=1):
        if implied_order(bound, n_variables, index).exists:
            last = index
    return last


def derivative_vanishes(target: Any, dimension: int, seed: int, n: int | None = None) -> bool:
    """Sum the target over a random affine subspace of the given dimension.

    Independent of ``verify/``: this module computes its own subspace sum, so an
    agreement between the two is evidence rather than a restatement.
    """
    n = n if n is not None else target.n_in
    if dimension > MAX_SUBSPACE_DIM:
        raise HODRefused(
            f"subspace dimension {dimension} exceeds the guard of {MAX_SUBSPACE_DIM}; "
            "this check does not sample a subset of the subspace"
        )
    if dimension > n:
        raise HODRefused(f"no {dimension}-dimensional subspace exists in {n} variables")
    rng = random.Random(seed)
    basis: list[int] = []
    while len(basis) < dimension:
        candidate = rng.randrange(1 << n)
        if candidate and candidate not in basis:
            basis.append(candidate)
    offset = rng.randrange(1 << n)
    total = 0
    for mask in range(1 << dimension):
        point = offset
        for index in range(dimension):
            if (mask >> index) & 1:
                point ^= basis[index]
        total ^= target(point)
    return total == 0


def last_nontrivial_round(bounds_by_round: Sequence[int], n_variables: int) -> int:
    """Last round at which the implied order is strictly below the full input
    space.

    An order equal to the number of variables needs every input, which is not a
    distinguisher but an exhaustive evaluation. This is the round at which the
    implied distinguisher stops being useful, as distinct from stops existing.
    """
    last = 0
    for index, bound in enumerate(bounds_by_round, start=1):
        if implied_order(bound, n_variables, index).order < n_variables:
            last = index
    return last
