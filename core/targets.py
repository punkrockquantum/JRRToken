"""Target functions: the controls of section 5, and the target registry.

These are *targets*, not measurements. Nothing here computes an algebraic
degree; ``verify.anf`` does that, independently of any module.

Each control carries the analytically known value of the quantity a module is
supposed to measure, together with the derivation of that value. The derivation
is a claim, so every one of them is also checked in-repo by exhaustive ANF at
small n (tests/test_core_targets.py), which is what turns it into provenance.
"""

from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass
from typing import Protocol

from .gf2 import GF2n


class VectorialFunction(Protocol):
    """An (n_in -> n_out)-bit function, evaluated on integers."""

    target_id: str
    n_in: int
    n_out: int

    def __call__(self, x: int) -> int: ...


def _check_input(x: int, n_in: int, target_id: str) -> None:
    """Refuse an out-of-range input rather than truncating it.

    An exhaustive measurement walks range(2**n). If the target quietly masks its
    input, a wrong n produces a complete, self-consistent, wrong answer -- the
    worst failure mode this instrument has, because nothing raises.
    """
    if not 0 <= x < (1 << n_in):
        raise ValueError(f"{target_id}: input {x} out of range for {n_in} bits")


# ---------------------------------------------------------------------------
# POSITIVE CONTROL: g(x) = Ax over GF(2), A random invertible.
#
# The counterexample that exposed the prior instrument's blindness (section 1,
# finding B). Degree 1 in every output bit, fully reachable, invertible by
# Gaussian elimination. Any module that cannot see structure here is broken.
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class LinearMapGF2:
    n: int
    seed: int
    rows: tuple[int, ...]

    target_id: str = "linear-map-gf2"

    # Arity is derived, never stored. A stored field with a default lets a
    # hand-constructed target declare n_in = 0, and a measurement over zero
    # variables returns a confidently wrong answer instead of failing.
    @property
    def n_in(self) -> int:
        return self.n

    @property
    def n_out(self) -> int:
        return self.n

    @staticmethod
    def random_invertible(n: int, seed: int) -> "LinearMapGF2":
        rng = random.Random(seed)
        for _ in range(10_000):
            rows = tuple(rng.getrandbits(n) for _ in range(n))
            if _rank_gf2(rows, n) == n:
                return LinearMapGF2(n=n, seed=seed, rows=rows)
        raise RuntimeError("failed to draw an invertible matrix")  # pragma: no cover

    def __call__(self, x: int) -> int:
        _check_input(x, self.n, self.target_id)
        out = 0
        for i, row in enumerate(self.rows):
            out |= (_parity(row & x)) << i
        return out

    @property
    def expected_degree(self) -> int:
        return 1

    @property
    def expected_degree_derivation(self) -> str:
        return (
            "every output bit is the GF(2) sum of a non-empty subset of input bits, "
            "so its algebraic normal form contains only degree-1 monomials; the subset "
            "is non-empty because A is invertible, hence has no zero row"
        )

    @property
    def is_invertible(self) -> bool:
        return _rank_gf2(self.rows, self.n) == self.n


def _parity(value: int) -> int:
    return bin(value).count("1") & 1


def _rank_gf2(rows: tuple[int, ...], n: int) -> int:
    work = list(rows)
    rank = 0
    for col in range(n):
        pivot = None
        for i in range(rank, len(work)):
            if (work[i] >> col) & 1:
                pivot = i
                break
        if pivot is None:
            continue
        work[rank], work[pivot] = work[pivot], work[rank]
        for i in range(len(work)):
            if i != rank and (work[i] >> col) & 1:
                work[i] ^= work[rank]
        rank += 1
    return rank


# ---------------------------------------------------------------------------
# INTERMEDIATE CONTROL: the power map x -> x^d over GF(2^n).
#
# Known, non-trivial, non-extreme algebraic degree: deg(x^d) = wt(d), the
# Hamming weight of the exponent. Choosing d with wt(d) = k puts the answer in
# the middle of the range [1, n-1] rather than at an endpoint. x^3 (wt = 2) is
# also the MiMC round function, so this control sits on the path to the
# secondary targets of section 9.
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PowerMap:
    n: int
    exponent: int
    field: GF2n

    target_id: str = "power-map-gf2n"

    @property
    def n_in(self) -> int:
        return self.n

    @property
    def n_out(self) -> int:
        return self.n

    @staticmethod
    def create(n: int, exponent: int) -> "PowerMap":
        if exponent <= 0:
            # x^0 is the constant 1, of degree 0, and the wt(d) rule below does
            # not describe it: 0 mod (2^n - 1) is 0, which the reduction used
            # for exponents that are multiples of 2^n - 1 would map to n. A
            # control whose stated expected value is wrong is worse than no
            # control, so this is refused rather than special-cased.
            raise ValueError(
                f"power-map exponent must be positive; x^{exponent} is not a "
                "power map with degree wt(d)"
            )
        return PowerMap(n=n, exponent=exponent, field=GF2n(n))

    def __call__(self, x: int) -> int:
        _check_input(x, self.n, self.target_id)
        return self.field.pow(x, self.exponent)

    @property
    def expected_degree(self) -> int:
        return bin(self.exponent % (2**self.n - 1) or (2**self.n - 1)).count("1")

    @property
    def expected_degree_derivation(self) -> str:
        return (
            "the algebraic degree of the power function x -> x^d over GF(2^n) equals "
            "wt(d), the binary Hamming weight of d taken modulo 2^n - 1: x^(2^i) is "
            "GF(2)-linear, so a product of wt(d) such factors has degree wt(d), and no "
            "cancellation reduces it"
        )


# ---------------------------------------------------------------------------
# BLINDNESS CLASS: the multiplicative inverse over GF(2^n).
#
# Section 6(b)/(c). Algebraic degree n-1 -- the maximum for a permutation of
# GF(2^n) -- so a degree instrument reports "no degree deficiency, no
# higher-order differential" on it. Yet x -> x^(-1) is described exactly by the
# quadratic relation x*y = 1 (x != 0) over GF(2^n) and is inverted by one field
# inversion. A function class with the property being searched for (algebraic
# tractability) that still produces the null under this measurement.
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class InverseMap:
    n: int
    field: GF2n

    target_id: str = "inverse-map-gf2n"

    @property
    def n_in(self) -> int:
        return self.n

    @property
    def n_out(self) -> int:
        return self.n

    @staticmethod
    def create(n: int) -> "InverseMap":
        return InverseMap(n=n, field=GF2n(n))

    def __call__(self, x: int) -> int:
        _check_input(x, self.n, self.target_id)
        return self.field.inv(x)

    @property
    def expected_degree(self) -> int:
        return self.n - 1

    @property
    def expected_degree_derivation(self) -> str:
        return (
            "x -> x^(2^n - 2) has exponent of Hamming weight n-1, so its algebraic "
            "degree is n-1, the maximum attainable by a permutation of GF(2^n)"
        )

    @property
    def implicit_system(self) -> str:
        return "x*y = 1 for x != 0, y = 0 for x = 0: one quadratic relation over GF(2^n)"


# ---------------------------------------------------------------------------
# NEGATIVE CONTROL: an i.i.d. random-oracle stand-in.
#
# Establishes the module's floor. A uniformly random Boolean function on n
# variables has the top monomial x_1...x_n present with probability exactly 1/2,
# and degree at least n-1 with probability 1 - 2^-(n+1); those are the exact
# figures the calibration case asserts against.
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class RandomFunction:
    n: int
    m: int
    seed: int

    target_id: str = "random-function-sha256-prf"

    @property
    def n_in(self) -> int:
        return self.n

    @property
    def n_out(self) -> int:
        return self.m

    @staticmethod
    def create(n: int, m: int, seed: int) -> "RandomFunction":
        return RandomFunction(n=n, m=m, seed=seed)

    def __call__(self, x: int) -> int:
        _check_input(x, self.n, self.target_id)
        preimage = self.seed.to_bytes(8, "big") + x.to_bytes((self.n + 7) // 8 or 1, "big")
        stream = b""
        counter = 0
        while len(stream) * 8 < self.m:
            stream += hashlib.sha256(preimage + counter.to_bytes(4, "big")).digest()
            counter += 1
        return int.from_bytes(stream, "big") & ((1 << self.m) - 1)

    @property
    def prob_degree_is_n(self) -> float:
        """P(top monomial present) = 1/2, exactly, for a uniform Boolean function."""
        return 0.5

    @property
    def prob_degree_at_least_n_minus_1(self) -> float:
        """1 - 2^-(n+1): all n+1 top-two-layer coefficients would have to vanish."""
        return 1.0 - 2.0 ** (-(self.n + 1))

    @property
    def expected_degree_derivation(self) -> str:
        return (
            "the ANF coefficients of a uniformly random Boolean function are i.i.d. "
            "uniform over GF(2); degree < n-1 requires the single degree-n coefficient "
            "and all n degree-(n-1) coefficients to vanish, probability 2^-(n+1)"
        )
