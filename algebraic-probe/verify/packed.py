"""Exhaustive ANF over a bit-packed truth table -- the same computation as
``verify/anf.py``, carried out on machine words instead of Python lists.

Why this file exists. ``anf.py`` stores one Python ``int`` per truth-table entry
and refuses above 24 variables. Keccak-f[25] has 25 free bits, so the reference
path cannot reach it: 2^25 list entries per output bit, 25 output bits, is
roughly 7 GB of boxed integers. The identical mathematics fits in 4 MB per output
bit if the truth table is packed one bit per input, because every step of the
Moebius transform is then a mask, a shift and an XOR over the whole table at
once.

Representation. A *column* is a single integer of 2^n bits in which bit ``x``
holds the value of some Boolean function at input ``x``. Nothing else is stored:

  - the input variables themselves are columns (``input_columns``), so a target
    can be evaluated on all 2^n inputs simultaneously by running its own
    operations on columns rather than on integers;
  - ``moebius_column`` turns a truth-table column into an ANF-coefficient column
    in n mask-shift-XOR steps;
  - ``degree_of_column`` reads the degree off the coefficient column by
    intersecting it with precomputed Hamming-weight masks.

This is exhaustive in exactly the sense ``anf.py`` is: the whole input space is
consumed, nothing is sampled, and the result is Tier E. It is a second
implementation of one definition, not a second definition, and
``tests/test_verify_packed.py`` pins it against ``anf.py`` over every target
small enough for both to run.

It shares no code with ``modules/`` and must never import from it, the same
constraint ``anf.py`` carries (``scripts/ci_checks.py``).
"""

from __future__ import annotations

from typing import Callable, Sequence

#: Above this many variables the packed path stops fitting in a working set one
#: machine can hold: a column is 2^n bits, and a full evaluation needs on the
#: order of 60 live columns plus n+1 weight masks. At n = 26 that is 8 MB per
#: column and roughly 700 MB peak. Raising it is a deliberate act, recorded in
#: DECISIONS.md, not a default. See D-034.
MAX_PACKED_VARS = 26


class ExhaustionRefused(Exception):
    """The requested exhaustive computation exceeds the declared size guard."""


def _check_size(n: int) -> None:
    if n < 0:
        raise ValueError("n must be non-negative")
    if n > MAX_PACKED_VARS:
        raise ExhaustionRefused(
            f"packed truth table over {n} variables exceeds the guard of "
            f"{MAX_PACKED_VARS}; this path does not sample"
        )


def full_mask(n: int) -> int:
    """The all-ones column: every one of the 2^n positions set."""
    _check_size(n)
    return (1 << (1 << n)) - 1


def _repeat(block: int, period: int, total_bits: int) -> int:
    """Tile ``block`` (which occupies ``period`` bits) up to ``total_bits``."""
    value = block
    width = period
    while width < total_bits:
        value |= value << width
        width <<= 1
    return value & ((1 << total_bits) - 1)


def low_mask(n: int, index: int) -> int:
    """Positions ``x`` in [0, 2^n) whose bit ``index`` is clear.

    The pattern is 2^index ones followed by 2^index zeros, tiled.
    """
    _check_size(n)
    if not 0 <= index < n:
        raise ValueError(f"variable index {index} out of range for n={n}")
    step = 1 << index
    block = (1 << step) - 1
    return _repeat(block, step << 1, 1 << n)


def input_columns(n: int) -> list[int]:
    """The n input variables as columns.

    Bit ``x`` of ``input_columns(n)[i]`` is bit ``i`` of ``x`` -- that is, the
    value of the variable ``x_i`` at input ``x``. Evaluating a target's own
    bitwise operations on these columns evaluates it at every input at once.
    """
    _check_size(n)
    universe = full_mask(n)
    return [universe ^ low_mask(n, i) for i in range(n)]


def pack_truth_table(f: Callable[[int], int], n: int, m: int) -> list[int]:
    """Columns for each of the m output bits of ``f``, by calling ``f`` 2^n times.

    The general path, for a target with no bitsliced evaluation. It is the
    expensive one -- 2^n Python-level calls -- and exists so that the packed
    degree computation is available for every target, not only the ones with a
    hand-written column evaluator.
    """
    _check_size(n)
    columns = [0] * m
    for x in range(1 << n):
        value = f(x)
        bit = 1 << x
        for out_bit in range(m):
            if (value >> out_bit) & 1:
                columns[out_bit] |= bit
    return columns


def moebius_column(column: int, n: int) -> int:
    """Truth-table column -> ANF-coefficient column.

    The transform is ``for i, for every x with bit i set: a[x] ^= a[x ^ 2^i]``.
    Packed, the whole inner loop is one operation: take the positions whose bit
    ``i`` is clear, shift them up by 2^i so they land on their bit-i-set
    partners, and XOR. No position leaves [0, 2^n), so no masking is needed.
    """
    _check_size(n)
    coefficients = column
    for index in range(n):
        step = 1 << index
        coefficients ^= (coefficients & low_mask(n, index)) << step
    return coefficients


def weight_masks(n: int) -> list[int]:
    """``masks[j]`` has bit ``x`` set exactly when ``x`` has Hamming weight j.

    Built by induction on the number of variables: adding a variable doubles the
    universe, and a position in the upper half has one more set bit than the
    corresponding position in the lower half.
    """
    _check_size(n)
    masks = [1]  # n = 0: the single position 0, of weight 0
    for index in range(n):
        half = 1 << index
        nxt = [0] * (index + 2)
        for weight, mask in enumerate(masks):
            nxt[weight] |= mask
            nxt[weight + 1] |= mask << half
        masks = nxt
    return masks


def degree_of_column(
    coefficients: int, n: int, masks: Sequence[int] | None = None
) -> int:
    """Degree of the function whose ANF-coefficient column this is.

    The all-zero function is given degree -1, matching
    ``verify.anf.degree_from_anf``, so it is never confused with a non-zero
    constant of degree 0.
    """
    _check_size(n)
    if coefficients == 0:
        return -1
    table = weight_masks(n) if masks is None else masks
    for weight in range(n, -1, -1):
        if coefficients & table[weight]:
            return weight
    return -1


def degree_profile_from_columns(columns: Sequence[int], n: int) -> tuple[int, ...]:
    """Per-output-bit degrees from truth-table columns. Never collapsed here."""
    _check_size(n)
    masks = weight_masks(n)
    return tuple(
        degree_of_column(moebius_column(column, n), n, masks) for column in columns
    )


def algebraic_degree_packed(f: Callable[[int], int], n: int, m: int) -> int:
    """Degree of a vectorial function: the maximum over its output bits."""
    return max(degree_profile_from_columns(pack_truth_table(f, n, m), n))
