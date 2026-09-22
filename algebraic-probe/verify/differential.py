"""The differential distribution table, computed exhaustively -- M3's independent path.

Section 7.2 makes an independent verification path a precondition of promotion.
``modules/differential`` counts, for one stated ``(din, dout)`` pair, the inputs
satisfying it. This file builds the *whole* table for a given input difference in
a single pass and shares no code with ``modules/``.

The two answer the same question by different routes: one iterates pairs and
counts per pair, the other iterates inputs once and tallies. Agreement between
them is evidence; a disagreement means one of them is wrong.

Nothing here imports ``modules/`` and nothing in ``modules/`` may import it
(``scripts/ci_checks.py``).
"""

from __future__ import annotations

from typing import Callable

#: 2^n evaluations per row of the table. Above this the path refuses rather than
#: estimating. Raising it is a deliberate act, recorded in DECISIONS.md.
MAX_DDT_VARS = 18

#: Budget for whole-table sweeps, as an **exponent sum** rather than a variable
#: count, because their cost has two exponents and not one.
#:
#: ``ddt_row`` costs 2^n. ``differential_uniformity`` and ``impossible_fraction``
#: sweep every non-zero input difference and take a full pass for each, so they
#: cost 2^(2n) -- and a guard that bounds only n permits 2^36 at n=18, which is
#: not a computation that finishes. 18 is the same 2^18-Python-evaluation budget
#: the other exhaustive paths here carry (``MAX_DEPENDENCE_VARS``,
#: ``MAX_EXACT_DIFFERENTIAL_VARS``, ``MAX_DDT_VARS``), applied to the quantity
#: that actually governs the cost.
#:
#: Callers that want a larger sweep pass ``budget_bits`` explicitly, so raising
#: it is visible at the call site rather than being a property of this module.
MAX_ROW_SWEEP_BITS = 18


class DDTRefused(Exception):
    """The requested table exceeds the declared size guard."""


def _check_size(n: int) -> None:
    if n < 1:
        raise ValueError("n must be positive")
    if n > MAX_DDT_VARS:
        raise DDTRefused(
            f"differential table over {n} variables exceeds the guard of "
            f"{MAX_DDT_VARS}; this path does not estimate"
        )


def _check_sweep(exponent: int, budget_bits: int, what: str) -> None:
    if exponent > budget_bits:
        raise DDTRefused(
            f"{what} costs 2^{exponent} evaluations, above the sweep budget of "
            f"2^{budget_bits}; pass budget_bits explicitly to raise it"
        )


def ddt_row(f: Callable[[int], int], n: int, din: int) -> dict[int, int]:
    """Output differences and their counts for one input difference.

    Only the non-zero counts are returned: a table over 2^m entries is mostly
    zeros, and the absent keys *are* the impossible differentials, which is a
    result rather than a gap.
    """
    _check_size(n)
    if not 0 < din < (1 << n):
        raise ValueError(f"input difference {din:#x} is not a non-zero {n}-bit value")
    row: dict[int, int] = {}
    for x in range(1 << n):
        dout = f(x) ^ f(x ^ din)
        row[dout] = row.get(dout, 0) + 1
    return row


def max_differential_count(f: Callable[[int], int], n: int, din: int) -> int:
    """The largest count in the row: the best differential for this ``din``."""
    return max(ddt_row(f, n, din).values())


def differential_uniformity(
    f: Callable[[int], int], n: int, *, budget_bits: int = MAX_ROW_SWEEP_BITS
) -> int:
    """The largest count over every non-zero input difference.

    For a function on n bits this is at least 2, because
    ``f(x) ^ f(x ^ din)`` takes each value an even number of times -- the pair
    ``(x, x ^ din)`` contributes the same difference twice. A function attaining
    exactly 2 is almost perfect nonlinear, and this computes that rather than
    asserting it.

    Costs 2^(2n) evaluations: one full pass per non-zero input difference. See
    ``MAX_ROW_SWEEP_BITS``.
    """
    _check_size(n)
    _check_sweep(2 * n, budget_bits, f"differential uniformity over {n} variables")
    return max(max_differential_count(f, n, din) for din in range(1, 1 << n))


def impossible_differentials(f: Callable[[int], int], n: int, m: int, din: int) -> int:
    """How many output differences are unreachable for this input difference.

    Counted, because a search thresholded on "above the random level" looks
    upward and never reports these.
    """
    _check_size(n)
    return (1 << m) - len(ddt_row(f, n, din))


def impossible_fraction(
    f: Callable[[int], int], n: int, m: int, *, budget_bits: int = MAX_ROW_SWEEP_BITS
) -> float:
    """Fraction of the whole table that is exactly zero.

    Costs 2^(2n) evaluations, for the same reason
    ``differential_uniformity`` does. See ``MAX_ROW_SWEEP_BITS``.
    """
    _check_size(n)
    _check_sweep(2 * n, budget_bits, f"impossible fraction over {n} variables")
    total = 0
    for din in range(1, 1 << n):
        total += impossible_differentials(f, n, m, din)
    return total / (((1 << n) - 1) * (1 << m))
