"""Stage A5 blindness class: a saturated-degree permutation inverted by one
exponentiation.

The null Module 1 emits on an arithmetisation-oriented target is "the algebraic
degree over GF(2) has saturated at n-1, so no higher-order differential of
feasible order vanishes". This class returns exactly that null and is inverted by
a single field exponentiation.

Take x -> x^e over GF(2^n) with wt(e) = n-1 and gcd(e, 2^n - 1) = 1. The degree
is wt(e) = n-1, the maximum for a permutation, so the measure reports saturation.
Yet the map is a permutation with inverse x -> x^(e^-1 mod 2^n - 1): one
exponentiation, no search, and the implicit relation y = x^e is a single
univariate equation.

This is distinct from ``inverse_map``: that class is the specific exponent
2^n - 2, and its triviality is the well-known quadratic relation x*y = 1. Here
the exponent is an ordinary one of maximal Hamming weight, so the class shows
that saturation of the *Boolean* degree carries no information about the degree
or the count of the *univariate* relations -- which is the quantity the AO
literature actually disputes.
"""

from __future__ import annotations

from math import gcd
from typing import Any, Callable

from core.gf2 import GF2n
from core.targets import PowerMap
from tiers.finding import BlindnessTest

COUNTEREXAMPLE_CLASS = (
    "x -> x^e over GF(2^n) with wt(e) = n-1 and gcd(e, 2^n - 1) = 1: a permutation "
    "of maximal Boolean degree inverted by a single exponentiation"
)

BLINDNESS_STATEMENT = (
    "A permutation of GF(2^n) whose exponent has Hamming weight n-1 has algebraic "
    "degree n-1 over GF(2), the maximum attainable, so a degree instrument reports "
    "saturation and emits its null. The same map is inverted by one exponentiation "
    "to e^-1 mod 2^n - 1 and is described by the single univariate relation y = x^e. "
    "Saturation of the Boolean degree therefore carries no information about the "
    "degree or the number of univariate relations, which is the quantity that "
    "governs the algebraic cost of an arithmetisation-oriented design."
)

MECHANISM = (
    "The Boolean degree of a power map is the Hamming weight of its exponent, and "
    "Hamming weight is invariant under the multiplicative structure that makes the "
    "map easy to invert. A high weight is therefore compatible with an exponent "
    "whose inverse modulo 2^n - 1 is immediately computable."
)


def saturating_exponents(n: int) -> tuple[int, ...]:
    """Every exponent of weight n-1 that is a permutation of GF(2^n)."""
    order = (1 << n) - 1
    found = []
    for dropped in range(n):
        e = order ^ (1 << dropped)  # all ones but one bit
        if e and gcd(e, order) == 1:
            found.append(e)
    return tuple(sorted(set(found)))


def counterexample(n: int) -> PowerMap:
    candidates = saturating_exponents(n)
    if not candidates:
        raise ValueError(f"no weight-{n - 1} permutation exponent exists over GF(2^{n})")
    return PowerMap.create(n, candidates[0])


def inverse_exponent(n: int, e: int) -> int:
    order = (1 << n) - 1
    return pow(e, -1, order)


def is_inverted_by_one_exponentiation(n: int, e: int) -> bool:
    """Check the inversion claim rather than asserting it."""
    field = GF2n(n)
    d = inverse_exponent(n, e)
    return all(field.pow(field.pow(x, e), d) == x for x in range(1 << n))


def null_predicate(observed_degree: int, n: int) -> bool:
    """The null: degree saturated at the permutation maximum."""
    return observed_degree == n - 1


def check(
    measure: Callable[[Any, int], int],
    n: int,
    *,
    test_id: str,
    computation_id: str,
) -> BlindnessTest:
    target = counterexample(n)
    observed = measure(target, n)
    return BlindnessTest(
        test_id=test_id,
        function_class=f"{COUNTEREXAMPLE_CLASS} at n={n}, e={target.exponent}",
        passed=null_predicate(observed, n),
        computation_id=computation_id,
        observed=(
            f"algebraic_degree={observed} saturated_maximum={n - 1} "
            f"inverse_exponent={inverse_exponent(n, target.exponent)}"
        ),
    )
