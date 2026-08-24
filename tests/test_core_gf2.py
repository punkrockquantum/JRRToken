"""GF(2)[x] and GF(2^n): the field-defining constants are searched for, not copied."""

from __future__ import annotations

import pytest

from core.gf2 import GF2n, is_irreducible, lowest_irreducible, poly_degree, poly_gcd, poly_mulmod

SIZES = list(range(2, 13))


@pytest.mark.parametrize("n", SIZES)
def test_lowest_irreducible_is_irreducible_and_of_the_right_degree(n: int) -> None:
    f = lowest_irreducible(n)
    assert poly_degree(f) == n
    assert is_irreducible(f)


@pytest.mark.parametrize("n", SIZES)
def test_no_smaller_polynomial_of_that_degree_is_irreducible(n: int) -> None:
    """The 'lowest' in lowest_irreducible is the definition, checked directly."""
    f = lowest_irreducible(n)
    for candidate in range(1 << n, f):
        assert not is_irreducible(candidate)


def test_reducible_polynomials_are_rejected() -> None:
    # (x+1)^2 = x^2 + 1
    assert not is_irreducible(0b101)
    # x^2 + x  is divisible by x
    assert not is_irreducible(0b110)
    # x^2 + x + 1 is the only irreducible quadratic
    assert is_irreducible(0b111)


@pytest.mark.parametrize("n", SIZES)
def test_every_non_zero_element_has_an_inverse(n: int) -> None:
    field = GF2n(n)
    for a in range(1, field.order):
        assert field.mul(a, field.inv(a)) == 1


@pytest.mark.parametrize("n", SIZES)
def test_frobenius_fixes_the_field(n: int) -> None:
    """x^(2^n) = x for every element: the defining property of GF(2^n)."""
    field = GF2n(n)
    for a in field.elements():
        assert field.pow(a, 1 << n) == a


def test_zero_has_no_inverse_and_maps_to_zero() -> None:
    field = GF2n(8)
    assert field.inv(0) == 0


def test_multiplication_is_associative_and_commutative() -> None:
    field = GF2n(8)
    for a in (1, 2, 3, 0x53, 0xCA, 0xFF):
        for b in (1, 7, 0x1F, 0x80):
            assert field.mul(a, b) == field.mul(b, a)
            for c in (2, 0x11):
                assert field.mul(field.mul(a, b), c) == field.mul(a, field.mul(b, c))


def test_poly_gcd_of_coprime_polynomials_is_a_unit() -> None:
    assert poly_degree(poly_gcd(0b111, 0b1011)) == 0


def test_reduction_stays_below_the_modulus_degree() -> None:
    field = GF2n(8)
    for a in (0xFF, 0x80, 0x01):
        for b in (0xFF, 0x13):
            assert poly_mulmod(a, b, field.modulus) < 256


def test_a_non_irreducible_modulus_is_refused() -> None:
    with pytest.raises(ValueError, match="not irreducible"):
        GF2n(4, modulus=0b10001)  # x^4 + 1 = (x+1)^4
