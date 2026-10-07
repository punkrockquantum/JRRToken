"""Blindness class for Module 3: the search looks upward.

Section 6 requires, for every negative result, the mechanism, a blindness
statement naming a concrete function class that has the property being searched
for and would still produce the same null, and that class implemented and run as
a test.

Module 3's null is "no differential above the random level was found". The
threshold is one-sided by construction -- it asks whether a probability *exceeds*
``2^-m`` -- and an impossible differential is as exploitable as a
high-probability one while lying on the other side of it.

``x -> x^3`` over GF(2^n) with n odd is the class, and the numbers are exact
rather than approximate:

  maximum differential probability   2^-(n-1)  -- exactly **one bit** above the
                                                 random level 2^-n
  pairs with probability exactly 0   **50.0%** of the table, at every n measured

So the strongest differential this class has barely clears the threshold, while
half of every row is unreachable. A search that reports "nothing above the random
level" on such a target has described it correctly and missed the structure that
an impossible-differential attack uses.

No measurement code is imported here. Both measures are injected by
``tests/test_blindness_impossible.py``, so ``modules/`` and ``verify/`` stay
independent.
"""

from __future__ import annotations

from typing import Any, Callable

from core.targets import PowerMap
from tiers.finding import BlindnessTest

COUNTEREXAMPLE_CLASS = (
    "x -> x^3 over GF(2^n) with n odd: almost perfect nonlinear, so its best "
    "differential is one bit above the random level while half its table is "
    "exactly impossible"
)

BLINDNESS_STATEMENT = (
    "A differential search thresholded on 'above the random level' is one-sided. "
    "For x -> x^3 over GF(2^n) with n odd the map x -> f(x) ^ f(x ^ din) is "
    "two-to-one for every non-zero din, so every reachable output difference has "
    "exactly two preimages -- probability 2^-(n-1), one bit above the random "
    "level -- and exactly half of all output differences have none at all. The "
    "null 'no differential meaningfully above random' is therefore compatible "
    "with a table that is 50 per cent impossible, and an impossible differential "
    "supports an attack just as a probable one does. The measure is correct about "
    "what it measures and blind to the other side of its own threshold."
)

MECHANISM = (
    "The derivative of a quadratic power map is affine in x, so its image is a "
    "coset of a subspace of index two: two-to-one onto half the space, and zero "
    "on the other half. The uniformity and the impossibility are the same fact "
    "seen from opposite sides, and a one-sided threshold can only see one of "
    "them."
)

#: What refuting the class would look like.
FALSIFIER = (
    "if the maximum differential probability were more than one bit above the "
    "random level, the search would register it strongly and the class would not "
    "reproduce the null; if the impossible fraction were zero there would be "
    "nothing for the search to be blind to"
)

#: The impossible fraction is exactly one half, by the mechanism above. Measured
#: at n = 7, 9 and 11 and equal at each.
EXPECTED_IMPOSSIBLE_FRACTION = 0.5


def counterexample(n: int) -> PowerMap:
    if n % 2 == 0:
        raise ValueError(
            f"x^3 is not a permutation of GF(2^{n}) for even n, and is not APN there"
        )
    return PowerMap.create(n, 3)


def null_predicate(max_count: int, n: int) -> bool:
    """The null: the best differential is no more than one bit above random.

    A count of 2 out of 2^n is probability 2^-(n-1) against a random level of
    2^-n, which is the smallest elevation an even-counted table can show.
    """
    return max_count <= 2


def structure_predicate(impossible_fraction: float, tolerance: float = 1e-9) -> bool:
    """The property being searched for, present in the counterexample.

    A blindness class must *have* the structure, not merely evade the measure.
    """
    return abs(impossible_fraction - EXPECTED_IMPOSSIBLE_FRACTION) <= tolerance


def check(
    uniformity_measure: Callable[[Any, int], int],
    impossible_measure: Callable[[Any, int], float],
    *,
    n: int,
    test_id: str,
    computation_id: str,
) -> BlindnessTest:
    """Run both measures on the counterexample.

    ``uniformity_measure(target, n) -> largest count in the table``;
    ``impossible_measure(target, n) -> fraction of the table that is zero``.

    Passes only if the search returns its null *and* the impossible structure is
    really there.
    """
    target = counterexample(n)
    max_count = uniformity_measure(target, n)
    fraction = impossible_measure(target, n)

    same_null = null_predicate(max_count, n)
    has_structure = structure_predicate(fraction)

    return BlindnessTest(
        test_id=test_id,
        function_class=f"{COUNTEREXAMPLE_CLASS} at n={n}",
        passed=same_null and has_structure,
        computation_id=computation_id,
        observed=(
            f"max_differential_count={max_count} p=2^{-(n - 1)} random=2^{-n} "
            f"barely_above_random={same_null} impossible_fraction={fraction:.6g} "
            f"structure_present={has_structure}"
        ),
    )
