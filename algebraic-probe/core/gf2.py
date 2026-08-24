"""GF(2)[x] and GF(2^n) arithmetic, standard library only.

Section 8, VALIDATION: "constants derived from their definitions rather than
copied from a table where that is feasible". The field-defining polynomials here
are *searched for* -- ``lowest_irreducible(n)`` returns the lexicographically
smallest irreducible polynomial of degree n over GF(2), established by Rabin's
irreducibility test -- rather than pasted from a table of Conway polynomials.
"""

from __future__ import annotations

from functools import lru_cache

# ---------------------------------------------------------------------------
# Polynomials over GF(2), represented as integers: bit i is the coefficient of x^i
# ---------------------------------------------------------------------------


def poly_degree(a: int) -> int:
    if a == 0:
        raise ValueError("the zero polynomial has no degree")
    return a.bit_length() - 1


def poly_mul(a: int, b: int) -> int:
    """Carry-less multiplication."""
    result = 0
    while b:
        if b & 1:
            result ^= a
        a <<= 1
        b >>= 1
    return result


def poly_mod(a: int, m: int) -> int:
    if m == 0:
        raise ZeroDivisionError("modulus must be non-zero")
    dm = poly_degree(m)
    while a and a.bit_length() - 1 >= dm:
        a ^= m << (a.bit_length() - 1 - dm)
    return a


def poly_mulmod(a: int, b: int, m: int) -> int:
    return poly_mod(poly_mul(a, b), m)


def poly_gcd(a: int, b: int) -> int:
    while b:
        a, b = b, poly_mod(a, b)
    return a


def poly_powmod(base: int, exponent: int, m: int) -> int:
    result = 1
    base = poly_mod(base, m)
    while exponent:
        if exponent & 1:
            result = poly_mulmod(result, base, m)
        base = poly_mulmod(base, base, m)
        exponent >>= 1
    return result


def _prime_factors(n: int) -> list[int]:
    factors: list[int] = []
    d = 2
    while d * d <= n:
        if n % d == 0:
            factors.append(d)
            while n % d == 0:
                n //= d
        d += 1
    if n > 1:
        factors.append(n)
    return factors


def is_irreducible(f: int) -> bool:
    """Rabin's test: f of degree n is irreducible over GF(2) iff
    x^(2^n) == x (mod f) and gcd(x^(2^(n/p)) - x, f) == 1 for every prime p | n.
    """
    n = poly_degree(f)
    if n <= 0:
        return False
    if f & 1 == 0:  # divisible by x
        return False
    if n == 1:
        return True

    def x_to_2_to_k(k: int) -> int:
        value = 2  # the polynomial x
        for _ in range(k):
            value = poly_mulmod(value, value, f)
        return value

    for p in _prime_factors(n):
        h = x_to_2_to_k(n // p) ^ 2  # x^(2^(n/p)) - x, and -1 == +1 over GF(2)
        if h == 0:
            return False
        if poly_degree(poly_gcd(f, h)) != 0:
            return False
    return x_to_2_to_k(n) == 2


@lru_cache(maxsize=None)
def lowest_irreducible(n: int) -> int:
    """The lexicographically smallest irreducible polynomial of degree n."""
    if n < 1:
        raise ValueError("n must be at least 1")
    if n == 1:
        return 0b10  # x
    for tail in range(1, 1 << n, 2):  # constant term must be 1
        candidate = (1 << n) | tail
        if is_irreducible(candidate):
            return candidate
    raise RuntimeError(f"no irreducible polynomial of degree {n} found")  # unreachable


# ---------------------------------------------------------------------------
# The field GF(2^n)
# ---------------------------------------------------------------------------


class GF2n:
    """GF(2^n) with the lexicographically smallest irreducible modulus."""

    __slots__ = ("n", "modulus", "order")

    def __init__(self, n: int, modulus: int | None = None) -> None:
        if n < 1:
            raise ValueError("n must be at least 1")
        self.n = n
        self.modulus = lowest_irreducible(n) if modulus is None else modulus
        if poly_degree(self.modulus) != n or not is_irreducible(self.modulus):
            raise ValueError(f"modulus {self.modulus:#x} is not irreducible of degree {n}")
        self.order = 1 << n

    def __repr__(self) -> str:  # pragma: no cover - trivial
        return f"GF2n(n={self.n}, modulus={self.modulus:#x})"

    def mul(self, a: int, b: int) -> int:
        return poly_mulmod(a, b, self.modulus)

    def pow(self, a: int, e: int) -> int:
        if e < 0:
            raise ValueError("use inv() for negative exponents")
        if a == 0:
            return 0 if e > 0 else 1
        return poly_powmod(a, e, self.modulus)

    def inv(self, a: int) -> int:
        """Multiplicative inverse; 0 maps to 0 (the usual cryptographic convention)."""
        if a == 0:
            return 0
        return self.pow(a, self.order - 2)

    def elements(self):
        return range(self.order)
