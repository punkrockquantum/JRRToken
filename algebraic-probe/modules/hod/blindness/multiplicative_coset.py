"""Module 4 blindness class: an integral over a multiplicative coset.

A degree bound quantifies over AFFINE subspaces: deg <= d means every derivative
in d+1 linearly independent directions vanishes. The null Module 4 emits is
therefore "the degree has saturated, so no distinguisher below the full input
space is guaranteed".

Take a power map over GF(2^n) whose exponent has maximal Hamming weight n-1. The
degree measure reports saturation and demands 2^n chosen inputs. Yet summing the
map over any coset of the multiplicative subgroup of order s | 2^n - 1 gives
zero, so a distinguisher exists using s inputs. At n = 9 with s = 7 that is
seven points against five hundred and twelve.

The structure is multiplicative and the measure only sees additive structure, so
no degree bound however tight can detect it. That makes the blindness a property
of the quantity rather than of any bounding argument.
"""

from __future__ import annotations

from typing import Any, Callable

from core.gf2 import GF2n
from core.targets import PowerMap
from tiers.finding import BlindnessTest

COUNTEREXAMPLE_CLASS = (
    "x -> x^e over GF(2^n) with wt(e) = n-1, distinguished by summing over a coset "
    "of the multiplicative subgroup of order s dividing 2^n - 1"
)

BLINDNESS_STATEMENT = (
    "A degree bound quantifies over affine subspaces only. A power map of maximal "
    "Boolean degree therefore yields the saturation null and an implied data "
    "requirement of 2^n chosen inputs, while its sum over any coset of a "
    "multiplicative subgroup of order s vanishes, giving a distinguisher on s "
    "inputs. The two structures are unrelated, so no tightening of the degree "
    "bound can surface this one."
)

MECHANISM = (
    "x^e restricted to a multiplicative coset cH is the image of a subgroup under a "
    "power map, which is again a coset-indexed multiset closed under the subgroup "
    "action; its GF(2) sum cancels. Affine derivatives cannot express that closure."
)


def subgroup_of_order(n: int, s: int) -> tuple[int, ...]:
    """Elements of the multiplicative subgroup of order ``s`` of GF(2^n)*."""
    order = (1 << n) - 1
    if order % s:
        raise ValueError(f"{s} does not divide 2^{n} - 1 = {order}")
    field = GF2n(n)
    for candidate in range(2, order):
        if field.pow(candidate, order) != 1:
            continue
        h = field.pow(candidate, order // s)
        elements = {field.pow(h, i) for i in range(s)}
        if len(elements) == s:
            return tuple(sorted(elements))
    raise ValueError(f"no subgroup of order {s} located in GF(2^{n})")  # pragma: no cover


def coset_sum(target: Any, n: int, subgroup: tuple[int, ...], multiplier: int) -> int:
    field = GF2n(n)
    total = 0
    for element in subgroup:
        total ^= target(field.mul(multiplier, element))
    return total


def counterexample(n: int) -> PowerMap:
    order = (1 << n) - 1
    for dropped in range(n):
        e = order ^ (1 << dropped)
        if e and __import__("math").gcd(e, order) == 1:
            return PowerMap.create(n, e)
    raise ValueError(f"no weight-{n - 1} permutation exponent over GF(2^{n})")


def integral_holds(n: int, s: int, multipliers: tuple[int, ...] = (1, 2, 3)) -> bool:
    """Does the coset sum vanish for this class, on several cosets."""
    subgroup = subgroup_of_order(n, s)
    target = counterexample(n)
    return all(coset_sum(target, n, subgroup, m) == 0 for m in multipliers if m)


def null_predicate(observed_degree: int, n: int) -> bool:
    return observed_degree == n - 1


def check(
    measure: Callable[[Any, int], int],
    n: int,
    s: int,
    *,
    test_id: str,
    computation_id: str,
) -> BlindnessTest:
    target = counterexample(n)
    observed = measure(target, n)
    subgroup = subgroup_of_order(n, s)
    return BlindnessTest(
        test_id=test_id,
        function_class=f"{COUNTEREXAMPLE_CLASS} at n={n}, e={target.exponent}, s={s}",
        passed=null_predicate(observed, n),
        computation_id=computation_id,
        observed=(
            f"algebraic_degree={observed} saturated_maximum={n - 1} "
            f"degree_implied_data=2^{n} coset_distinguisher_data={len(subgroup)}"
        ),
    )
