"""L0 — the declarative primitive specification.

Everything downstream is generated from a ``Spec``: the reference
implementation, the polynomial system, and (later) the CNF and MILP models. One
source of truth, because the defect that silently invalidates this whole class
of project is a model and an implementation that describe different ciphers.
Generating both from here makes divergence impossible rather than unlikely.

The family covered is the sponge-mode SPN that arithmetisation-oriented hashes
use: add round constants, raise some or all state elements to a fixed power,
multiply by an MDS matrix. That single shape covers

  * **MiMC-p/p** -- state width 1, every round full, exponent 3. Degenerate
    enough to be a calibration target: a width-1 permutation is a univariate
    map, so its CICO problem is solvable by root-finding and the answer is
    independently checkable by brute force.

  * **Poseidon-like** -- state width >= 2, full rounds at each end and partial
    rounds (S-box on one element only) in the middle. This is the real target,
    and the partial-round structure is exactly what the security argument's
    degree-of-regularity conjecture rests on.

What is *not* claimed. These are the published **shapes**, instantiated with
round constants generated here. They are not any deployed parameter set, because
validating against a deployed set needs its official test vectors and
``eprint.iacr.org`` is unreachable from this environment -- the same egress
block that holds ``algebraic-probe``'s E-04 open. What the spec *is* validated
against is stated in ``validate()``: invertibility, exhaustively at small
widths, plus the structural invariants an SPN of this shape must satisfy.
Calling a result here a result about deployed Poseidon would be the exact
substitution Class 2 of the original brief forbids.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Iterator

#: Small primes used for exhaustive calibration. Chosen so that gcd(d, p-1) = 1
#: for the S-box exponents below, which is what makes x -> x^d a permutation.
CALIBRATION_PRIMES: tuple[int, ...] = (11, 13, 17, 23, 29, 31, 37, 41, 101, 257)

#: A 31-bit prime of the shape ZK proof systems use (p = 2^30 + 3 is prime).
#: Large enough that exhaustive search is infeasible, small enough that msolve
#: arithmetic stays cheap.
FIELD_31BIT = (1 << 30) + 3


class SpecRefused(Exception):
    """The requested specification is not a permutation, or is malformed."""


def is_permutation_exponent(exponent: int, prime: int) -> bool:
    """``x -> x^e`` permutes F_p exactly when gcd(e, p-1) = 1."""
    from math import gcd

    return gcd(exponent, prime - 1) == 1


@dataclass(frozen=True, slots=True)
class Spec:
    """One primitive, described once.

    ``rounds_partial`` applies the S-box to element 0 only, which is the
    structure that makes Poseidon-family systems cheap to arithmetise and is
    where their algebraic security argument lives.
    """

    name: str
    prime: int
    width: int
    sbox_exponent: int
    rounds_full_first: int
    rounds_partial: int
    rounds_full_last: int
    #: Capacity elements, fixed to zero on input and constrained on output.
    #: The remaining elements are the rate. A CICO problem is stated over these.
    capacity: int = 1
    mds: tuple[tuple[int, ...], ...] = field(default=())
    constants: tuple[tuple[int, ...], ...] = field(default=())

    # -- construction --------------------------------------------------------

    @staticmethod
    def create(
        name: str,
        prime: int,
        width: int,
        sbox_exponent: int = 3,
        rounds_full_first: int = 1,
        rounds_partial: int = 0,
        rounds_full_last: int = 1,
        capacity: int = 1,
    ) -> "Spec":
        if prime < 3:
            raise SpecRefused("prime must be at least 3")
        if width < 1:
            raise SpecRefused("width must be at least 1")
        if not 0 <= capacity < width if width > 1 else capacity != 0:
            raise SpecRefused(
                f"capacity {capacity} is not a proper subset of width {width}"
            )
        if not is_permutation_exponent(sbox_exponent, prime):
            raise SpecRefused(
                f"x -> x^{sbox_exponent} does not permute F_{prime}: "
                f"gcd({sbox_exponent}, {prime - 1}) != 1"
            )
        total = rounds_full_first + rounds_partial + rounds_full_last
        if total < 1:
            raise SpecRefused("a permutation needs at least one round")
        if width == 1 and rounds_partial:
            raise SpecRefused(
                "partial rounds are meaningless at width 1: the S-box already "
                "applies to the only element"
            )

        spec = Spec(
            name=name,
            prime=prime,
            width=width,
            sbox_exponent=sbox_exponent,
            rounds_full_first=rounds_full_first,
            rounds_partial=rounds_partial,
            rounds_full_last=rounds_full_last,
            capacity=capacity,
        )
        return Spec(
            **{
                **{k: getattr(spec, k) for k in spec.__slots__ if k not in ("mds", "constants")},
                "mds": _derive_mds(prime, width),
                "constants": _derive_constants(spec),
            }
        )

    # -- derived quantities --------------------------------------------------

    @property
    def rounds(self) -> int:
        return self.rounds_full_first + self.rounds_partial + self.rounds_full_last

    @property
    def rate(self) -> int:
        return self.width - self.capacity

    @property
    def sbox_count(self) -> int:
        """Total S-box applications -- the count that governs the polynomial
        system's size, and therefore the solver's work."""
        full = self.rounds_full_first + self.rounds_full_last
        return full * self.width + self.rounds_partial

    @property
    def algebraic_degree_unreduced(self) -> int:
        """``d ** rounds`` -- the degree the composed map would have if nothing
        reduced it. Stated because the gap between this and the *measured*
        solving degree is the whole subject."""
        return self.sbox_exponent**self.rounds

    def digest(self) -> str:
        """A content hash of the specification, so a result names its input."""
        payload = (
            f"{self.name}|p={self.prime}|t={self.width}|d={self.sbox_exponent}|"
            f"Rf={self.rounds_full_first}+{self.rounds_full_last}|"
            f"Rp={self.rounds_partial}|c={self.capacity}|"
            f"mds={self.mds}|rc={self.constants}"
        )
        return hashlib.sha256(payload.encode()).hexdigest()[:16]

    def round_kinds(self) -> Iterator[str]:
        """``"full"`` or ``"partial"`` per round, in order."""
        yield from ["full"] * self.rounds_full_first
        yield from ["partial"] * self.rounds_partial
        yield from ["full"] * self.rounds_full_last

    def render(self) -> str:
        return (
            f"spec={self.name} digest={self.digest()} p={self.prime} "
            f"width={self.width} d={self.sbox_exponent} "
            f"rounds={self.rounds}({self.rounds_full_first}f+"
            f"{self.rounds_partial}p+{self.rounds_full_last}f) "
            f"capacity={self.capacity} sboxes={self.sbox_count} "
            f"degree_unreduced={self.sbox_exponent}^{self.rounds}"
        )

    def at_rounds(self, full_first: int, partial: int, full_last: int) -> "Spec":
        """The same primitive at a different round count -- one rung of a ladder."""
        return Spec.create(
            name=self.name,
            prime=self.prime,
            width=self.width,
            sbox_exponent=self.sbox_exponent,
            rounds_full_first=full_first,
            rounds_partial=partial,
            rounds_full_last=full_last,
            capacity=self.capacity,
        )


def _derive_mds(prime: int, width: int) -> tuple[tuple[int, ...], ...]:
    """A Cauchy matrix, which is MDS by construction.

    ``M[i][j] = 1 / (x_i - y_j)`` with the two index sets disjoint. Every square
    submatrix of a Cauchy matrix is invertible, which is the MDS property, so
    this needs no search and no test-vector table -- the construction *is* the
    proof. ``validate()`` still checks invertibility numerically, because a
    construction being right on paper does not establish that this code
    implements it.
    """
    if width == 1:
        return ((1,),)
    if 2 * width >= prime:
        raise SpecRefused(
            f"a Cauchy matrix of width {width} needs {2 * width} distinct field "
            f"elements; F_{prime} has only {prime}"
        )
    xs = list(range(width))
    ys = list(range(width, 2 * width))
    rows = []
    for x in xs:
        rows.append(tuple(pow(x - y, -1, prime) for y in ys))
    return tuple(rows)


def _derive_constants(spec: "Spec") -> tuple[tuple[int, ...], ...]:
    """Round constants from a fixed, stated extraction.

    SHAKE-style extraction from the specification's own name and parameters, so
    the constants are reproducible from the spec alone and no table has to be
    transcribed or trusted. They are *not* any deployed set's constants -- see
    the module docstring.
    """
    out = []
    for round_index in range(spec.rounds):
        row = []
        for element in range(spec.width):
            seed = (
                f"{spec.name}|{spec.prime}|{spec.width}|{spec.sbox_exponent}|"
                f"round={round_index}|element={element}"
            ).encode()
            digest = hashlib.shake_256(seed).digest(64)
            row.append(int.from_bytes(digest, "big") % spec.prime)
        out.append(tuple(row))
    return tuple(out)


# -- named instantiations ----------------------------------------------------


def mimc(prime: int, rounds: int) -> Spec:
    """MiMC-p/p: width 1, every round full, exponent 3.

    The calibration target. A width-1 permutation has no capacity, so
    ``capacity=0`` and the CICO problem degenerates to inverting a univariate
    map -- which is precisely why it is checkable by brute force.
    """
    return Spec.create(
        name="mimc-p",
        prime=prime,
        width=1,
        sbox_exponent=3,
        rounds_full_first=rounds,
        rounds_partial=0,
        rounds_full_last=0,
        capacity=0,
    )


def poseidon_like(
    prime: int,
    width: int,
    rounds_full: int = 2,
    rounds_partial: int = 1,
    sbox_exponent: int = 3,
) -> Spec:
    """A Poseidon-shaped permutation: full rounds at both ends, partial between.

    ``rounds_full`` is split evenly across the two ends, which is how the family
    is specified. The name says *like*: this is the shape, with constants
    derived here, not a deployed parameter set.
    """
    first = rounds_full // 2
    last = rounds_full - first
    return Spec.create(
        name=f"poseidon-like-t{width}",
        prime=prime,
        width=width,
        sbox_exponent=sbox_exponent,
        rounds_full_first=first,
        rounds_partial=rounds_partial,
        rounds_full_last=last,
        capacity=1,
    )
