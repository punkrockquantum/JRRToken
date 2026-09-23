"""Blindness class for Module 6: the plain relation is the special case.

Section 6 requires, for every negative result, the mechanism, a blindness
statement naming a concrete function class that has the property being searched
for and would still produce the same null, and that class implemented and run as
a test.

Module 6's null is "the rotational pair does not propagate above the random
level". The measure asks one question -- does ``f(x <<< r)`` equal
``f(x) <<< r`` -- and a design's round constants are enough to make the answer
*never*, while leaving the structure entirely intact.

``core.targets.RotateXorConstant`` is the class: ``f(x) = (x <<< r) XOR C``.

    f(x <<< r) = (x <<< 2r) XOR C
    f(x) <<< r = (x <<< 2r) XOR (C <<< r)

These agree only when ``C == C <<< r``. For a constant that is not
rotation-invariant they agree at **no input at all**, so the plain measure
returns probability exactly 0 -- not merely at the random level, but the
strongest null it can emit.

Meanwhile the offset between the two sides is ``C XOR (C <<< r)``, the same
value at every input: a rotational-XOR characteristic of probability exactly 1.
Measured at width 16, amount 3, C = 0x00FF: plain propagation 0/65536, one
distinct offset (0x707) across all 65536 inputs.

So the measure reports its strongest null for a function that is *completely*
transparent to the generalised relation. This is the sharpest blindness class in
the repository, because both numbers are exact rather than elevated or reduced:
0 and 1.

It is also why the technique is called rotational-**XOR**. A module measuring
only the plain relation is measuring the special case ``offset = 0`` of the
thing that matters.

No measurement code is imported here. Both measures are injected by
``tests/test_blindness_rx.py``, so ``modules/`` and ``verify/`` stay independent.
"""

from __future__ import annotations

from typing import Any, Callable

from core.targets import RotateXorConstant
from tiers.finding import BlindnessTest

COUNTEREXAMPLE_CLASS = (
    "f(x) = (x <<< r) XOR C with C not rotation-invariant "
    "(core.targets.RotateXorConstant): plain rotational probability exactly 0, "
    "rotational-XOR probability exactly 1"
)

BLINDNESS_STATEMENT = (
    "The plain rotational relation asks whether f(x <<< r) equals f(x) <<< r. "
    "Adding a constant C after a rotation makes the two sides differ by "
    "C XOR (C <<< r) at every input, so they are equal at no input whenever C "
    "is not rotation-invariant and the measure returns probability 0 -- its "
    "strongest null. The difference is nevertheless the same constant "
    "everywhere, which is a rotational-XOR characteristic holding with "
    "probability 1. The null 'no rotational propagation' is therefore "
    "compatible with total rotational-XOR structure, and a design's round "
    "constants alone are enough to produce it."
)

MECHANISM = (
    "Rotation commutes with XOR but not with a *fixed* operand: rotating "
    "(y XOR C) gives (y <<< r) XOR (C <<< r), not (y <<< r) XOR C. The measure "
    "compares two values for equality and has no way to notice that they differ "
    "by a constant, because a constant offset is invisible to an equality test. "
    "The generalisation is to compare up to a fixed XOR difference, which is a "
    "different measurement rather than a more careful version of this one."
)

#: What refuting this class would look like.
FALSIFIER = (
    "if the plain measure returned a non-zero probability for a non-invariant "
    "constant, it would already be tolerating an offset and this class would "
    "not be a blindness class; if the offset varied with the input there would "
    "be no rotational-XOR characteristic for the measure to miss"
)

#: The exact values the class produces. Both endpoints, neither approximate.
EXPECTED_PLAIN_PROBABILITY = 0.0
EXPECTED_DISTINCT_OFFSETS = 1


def counterexample(width: int = 16, amount: int = 3, constant: int = 0x00FF) -> RotateXorConstant:
    target = RotateXorConstant.create(width, amount, constant)
    if target.expected_rx_offset == 0:
        raise ValueError(
            "a rotation-invariant constant leaves the plain relation holding "
            "everywhere; there would be nothing for the measure to miss"
        )
    return target


def null_predicate(plain_probability: float) -> bool:
    """The null this measurement emits: no propagation at all."""
    return plain_probability == 0.0


def structure_predicate(distinct_offsets: int) -> bool:
    """The property being searched for, present in the counterexample.

    One distinct offset across every input *is* a probability-1 rotational-XOR
    characteristic. A blindness class must have the structure, not merely evade
    the measure.
    """
    return distinct_offsets == EXPECTED_DISTINCT_OFFSETS


def check(
    plain_measure: Callable[[Any, int, int], float],
    offset_measure: Callable[[Any, int, int], dict[int, int]],
    *,
    width: int = 16,
    amount: int = 3,
    constant: int = 0x00FF,
    test_id: str,
    computation_id: str,
) -> BlindnessTest:
    """Run both measures on the counterexample.

    ``plain_measure(target, width, amount)`` returns the plain rotational
    probability; ``offset_measure`` returns the XOR offsets and their counts.

    Passes only if the measure returns its null *and* the rotational-XOR
    structure is really there.
    """
    target = counterexample(width, amount, constant)
    plain = plain_measure(target, width, amount)
    offsets = offset_measure(target, width, amount)

    same_null = null_predicate(plain)
    has_structure = structure_predicate(len(offsets))

    return BlindnessTest(
        test_id=test_id,
        function_class=f"{COUNTEREXAMPLE_CLASS} at width={width}, r={amount}, C={constant:#x}",
        passed=same_null and has_structure,
        computation_id=computation_id,
        observed=(
            f"plain_probability={plain} reports_no_propagation={same_null} "
            f"distinct_rx_offsets={len(offsets)} "
            f"rx_offset={target.expected_rx_offset:#x} "
            f"structure_present={has_structure}"
        ),
    )
