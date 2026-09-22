"""Actual dependence, determined exhaustively -- the independent path for Module 2.

Section 7.2 makes an independent verification path a precondition of promotion.
Module 2 computes which input bits *can* reach an output bit, by propagating
reachable sets through the target's code. This file computes which input bits an
output bit *actually* depends on, by consuming the whole input space, and shares
no code with ``modules/``.

The definition used is the only one that needs no argument: output bit ``j``
depends on input bit ``i`` exactly when some input ``x`` has
``f(x)_j != f(x ^ e_i)_j``. Over the complete space that is definitive -- Tier E
-- and it is the check that makes Module 2's soundness claim falsifiable:
reachability must contain dependence, and an input bit outside the reachable set
on which an output bit demonstrably depends would refute it.

Nothing here imports ``modules/`` and nothing in ``modules/`` may import it
(``scripts/ci_checks.py``).
"""

from __future__ import annotations

from typing import Callable

#: 2^n evaluations times n directions. Above this the exhaustive dependence
#: computation stops fitting on one machine. Raising it is a deliberate act,
#: recorded in DECISIONS.md. See D-043.
MAX_DEPENDENCE_VARS = 18


class DependenceRefused(Exception):
    """The requested exhaustive computation exceeds the declared size guard."""


def _check_size(n: int) -> None:
    if n < 0:
        raise ValueError("n must be non-negative")
    if n > MAX_DEPENDENCE_VARS:
        raise DependenceRefused(
            f"exhaustive dependence over {n} variables exceeds the guard of "
            f"{MAX_DEPENDENCE_VARS}; this path does not sample"
        )


def dependence_matrix(f: Callable[[int], int], n: int, m: int) -> list[int]:
    """``matrix[j]`` is a bitmask of the input bits output bit ``j`` depends on.

    One pass over the space per input direction. A difference anywhere proves
    dependence; no difference anywhere over the complete space proves
    independence.
    """
    _check_size(n)
    matrix = [0] * m
    for i in range(n):
        direction = 1 << i
        differing = 0
        for x in range(1 << n):
            if x & direction:
                continue  # each unordered pair is visited once
            differing |= f(x) ^ f(x | direction)
        for j in range(m):
            if (differing >> j) & 1:
                matrix[j] |= direction
    return matrix


def dependent_input_bits(f: Callable[[int], int], n: int, m: int) -> int:
    """Union over output bits: every input bit that influences anything."""
    union = 0
    for row in dependence_matrix(f, n, m):
        union |= row
    return union


def constant_output_bits(f: Callable[[int], int], n: int, m: int) -> tuple[int, ...]:
    """Output bits that depend on no input at all -- provably constant."""
    matrix = dependence_matrix(f, n, m)
    return tuple(j for j in range(m) if matrix[j] == 0)


def reachability_contains_dependence(
    f: Callable[[int], int], n: int, m: int, reachable: int
) -> tuple[bool, int]:
    """Module 2's soundness claim, as a falsifiable check.

    Returns ``(holds, escaping)`` where ``escaping`` is the set of input bits an
    output bit depends on that the reachable set does not name. Non-empty means
    the reachability computation is unsound.
    """
    depends = dependent_input_bits(f, n, m)
    escaping = depends & ~reachable
    return escaping == 0, escaping
