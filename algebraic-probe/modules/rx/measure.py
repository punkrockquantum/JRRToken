"""Module 6's measurement path: rotational and rotational-XOR propagation.

Section 9 declares the quantity as "rotational-pair propagation probability" and
the tiers as **P and S**.

A *rotational pair* is ``(x, x <<< r)``. A function propagates it when rotating
the input rotates the output: ``f(x <<< r) == f(x) <<< r``. Two facts drive
everything here, and the first is the reason the technique exists:

  **XOR and rotation propagate a rotational pair with probability exactly 1.**
  Rotation distributes over XOR and composes with itself, so any function built
  only from those two operations is *completely transparent* to a rotational
  pair, at any number of rounds. Deductive, Tier P, no sampling.

  **Modular addition does not.** ``(x + y) <<< r`` and ``(x <<< r) + (y <<< r)``
  differ whenever the carry crossing the rotation boundary differs. The exact
  probability is computed here by counting the carry patterns that agree, and
  checked against a full enumeration in ``verify/rotational.py``.

So a rotational distinguisher's probability is determined by how many modular
additions a design performs, not by how many rounds it runs. That is the number
this module reports.

Three quantities:

  ``linear_propagation``        Tier P. Exactly 1, for any XOR/rotation circuit.

  ``addition_probability``      Tier P. The exact rational probability for one
                                modular addition at a stated word width and
                                rotation amount, from a counted derivation.

  ``sampled_propagation``       Tier S. Draw inputs, count the pairs that
                                propagate, report the rate with an exact
                                Clopper-Pearson interval. Never a bare point.

**What this is not.** A rotational pair is the *plain* relation. Allowing a
constant XOR difference alongside the rotation gives a rotational-XOR (RX) pair,
and a design whose round constants destroy the plain relation can still carry an
RX one -- with probability 1, for a pure rotation-XOR round.
``blindness/rotational_xor.py`` exhibits exactly that, so a null from the plain
measure is not evidence that no rotational structure exists.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from fractions import Fraction
from typing import Any, Callable, Sequence

from stats.power import clopper_pearson_interval
from tiers.errors import ProbeError

#: Seeds per Tier S cell, matching PREREG-M1 and PREREG-M3 so the three modules
#: do not disagree about what a sampled cell is.
SEEDS_PER_CELL = 50

CONFIDENCE = 0.95

#: 2^(2n) pairs to count one addition probability exactly. The counted
#: derivation below is closed-form and costs nothing, but the *enumeration* that
#: checks it lives in verify/ and carries this guard there.
MAX_EXACT_ADDITION_BITS = 12


class RotationalRefused(ProbeError):
    """The requested rotational quantity has no path or exceeds a guard."""


def rotl(value: int, amount: int, width: int) -> int:
    """Rotate left within a stated width. The one primitive everything uses."""
    if width < 1:
        raise RotationalRefused("width must be positive")
    amount %= width
    mask = (1 << width) - 1
    value &= mask
    return ((value << amount) | (value >> (width - amount))) & mask


# -- Tier P: the linear part -------------------------------------------------


def linear_propagation() -> int:
    """Probability 1, as an exact integer rather than a float.

    Rotation distributes over XOR -- ``(a ^ b) <<< r == (a <<< r) ^ (b <<< r)``
    -- and rotations compose. A circuit of XORs and rotations therefore carries
    a rotational pair through unchanged however deep it is. Returned as ``1``
    because this is a deductive fact, and writing it as ``1.0`` would invite a
    reader to take it for an estimate that happened to round to one.
    """
    return 1


def addition_probability(width: int, amount: int) -> Fraction:
    """Tier P. Exact probability that one modular addition propagates.

    Rotating by ``r`` splits the word into a low part of ``r`` bits and a high
    part of ``width - r``. ``(x + y) <<< r`` and ``(x <<< r) + (y <<< r)`` agree
    exactly when the carry out of the low part and the carry out of the whole
    word are consistent with the rotated arrangement, which happens for the
    carry combinations counted below.

    Returned as a ``Fraction`` so the value is exact. A float would make an
    exactly-rational probability look like a measurement.
    """
    if width < 1:
        raise RotationalRefused("width must be positive")
    if not 0 <= amount < width:
        raise RotationalRefused(
            f"rotation amount {amount} is outside [0, {width})"
        )
    if amount == 0:
        # Rotating by nothing is the identity, which every function propagates.
        return Fraction(1)

    # The four carry combinations (carry into the high part, carry out of the
    # word) each agree on a computable fraction of inputs. Counted rather than
    # quoted: verify/rotational.py enumerates every (x, y) pair at small widths
    # and must reproduce this.
    low, high = amount, width - amount
    total = Fraction(1, 4) * (
        1 + Fraction(1, 1 << low) + Fraction(1, 1 << high) + Fraction(1, 1 << width)
    )
    return total


def addition_probability_log2(width: int, amount: int) -> float:
    """The same value in bits, for reporting next to a random level."""
    p = addition_probability(width, amount)
    if p == 0:
        return float("-inf")
    return math.log2(p.numerator) - math.log2(p.denominator)


def additions_to_random_level(
    width: int,
    amount: int,
    n_out_bits: int,
    probability: Fraction | None = None,
) -> int:
    """How many independent modular additions sink a rotational characteristic.

    The smallest ``k`` for which the per-addition probability raised to ``k``
    falls to or below ``2 ** -n_out_bits``. A count, not a probability, and the
    quantity a designer would actually act on.

    Assumes the additions are independent, which is a modelling assumption and
    is stated as one: PREREG-M6 registers it, and the sampled path exists
    precisely because it does not have to make it.

    ``probability`` overrides the derived per-addition value. It exists because
    every probability this module derives is non-dyadic, so ``p ** k`` never
    lands *exactly* on the floor and the boundary between "falls to" and "falls
    below" was unreachable -- a mutant flipping ``>`` to ``>=`` changed no
    output that any caller could obtain. Same lesson as D-057: a branch no
    input can reach is not tested by any suite.
    """
    p = probability if probability is not None else addition_probability(width, amount)
    if p >= 1:
        raise RotationalRefused(
            "a propagation probability of 1 never reaches the random level; "
            "this quantity is meaningful only for an operation that loses "
            "probability"
        )
    if p <= 0:
        return 1
    floor = Fraction(1, 1 << n_out_bits)
    k, running = 0, Fraction(1)
    while running > floor:
        running *= p
        k += 1
    return k


# -- Tier S: the sampled path ------------------------------------------------


@dataclass(frozen=True, slots=True)
class SampledRotational:
    """Tier S. A rate with an interval, never a point."""

    amount: int
    hits: int
    seeds: int
    ci_low: float
    ci_high: float
    n_out: int

    @property
    def rate(self) -> float:
        return self.hits / self.seeds

    @property
    def random_level(self) -> float:
        return 2.0**-self.n_out

    @property
    def interval_excludes_random_level(self) -> bool:
        """The only claim a sampled cell is entitled to make.

        About the interval, never the point estimate -- the distinction D-051
        records, and the reason this module reuses the same rule rather than
        restating it loosely.
        """
        return self.ci_low > self.random_level

    def render(self) -> str:
        return (
            f"amount={self.amount} hits={self.hits}/{self.seeds} "
            f"rate={self.rate:.6g} ci=[{self.ci_low:.6g},{self.ci_high:.6g}] "
            f"random={self.random_level:.6g} "
            f"excludes_random={self.interval_excludes_random_level}"
        )


def sampled_propagation(
    function: Callable[[int], int],
    width: int,
    amount: int,
    seeds: Sequence[int],
    n_out: int | None = None,
) -> SampledRotational:
    """Tier S. One draw per seed, with an exact interval on the rate."""
    if len(set(seeds)) != len(seeds):
        raise RotationalRefused(
            "seeds must be distinct: repeated seeds are not independent draws"
        )
    if len(seeds) < SEEDS_PER_CELL:
        raise RotationalRefused(
            f"a Tier S cell needs {SEEDS_PER_CELL} seeds; got {len(seeds)}"
        )
    hits = 0
    for seed in seeds:
        x = random.Random(seed).randrange(1 << width)
        if function(rotl(x, amount, width)) == rotl(function(x), amount, width):
            hits += 1
    low, high = clopper_pearson_interval(hits, len(seeds), CONFIDENCE)
    return SampledRotational(
        amount=amount,
        hits=hits,
        seeds=len(seeds),
        ci_low=low,
        ci_high=high,
        n_out=n_out if n_out is not None else width,
    )


# -- rotational-XOR ----------------------------------------------------------


def rx_offset(function: Callable[[int], int], width: int, amount: int, x: int) -> int:
    """The XOR offset a rotational pair picks up at one input.

    ``f(x <<< r) ^ (f(x) <<< r)``. Zero exactly when the plain rotational
    relation holds at ``x``; constant across inputs is what makes an RX
    characteristic.
    """
    return function(rotl(x, amount, width)) ^ rotl(function(x), amount, width)


def rx_offset_is_constant(
    function: Callable[[int], int], width: int, amount: int, inputs: Sequence[int]
) -> tuple[bool, int | None]:
    """Whether the offset is the same at every stated input, and what it is.

    Returns ``(constant, offset)``. This is what the plain measure cannot see:
    an offset that is non-zero but *fixed* is a rotational-XOR characteristic
    of probability 1, and the plain measure reports probability 0 for it.
    """
    if not inputs:
        raise RotationalRefused("no inputs to examine")
    first = rx_offset(function, width, amount, inputs[0])
    for x in inputs[1:]:
        if rx_offset(function, width, amount, x) != first:
            return False, None
    return True, first


def measure(target: Any, case: Any) -> Any:
    """Dispatch on the quantity the calibration case names."""
    quantity = case.quantity
    parameters = getattr(case, "parameters", {}) or {}

    if quantity == "linear_propagation":
        return linear_propagation()
    if quantity == "addition_probability_log2":
        return addition_probability_log2(parameters["width"], parameters["amount"])
    if quantity == "additions_to_random_level":
        return additions_to_random_level(
            parameters["width"], parameters["amount"], parameters["n_out_bits"]
        )
    if quantity == "rx_offset_is_zero":
        width, amount = parameters["width"], parameters["amount"]
        inputs = list(range(min(1 << width, parameters.get("probe_inputs", 64))))
        constant, offset = rx_offset_is_constant(target, width, amount, inputs)
        return int(constant and offset == 0)
    raise RotationalRefused(f"no measurement path for quantity {quantity!r}")
