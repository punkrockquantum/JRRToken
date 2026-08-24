"""Blindness class for Module 1: the multiplicative inverse over GF(2^n).

Section 6 of the brief requires, for every negative result: the mechanism, a
blindness statement naming a concrete function class that has the property being
searched for and would still produce the same null, and that class implemented
and run as a test.

This file holds the statement, the class, and the predicate that defines "the
same null". It deliberately imports no measurement code: the measure is injected
by ``tests/test_blindness_inverse.py``, so the demonstration can be run against
the exact reference measure in ``verify/`` and, once it exists, against the
module's own path -- without ``modules/`` and ``verify/`` importing each other.

The null Module 1 can emit is: "the algebraic degree over GF(2) is saturated at
this round count, so no higher-order differential of feasible order vanishes".
The inverse map returns exactly that null, and is inverted by one field
inversion.
"""

from __future__ import annotations

from typing import Any, Callable

from core.targets import InverseMap
from tiers.finding import BlindnessTest

COUNTEREXAMPLE_CLASS = "x -> x^(2^n - 2) over GF(2^n), the multiplicative inverse with 0 -> 0"

BLINDNESS_STATEMENT = (
    "The multiplicative inverse over GF(2^n) has algebraic degree n-1 over GF(2), the "
    "maximum attainable by a permutation, so a degree instrument returns the saturated "
    "null on it. The same function is described exactly by the quadratic relation "
    "x*y = 1 (x != 0) over GF(2^n) and is inverted by a single field inversion. "
    "Algebraic degree over GF(2) does not bound the degree of the implicit multivariate "
    "system over the extension field, so a saturated degree measurement is compatible "
    "with complete algebraic tractability."
)

MECHANISM = (
    "The exponent 2^n - 2 has binary Hamming weight n-1, and the algebraic degree of a "
    "power function over GF(2^n) is the Hamming weight of its exponent; the degree is "
    "therefore maximal for structural reasons that say nothing about the number or the "
    "degree of the implicit equations relating input and output."
)

ALGEBRAIC_TRACTABILITY = {
    "implicit_system": "x*y = 1 for x != 0, y = 0 for x = 0",
    "n_equations": 1,
    "degree_of_system": 2,
    "solving_cost": "one inversion in GF(2^n)",
}


def counterexample(n: int) -> InverseMap:
    return InverseMap.create(n)


def null_predicate(observed_degree: int, n: int) -> bool:
    """The null this measurement emits: degree saturated at the permutation maximum."""
    return observed_degree == n - 1


def check(
    measure: Callable[[Any, int], int],
    n: int,
    *,
    test_id: str,
    computation_id: str,
) -> BlindnessTest:
    """Run ``measure`` on the counterexample class and record whether it returns
    the same null. ``measure(target, n) -> degree``."""
    target = counterexample(n)
    observed = measure(target, n)
    return BlindnessTest(
        test_id=test_id,
        function_class=f"{COUNTEREXAMPLE_CLASS} at n={n}",
        passed=null_predicate(observed, n),
        computation_id=computation_id,
        observed=f"algebraic_degree={observed} saturated_maximum={n - 1}",
    )
