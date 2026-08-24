"""MiMC over GF(2^n), parametrised by round count.

Section 9 names MiMC among the secondary targets, and the degree growth of the
r-round MiMC construction is one of Module 1's published calibration targets.
This is the GF(2^n) instance with the cube map, which requires gcd(3, 2^n-1) = 1,
i.e. n odd.

Round constants are derived here from a seeded stream rather than taken from a
published parameter set: the calibration case that uses this target states the
constant-derivation rule as part of the case, because degree growth claims in
the literature are made for a stated constant set. Substituting a different set
without saying so would be an unattributed change to the target.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from .gf2 import GF2n

CUBE = 3


def derived_constants(n: int, n_rounds: int, seed: int) -> tuple[int, ...]:
    """c_0 = 0, and c_i for i >= 1 taken from SHA-256 in counter mode."""
    mask = (1 << n) - 1
    constants = [0]
    for i in range(1, n_rounds):
        block = hashlib.sha256(
            b"algebraic-probe/mimc-constants"
            + seed.to_bytes(8, "big")
            + n.to_bytes(4, "big")
            + i.to_bytes(4, "big")
        ).digest()
        constants.append(int.from_bytes(block, "big") & mask)
    return tuple(constants)


def standard_rounds(n: int) -> int:
    """ceil(n / log2 3), the round count MiMC-n/n is specified with."""
    rounds = 1
    while CUBE**rounds < (1 << n):
        rounds += 1
    return rounds


@dataclass(frozen=True, slots=True)
class MiMC:
    """r rounds of x -> (x + k + c_i)^3 over GF(2^n)."""

    n: int
    n_rounds: int
    key: int
    constants: tuple[int, ...]
    field: GF2n

    target_id: str = "mimc-gf2n"
    n_in: int = 0
    n_out: int = 0

    @staticmethod
    def create(n: int, n_rounds: int | None = None, key: int = 0, seed: int = 0) -> "MiMC":
        if n % 2 == 0:
            raise ValueError(
                f"the cube map is not a permutation of GF(2^{n}): gcd(3, 2^n - 1) != 1 "
                "for even n"
            )
        rounds = standard_rounds(n) if n_rounds is None else n_rounds
        return MiMC(
            n=n,
            n_rounds=rounds,
            key=key,
            constants=derived_constants(n, max(rounds, 1), seed),
            field=GF2n(n),
            n_in=n,
            n_out=n,
        )

    def __call__(self, x: int) -> int:
        state = x
        for i in range(self.n_rounds):
            state = self.field.pow(state ^ self.key ^ self.constants[i], CUBE)
        return state ^ self.key

    @property
    def univariate_degree(self) -> int:
        """3^r reduced modulo 2^n - 1: the exponent of the r-round polynomial."""
        modulus = (1 << self.n) - 1
        return pow(CUBE, self.n_rounds, modulus)

    @property
    def constant_derivation(self) -> str:
        return (
            "c_0 = 0; c_i = SHA-256('algebraic-probe/mimc-constants' || seed || n || i) "
            "truncated to n bits"
        )
