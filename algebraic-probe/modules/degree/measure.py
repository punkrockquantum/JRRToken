"""Module 1's measurement path.

Three quantities, three code paths, three tiers:

  ``degree_upper_bound``  Tier P. A certified upper bound, by propagating a
                          per-bit degree bound through the target's own code
                          with a symbolic word type. Deductive: it holds for
                          every input, and no enumeration is involved.

  ``exact_degree``        Tier E. The exact degree, by computing ANF
                          coefficients from their definition -- the coefficient
                          of the monomial on variable set S is the XOR of f over
                          every subset of S -- scanning monomial weights
                          downward and stopping at the first non-zero.

  ``witness_lower_bound`` Tier P when it witnesses. A single non-zero k-th order
                          derivative proves the degree is at least k. The seed
                          that found it is provenance, not evidence. Failure to
                          witness is Tier S and, per PREREG-M1 section 9.1, has
                          no promotion path above probe dimension 2.

``verify/anf.py`` computes the same exact degree by an in-place Moebius
butterfly. This module must not import it and does not: the two paths share no
code, which is what makes one a check on the other (DECISIONS.md D-006).
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from itertools import combinations
from typing import Any, Sequence

from core.keccak import KeccakF, permute
from core.mimc import MiMC
from core.targets import InverseMap, LinearMapGF2, PowerMap, RandomFunction
from tiers.errors import ProbeError

#: Above this the subset-sum ANF (3^n coefficient XORs) stops being a sensible
#: exact path. Raising it is a deliberate act, recorded in DECISIONS.md.
MAX_EXACT_VARS = 13


class MeasurementRefused(ProbeError):
    """The requested measurement exceeds a declared guard, or has no path."""


# ---------------------------------------------------------------------------
# Tier P: a certified upper bound by symbolic propagation
# ---------------------------------------------------------------------------


class SymbolicWord:
    """An integer-like word whose bits carry an upper bound on their degree.

    ``None`` marks a bit that is structurally zero, which is what keeps the
    bound tight through shifts and rotations: OR-ing a shifted copy against a
    complementary shifted copy must not be charged as a product.

    The operator set is exactly what the target implementations use, so a target
    can be traced by running its own code rather than by re-implementing it.
    """

    __slots__ = ("bits", "width")

    def __init__(self, bits: Sequence[int | None], width: int) -> None:
        if len(bits) != width:
            raise ValueError(f"expected {width} bits, got {len(bits)}")
        self.bits = tuple(bits)
        self.width = width

    # -- constructors ------------------------------------------------------

    @staticmethod
    def variables(width: int, degree: int = 1) -> "SymbolicWord":
        return SymbolicWord([degree] * width, width)

    @staticmethod
    def zero(width: int) -> "SymbolicWord":
        return SymbolicWord([None] * width, width)

    # -- helpers -----------------------------------------------------------

    def _coerce(self, other: object) -> "SymbolicWord | int":
        if isinstance(other, SymbolicWord):
            if other.width != self.width:
                raise ValueError(f"width mismatch: {self.width} vs {other.width}")
            return other
        if isinstance(other, int):
            return other
        raise TypeError(f"cannot combine SymbolicWord with {type(other).__name__}")

    @property
    def degree(self) -> int:
        """Largest bound over the bits; 0 for an all-constant word."""
        live = [b for b in self.bits if b is not None]
        return max(live) if live else 0

    # -- operators ---------------------------------------------------------

    def __xor__(self, other: object) -> "SymbolicWord":
        other = self._coerce(other)
        if isinstance(other, int):
            # XOR with a constant is affine: degree is unchanged, but a bit that
            # was structurally zero becomes the constant 1, of degree 0.
            bits = [
                (0 if b is None else b) if (other >> i) & 1 else b
                for i, b in enumerate(self.bits)
            ]
            return SymbolicWord(bits, self.width)
        bits = []
        for a, b in zip(self.bits, other.bits):
            if a is None:
                bits.append(b)
            elif b is None:
                bits.append(a)
            else:
                bits.append(max(a, b))
        return SymbolicWord(bits, self.width)

    __rxor__ = __xor__

    def __and__(self, other: object) -> "SymbolicWord":
        other = self._coerce(other)
        if isinstance(other, int):
            # Masking selects bits; it cannot raise a degree.
            bits = [b if (other >> i) & 1 else None for i, b in enumerate(self.bits)]
            return SymbolicWord(bits, self.width)
        bits = [
            None if (a is None or b is None) else a + b
            for a, b in zip(self.bits, other.bits)
        ]
        return SymbolicWord(bits, self.width)

    __rand__ = __and__

    def __or__(self, other: object) -> "SymbolicWord":
        other = self._coerce(other)
        if isinstance(other, int):
            bits = [0 if (other >> i) & 1 else b for i, b in enumerate(self.bits)]
            return SymbolicWord(bits, self.width)
        # a | b = a ^ b ^ (a & b); the product term dominates unless one side is
        # structurally zero, which is the rotation case and stays tight.
        bits = []
        for a, b in zip(self.bits, other.bits):
            if a is None:
                bits.append(b)
            elif b is None:
                bits.append(a)
            else:
                bits.append(a + b)
        return SymbolicWord(bits, self.width)

    __ror__ = __or__

    def __invert__(self) -> "SymbolicWord":
        # Complement is affine: a structurally-zero bit becomes the constant 1.
        return SymbolicWord([0 if b is None else b for b in self.bits], self.width)

    def __lshift__(self, amount: int) -> "SymbolicWord":
        bits = [self.bits[i - amount] if i >= amount else None for i in range(self.width)]
        return SymbolicWord(bits, self.width)

    def __rshift__(self, amount: int) -> "SymbolicWord":
        bits = [
            self.bits[i + amount] if i + amount < self.width else None
            for i in range(self.width)
        ]
        return SymbolicWord(bits, self.width)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"SymbolicWord(width={self.width}, degree={self.degree})"


@dataclass(frozen=True, slots=True)
class BoundResult:
    """A certified upper bound, with the argument that certifies it."""

    value: int
    derivation: str
    capped_by_permutation: bool


def _permutation_cap(bound: int, n: int) -> tuple[int, bool]:
    """A permutation of n bits has degree at most n-1.

    If the coordinate functions had degree n, the top monomial would appear, and
    a Boolean function containing the all-variables monomial is unbalanced; every
    coordinate of a permutation is balanced.
    """
    if bound > n - 1:
        return n - 1, True
    return bound, False


def keccak_bound(target: KeccakF) -> BoundResult:
    """Trace the production permute() with symbolic lanes."""
    w = 1 << target.lane_log2
    lanes = [SymbolicWord.variables(w) for _ in range(25)]
    out = permute(lanes, lane_log2=target.lane_log2, n_rounds=target.n_rounds)
    raw = max(lane.degree for lane in out)
    bound, capped = _permutation_cap(raw, target.width)
    return BoundResult(
        value=bound,
        derivation=(
            "per-bit degree propagated through core.keccak.permute itself: theta, "
            "rho, pi and iota are GF(2)-affine and carry the bound unchanged, chi "
            "is a single AND per bit and adds its operands' bounds; the "
            f"propagated bound over {target.n_rounds} rounds is {raw}"
            + (f", capped at width-1 = {target.width - 1} because a permutation's "
               "coordinates are balanced" if capped else "")
        ),
        capped_by_permutation=capped,
    )


def _sym_field_mul(a: SymbolicWord, b: SymbolicWord, modulus: int, n: int) -> SymbolicWord:
    """Carry-less product reduced by ``modulus``, over symbolic bits."""
    product: list[int | None] = [None] * (2 * n - 1)
    for i, bi in enumerate(b.bits):
        if bi is None:
            continue
        for j, aj in enumerate(a.bits):
            if aj is None:
                continue
            term = ai_plus = aj + bi
            k = i + j
            product[k] = term if product[k] is None else max(product[k], ai_plus)
    # Reduce: bit k >= n folds into the positions set in the modulus.
    for k in range(2 * n - 2, n - 1, -1):
        carry = product[k]
        if carry is None:
            continue
        product[k] = None
        for bit in range(n):
            if (modulus >> bit) & 1:
                target_index = k - n + bit
                current = product[target_index]
                product[target_index] = carry if current is None else max(current, carry)
    return SymbolicWord(product[:n], n)


def _sym_square(a: SymbolicWord) -> SymbolicWord:
    """Frobenius. x -> x^2 is GF(2)-linear over GF(2^n), so the degree of every
    output bit is at most the largest degree among the input bits."""
    d = a.degree
    return SymbolicWord([d] * a.width, a.width)


def _sym_power(x: SymbolicWord, exponent: int, modulus: int, n: int) -> SymbolicWord:
    """Square-and-multiply, with squaring charged as linear."""
    if exponent <= 0:
        raise MeasurementRefused("exponent must be positive")
    result: SymbolicWord | None = None
    base = x
    bits = bin(exponent)[2:]
    for bit in bits:
        if result is not None:
            result = _sym_square(result)
        if bit == "1":
            result = base if result is None else _sym_field_mul(result, base, modulus, n)
    assert result is not None
    return result


def power_map_bound(target: PowerMap | InverseMap) -> BoundResult:
    exponent = target.exponent if isinstance(target, PowerMap) else (1 << target.n) - 2
    x = SymbolicWord.variables(target.n)
    out = _sym_power(x, exponent, target.field.modulus, target.n)
    bound, capped = _permutation_cap(out.degree, target.n)
    return BoundResult(
        value=bound,
        derivation=(
            f"square-and-multiply over the exponent {exponent}: squaring is the "
            "Frobenius map and is GF(2)-linear, so it carries the bound unchanged; "
            "each multiplication adds its operands' bounds"
        ),
        capped_by_permutation=capped,
    )


def max_weight_up_to(m: int) -> int:
    """Largest Hamming weight of any integer in [1, m].

    That integer is the largest all-ones value not exceeding m, so the answer is
    the number of ones in 2^k - 1 for the largest k with 2^k - 1 <= m.
    """
    if m < 1:
        raise ValueError("m must be at least 1")
    k = m.bit_length()
    return k if (1 << k) - 1 <= m else k - 1


def mimc_derived_bound(target: MiMC) -> BoundResult:
    """A tighter, derived bound for the AO case.

    The r-round MiMC polynomial is univariate over GF(2^n). Round constants keep
    every lower exponent alive, so after r rounds of cubing the exponent support
    is contained in [1, 3^r], reduced modulo 2^n - 1. The GF(2)-degree of x^e is
    wt(e), and the degree of a sum is at most the largest degree of its terms, so

        deg <= max { wt(e) : 1 <= e <= min(3^r, 2^n - 1) }

    capped at n-1 because the map is a permutation. Sound by construction, and
    strictly tighter than doubling wherever 3^r is not itself all-ones.

    Derivation is in-repo (computation M1-AO-BOUND-001); no citation is relied
    on, and none is claimed.
    """
    modulus_order = (1 << target.n) - 1
    reach = min(3**target.n_rounds, modulus_order)
    raw = max_weight_up_to(reach)
    bound, capped = _permutation_cap(raw, target.n)
    return BoundResult(
        value=bound,
        derivation=(
            f"exponent support of the {target.n_rounds}-round polynomial is contained "
            f"in [1, min(3^r, 2^n-1)] = [1, {reach}]; deg(x^e) = wt(e) and the degree "
            f"of a sum is at most the largest term's, giving {raw}"
            + (f", capped at n-1 = {target.n - 1} for a permutation" if capped else "")
        ),
        capped_by_permutation=capped,
    )


def mimc_bound(target: MiMC) -> BoundResult:
    x = SymbolicWord.variables(target.n)
    state = x
    for _ in range(target.n_rounds):
        # x -> (x + k + c)^3; the additions are affine and carry the bound.
        squared = _sym_square(state)
        state = _sym_field_mul(squared, state, target.field.modulus, target.n)
    bound, capped = _permutation_cap(state.degree, target.n)
    return BoundResult(
        value=bound,
        derivation=(
            f"{target.n_rounds} rounds of x -> (x + k + c)^3: the key and constant "
            "additions are affine, squaring is the Frobenius map and is linear, and "
            "the remaining multiplication doubles the bound each round"
        ),
        capped_by_permutation=capped,
    )


def linear_bound(target: LinearMapGF2) -> BoundResult:
    return BoundResult(
        value=1,
        derivation=(
            "every output bit is a GF(2) sum of input bits, so its ANF holds only "
            "degree-1 monomials"
        ),
        capped_by_permutation=False,
    )


def degree_upper_bound(target: Any) -> BoundResult:
    """Tier P. Dispatch to the propagation path for this target family."""
    if isinstance(target, KeccakF):
        return keccak_bound(target)
    if isinstance(target, (PowerMap, InverseMap)):
        return power_map_bound(target)
    if isinstance(target, MiMC):
        return mimc_bound(target)
    if isinstance(target, LinearMapGF2):
        return linear_bound(target)
    if isinstance(target, RandomFunction):
        raise MeasurementRefused(
            "a random-oracle stand-in has no round structure to propagate a bound "
            "through; its degree is measured exactly, not bounded"
        )
    raise MeasurementRefused(
        f"no degree-bound propagation path for {type(target).__name__}"
    )


# ---------------------------------------------------------------------------
# Tier E: the exact degree, from the definition of an ANF coefficient
# ---------------------------------------------------------------------------


def exact_degree(target: Any, n: int | None = None, m: int | None = None) -> int:
    """Exact algebraic degree over all output bits.

    The coefficient of the monomial on variable set S is the XOR of f over every
    subset of S. Whole output words are XORed together, so one pass settles every
    output bit at once; monomial weights are scanned downward and the first
    weight with a non-zero coefficient is the degree.
    """
    n = n if n is not None else target.n_in
    m = m if m is not None else target.n_out
    if n > MAX_EXACT_VARS:
        raise MeasurementRefused(
            f"exact degree over {n} variables exceeds the guard of {MAX_EXACT_VARS} "
            "(3^n coefficient sums); this path does not approximate"
        )
    table = [target(x) for x in range(1 << n)]
    for weight in range(n, -1, -1):
        for subset in combinations(range(n), weight):
            mask = 0
            for index in subset:
                mask |= 1 << index
            accumulator = 0
            current = mask
            while True:
                accumulator ^= table[current]
                if current == 0:
                    break
                current = (current - 1) & mask
            if accumulator:
                return weight
    return -1


def exact_degree_profile(target: Any, n: int | None = None, m: int | None = None) -> tuple[int, ...]:
    """Per-output-bit exact degrees, never collapsed by this function."""
    n = n if n is not None else target.n_in
    m = m if m is not None else target.n_out
    if n > MAX_EXACT_VARS:
        raise MeasurementRefused(f"exact degree over {n} variables exceeds the guard")
    table = [target(x) for x in range(1 << n)]
    degrees = [-1] * m
    remaining = set(range(m))
    for weight in range(n, -1, -1):
        if not remaining:
            break
        for subset in combinations(range(n), weight):
            mask = 0
            for index in subset:
                mask |= 1 << index
            accumulator = 0
            current = mask
            while True:
                accumulator ^= table[current]
                if current == 0:
                    break
                current = (current - 1) & mask
            if accumulator:
                for bit in list(remaining):
                    if (accumulator >> bit) & 1:
                        degrees[bit] = weight
                        remaining.discard(bit)
    return tuple(degrees)


# ---------------------------------------------------------------------------
# Tier P when witnessed: a non-zero k-th order derivative
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class WitnessOutcome:
    probe_dimension: int
    seeds_drawn: int
    witnessed: bool
    witness_seed: int | None
    derivation: str


def witness_lower_bound(target: Any, k: int, seeds: Sequence[int], n: int | None = None) -> WitnessOutcome:
    """Draw random k-dimensional affine subspaces and sum the target over each.

    A non-zero sum is a deductive proof that the degree is at least k. The seed
    that found it is provenance, not evidence: the result does not depend on the
    search having been random.
    """
    n = n if n is not None else target.n_in
    if k > n:
        raise MeasurementRefused(
            f"probe dimension {k} exceeds the {n} available variables; no such subspace exists"
        )
    for seed in seeds:
        rng = random.Random(seed)
        basis: list[int] = []
        while len(basis) < k:
            candidate = rng.randrange(1 << n)
            if candidate and candidate not in basis:
                basis.append(candidate)
        offset = rng.randrange(1 << n)
        total = 0
        for mask in range(1 << k):
            point = offset
            for index in range(k):
                if (mask >> index) & 1:
                    point ^= basis[index]
            total ^= target(point)
        if total:
            return WitnessOutcome(
                probe_dimension=k,
                seeds_drawn=seeds.index(seed) + 1,
                witnessed=True,
                witness_seed=seed,
                derivation=(
                    f"the {k}-th order derivative of the target in the directions of a "
                    f"{k}-dimensional subspace is non-zero, so the degree is at least {k}; "
                    "a non-zero derivative is a proof, not a sample"
                ),
            )
    return WitnessOutcome(
        probe_dimension=k,
        seeds_drawn=len(seeds),
        witnessed=False,
        witness_seed=None,
        derivation=(
            f"no witness in {len(seeds)} draws; this is a sampled null, and PREREG-M1 "
            "section 9.1 gives it no promotion path above probe dimension 2"
        ),
    )


# ---------------------------------------------------------------------------
# The calibration entry point
# ---------------------------------------------------------------------------


def measure(target: Any, case: Any) -> int:
    """Dispatch on the quantity the calibration case names."""
    quantity = case.quantity
    if quantity == "algebraic_degree":
        return exact_degree(target)
    if quantity == "algebraic_degree_upper_bound":
        return degree_upper_bound(target).value
    if quantity == "algebraic_degree_upper_bound_derived":
        if not isinstance(target, MiMC):
            raise MeasurementRefused(
                "the derived exponent-support bound is specific to the MiMC "
                f"construction; {type(target).__name__} has no such derivation"
            )
        return mimc_derived_bound(target).value
    raise MeasurementRefused(f"no measurement path for quantity {quantity!r}")
