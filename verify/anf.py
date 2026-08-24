"""Exact algebraic normal form by Moebius transform -- the independent path.

This package is the verification path of section 7.2. It shares no code with
``modules/`` and must never import from it (enforced by
``scripts/ci_checks.py`` and by tests/test_ci_checks.py).

Everything here is exhaustive: a full truth table over the 2^n inputs and a
Moebius transform over it. That is exponential and deliberately so -- a verifier
whose answer depends on the same bounding argument as the module it verifies is
not a verifier. The size guard keeps the exhaustion honest: it refuses rather
than silently sampling.
"""

from __future__ import annotations

from typing import Callable, Sequence

#: Above this many variables an exhaustive truth table stops being a sensible
#: verification path on one machine (2^24 entries). Raising it is a deliberate
#: act, recorded in DECISIONS.md, not a default.
MAX_EXHAUSTIVE_VARS = 24


class ExhaustionRefused(Exception):
    """The requested exhaustive computation exceeds the declared size guard."""


def _check_size(n: int) -> None:
    if n < 0:
        raise ValueError("n must be non-negative")
    if n > MAX_EXHAUSTIVE_VARS:
        raise ExhaustionRefused(
            f"exhaustive truth table over {n} variables exceeds the guard of "
            f"{MAX_EXHAUSTIVE_VARS}; this path does not sample"
        )


def truth_table(f: Callable[[int], int], n: int, out_bit: int) -> list[int]:
    """The 2^n-entry truth table of bit ``out_bit`` of ``f``."""
    _check_size(n)
    return [(f(x) >> out_bit) & 1 for x in range(1 << n)]


def mobius(table: Sequence[int]) -> list[int]:
    """In-place-style Moebius (Reed-Muller) transform: truth table -> ANF."""
    size = len(table)
    if size & (size - 1):
        raise ValueError("truth table length must be a power of two")
    coeffs = list(table)
    step = 1
    while step < size:
        for start in range(0, size, step << 1):
            for i in range(start, start + step):
                coeffs[i + step] ^= coeffs[i]
        step <<= 1
    return coeffs


def degree_from_anf(coeffs: Sequence[int]) -> int:
    """Degree = largest Hamming weight of a monomial index with a 1 coefficient.

    The all-zero function is given degree -1 so that it is never confused with a
    non-zero constant (degree 0).
    """
    best = -1
    for index, coeff in enumerate(coeffs):
        if coeff:
            weight = index.bit_count()
            if weight > best:
                best = weight
    return best


def algebraic_degree_bit(f: Callable[[int], int], n: int, out_bit: int) -> int:
    return degree_from_anf(mobius(truth_table(f, n, out_bit)))


def algebraic_degree(f: Callable[[int], int], n: int, m: int) -> int:
    """Degree of a vectorial function: the maximum over its output bits."""
    return max(algebraic_degree_bit(f, n, bit) for bit in range(m))


def degree_profile(f: Callable[[int], int], n: int, m: int) -> tuple[int, ...]:
    """Per-output-bit degrees, in bit order. Never collapsed to a single number
    by this function -- the caller decides what to do with the spread."""
    return tuple(algebraic_degree_bit(f, n, bit) for bit in range(m))


def monomial_present(f: Callable[[int], int], n: int, out_bit: int, monomial: int) -> bool:
    """Whether the monomial with variable-set mask ``monomial`` appears in the ANF."""
    return bool(mobius(truth_table(f, n, out_bit))[monomial])


# ---------------------------------------------------------------------------
# Higher-order derivatives, used by the blindness tests and by Module 4 later
# ---------------------------------------------------------------------------


def subspace_sum(f: Callable[[int], int], basis: Sequence[int], offset: int = 0) -> int:
    """XOR of f over the affine subspace offset + span(basis).

    This is the k-th order derivative of f in the directions of ``basis``,
    evaluated at ``offset``, with k = len(basis).
    """
    k = len(basis)
    _check_size(k)
    if len(set(basis)) != k:
        raise ValueError("basis vectors must be distinct")
    total = 0
    for mask in range(1 << k):
        point = offset
        m = mask
        i = 0
        while m:
            if m & 1:
                point ^= basis[i]
            m >>= 1
            i += 1
        total ^= f(point)
    return total


def derivative_vanishes(
    f: Callable[[int], int], basis: Sequence[int], offset: int = 0
) -> bool:
    return subspace_sum(f, basis, offset) == 0
