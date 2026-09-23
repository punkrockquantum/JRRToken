"""Rotational propagation counted exhaustively -- M6's independent path.

Section 7.2 makes an independent verification path a precondition of promotion.
``modules/rx`` computes the probability that one modular addition propagates a
rotational pair from a closed form over carry patterns. This file computes it by
**counting every pair** ``(x, y)`` at a stated width and dividing.

The two share no code and proceed by wholly different means: one is arithmetic
over carry cases, the other is a loop over ``2^(2n)`` pairs. A disagreement means
the closed form is wrong, which is the failure this file exists to catch -- a
formula written from a derivation is a claim until something counts it.

Nothing here imports ``modules/`` and nothing in ``modules/`` may import it
(``scripts/ci_checks.py``).
"""

from __future__ import annotations

from fractions import Fraction
from typing import Callable

#: 2^(2n) pairs per width. Above this the path refuses rather than sampling.
MAX_ENUMERATED_BITS = 12


class RotationalVerifyRefused(Exception):
    """The requested enumeration exceeds the declared size guard."""


def _rotl(value: int, amount: int, width: int) -> int:
    amount %= width
    mask = (1 << width) - 1
    value &= mask
    return ((value << amount) | (value >> (width - amount))) & mask


def count_addition_propagation(width: int, amount: int) -> tuple[int, int]:
    """Pairs whose addition propagates, and pairs examined.

    Counted over every ``(x, y)`` in ``[0, 2^width)^2``. No arithmetic about
    carries happens here; the addition is performed and the two sides compared.
    """
    if width < 1:
        raise ValueError("width must be positive")
    if width > MAX_ENUMERATED_BITS:
        raise RotationalVerifyRefused(
            f"enumerating {2 * width} bits of pairs exceeds the guard of "
            f"{2 * MAX_ENUMERATED_BITS}; this path does not sample"
        )
    if not 0 <= amount < width:
        raise ValueError(f"rotation amount {amount} is outside [0, {width})")

    mask = (1 << width) - 1
    hits = 0
    for x in range(1 << width):
        rx = _rotl(x, amount, width)
        for y in range(1 << width):
            left = _rotl((x + y) & mask, amount, width)
            right = (rx + _rotl(y, amount, width)) & mask
            if left == right:
                hits += 1
    return hits, 1 << (2 * width)


def addition_propagation_fraction(width: int, amount: int) -> Fraction:
    """The counted probability, exact."""
    hits, total = count_addition_propagation(width, amount)
    return Fraction(hits, total)


def count_function_propagation(
    function: Callable[[int], int], width: int, amount: int
) -> tuple[int, int]:
    """Inputs at which a stated function propagates a rotational pair.

    Exhaustive over the input space, so this is the ground truth the sampled
    path is checked against at widths small enough to enumerate.
    """
    if width < 1:
        raise ValueError("width must be positive")
    if width > 2 * MAX_ENUMERATED_BITS:
        raise RotationalVerifyRefused(
            f"enumerating {width} bits exceeds the guard; this path does not sample"
        )
    hits = 0
    for x in range(1 << width):
        if function(_rotl(x, amount, width)) == _rotl(function(x), amount, width):
            hits += 1
    return hits, 1 << width


def rx_offsets(
    function: Callable[[int], int], width: int, amount: int
) -> dict[int, int]:
    """Every XOR offset a rotational pair picks up, and how often.

    A single key means the offset is constant -- a rotational-XOR
    characteristic of probability 1. A single key equal to 0 means the plain
    rotational relation holds everywhere. The plain measure cannot tell the two
    apart from its own output, which is M6's blindness class.
    """
    if width > 2 * MAX_ENUMERATED_BITS:
        raise RotationalVerifyRefused("width exceeds the enumeration guard")
    counts: dict[int, int] = {}
    for x in range(1 << width):
        offset = function(_rotl(x, amount, width)) ^ _rotl(function(x), amount, width)
        counts[offset] = counts.get(offset, 0) + 1
    return counts


# -- counting the additions a real implementation performs -------------------


class CountingWord:
    """A 32-bit word that tallies the modular additions it takes part in.

    Rotational propagation through an ARX design is governed by how many
    modular additions it performs, so that count has to be a measurement of the
    implementation rather than a number read off the specification. This wraps
    an int, forwards every operation, and counts only ``+``.

    Used by ``count_additions`` below to instrument ``core.sha256`` itself, so
    the figure traces to the same code ``hashlib`` agrees with.
    """

    __slots__ = ("value", "tally")

    def __init__(self, value: int, tally: list[int]) -> None:
        self.value = value & 0xFFFFFFFF
        self.tally = tally

    def _wrap(self, value: int) -> "CountingWord":
        return CountingWord(value, self.tally)

    @staticmethod
    def _raw(other: object) -> int:
        return other.value if isinstance(other, CountingWord) else int(other)  # type: ignore[arg-type]

    def __add__(self, other: object) -> "CountingWord":
        self.tally[0] += 1
        return self._wrap(self.value + self._raw(other))

    __radd__ = __add__

    def __and__(self, other: object) -> "CountingWord":
        return self._wrap(self.value & self._raw(other))

    __rand__ = __and__

    def __xor__(self, other: object) -> "CountingWord":
        return self._wrap(self.value ^ self._raw(other))

    __rxor__ = __xor__

    def __or__(self, other: object) -> "CountingWord":
        return self._wrap(self.value | self._raw(other))

    __ror__ = __or__

    def __invert__(self) -> "CountingWord":
        return self._wrap(~self.value)

    def __rshift__(self, other: object) -> "CountingWord":
        return self._wrap(self.value >> self._raw(other))

    def __lshift__(self, other: object) -> "CountingWord":
        return self._wrap(self.value << self._raw(other))

    def __index__(self) -> int:
        return self.value

    def __int__(self) -> int:
        return self.value

    def __eq__(self, other: object) -> bool:
        return self.value == self._raw(other)

    def __hash__(self) -> int:
        return hash(self.value)

    def __repr__(self) -> str:
        return f"CountingWord({self.value:#010x})"


def count_additions(n_rounds: int) -> int:
    """Modular additions ``core.sha256.compress`` performs at ``n_rounds``.

    Measured by running the real function with instrumented words, not derived
    from reading it. A change to the implementation changes this number.

    **Both** the message words and the chaining state are instrumented. An
    earlier draft wrapped only the message words and reported 5 additions for a
    single round -- an addition between two plain ints never reaches the
    wrapper, so every addition on the state alone went uncounted. The figure it
    produced was the count of additions *touching a message-derived word*,
    which is a different quantity and was not the one the name promised.
    """
    from core.sha256 import IV, compress

    tally = [0]
    words = [CountingWord(i * 0x01010101, tally) for i in range(16)]
    state = [CountingWord(v, tally) for v in IV]
    compress(words, state, n_rounds)
    return tally[0]
