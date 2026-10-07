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


# ---------------------------------------------------------------------------
# COMPOSED CONTROLS (Stage B).
#
# Every gap=0 control above is a single uncomposed map, where the degree bound
# is just wt(exponent) and tightness validates the implementation rather than
# the instrument. These compose, and their per-round exact degree is
# analytically known, so bound tightness under composition is measurable.
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class IteratedPowerMap:
    """x -> x^e applied ``rounds`` times over GF(2^n), no round constants.

    Equal to x^(e^rounds mod 2^n - 1), so the exact degree is
    wt(e^rounds mod 2^n - 1) analytically. That sequence is NON-MONOTONIC in
    the round count, which no doubling bound can reproduce: this is the control
    on which naive doubling is provably wrong rather than merely loose.
    """

    n: int
    exponent: int
    rounds: int
    field: GF2n

    target_id: str = "iterated-power-map-gf2n"

    @property
    def n_in(self) -> int:
        return self.n

    @property
    def n_out(self) -> int:
        return self.n

    @staticmethod
    def create(n: int, exponent: int, rounds: int) -> "IteratedPowerMap":
        if rounds < 1:
            raise ValueError("rounds must be at least 1")
        if exponent < 1:
            raise ValueError("iterated-power exponent must be at least 1")
        return IteratedPowerMap(n=n, exponent=exponent, rounds=rounds, field=GF2n(n))

    def __call__(self, x: int) -> int:
        _check_input(x, self.n, self.target_id)
        state = x
        for _ in range(self.rounds):  # composed, not evaluated in closed form
            state = self.field.pow(state, self.exponent)
        return state

    @property
    def effective_exponent(self) -> int:
        order = (1 << self.n) - 1
        e = pow(self.exponent, self.rounds, order)
        return e if e else order

    @property
    def expected_degree(self) -> int:
        return bin(self.effective_exponent).count("1")

    @property
    def expected_degree_derivation(self) -> str:
        return (
            "composing x -> x^e r times gives x^(e^r mod 2^n - 1), and the algebraic "
            "degree of a power map is the Hamming weight of its exponent"
        )


@dataclass(frozen=True, slots=True)
class BlockRestrictedMap:
    """A power map on the low ``active`` bits, identity on the rest.

    The degree can never exceed active-1 however many times it is iterated,
    because no output bit depends on more than ``active`` inputs. A control with
    a known ceiling well below the state size, which a doubling bound blows
    past immediately.
    """

    n: int
    active: int
    exponent: int
    rounds: int
    field: GF2n

    target_id: str = "block-restricted-map"

    @property
    def n_in(self) -> int:
        return self.n

    @property
    def n_out(self) -> int:
        return self.n

    @staticmethod
    def create(n: int, active: int, exponent: int, rounds: int) -> "BlockRestrictedMap":
        if not 1 <= active <= n:
            raise ValueError("active must lie in [1, n]")
        return BlockRestrictedMap(
            n=n, active=active, exponent=exponent, rounds=rounds, field=GF2n(active)
        )

    def __call__(self, x: int) -> int:
        _check_input(x, self.n, self.target_id)
        mask = (1 << self.active) - 1
        low, high = x & mask, x & ~mask
        for _ in range(self.rounds):
            low = self.field.pow(low, self.exponent)
        return high | low

    @property
    def degree_ceiling(self) -> int:
        return self.active - 1

    @property
    def expected_degree(self) -> int:
        order = (1 << self.active) - 1
        e = pow(self.exponent, self.rounds, order)
        return bin(e if e else order).count("1")

    @property
    def expected_degree_derivation(self) -> str:
        return (
            f"no output bit depends on more than {self.active} input bits, so the "
            f"degree cannot exceed {self.active - 1} at any round count"
        )


@dataclass(frozen=True, slots=True)
class CancellingXor:
    """``f(x) = (A x) XOR (B x)`` over GF(2), with A and B sharing rows.

    Present as a blindness class for Module 2. Reachability asks which input bits
    *can* influence an output bit and answers by unioning the operands of every
    operation, so it sees both ``A x`` and ``B x`` reaching every output. But the
    function is ``(A XOR B) x``, and wherever A and B agree on a row that row of
    the sum is zero -- the output bit is constant and depends on nothing.

    ``shared_rows`` names the output bits where A and B are made identical, so
    those bits are provably constant while remaining fully reachable. The gap is
    the over-approximation, exhibited rather than asserted.
    """

    n: int
    seed: int
    shared_rows: tuple[int, ...]
    rows_a: tuple[int, ...]
    rows_b: tuple[int, ...]

    target_id: str = "cancelling-xor-gf2"

    @property
    def n_in(self) -> int:
        return self.n

    @property
    def n_out(self) -> int:
        return self.n

    @staticmethod
    def create(n: int, seed: int, shared_rows: tuple[int, ...]) -> "CancellingXor":
        if n < 1:
            raise ValueError("n must be positive")
        for row in shared_rows:
            if not 0 <= row < n:
                raise ValueError(f"shared row {row} out of range for n={n}")
        rng = random.Random(seed)
        rows_a = [rng.randrange(1, 1 << n) for _ in range(n)]
        rows_b = [rng.randrange(1, 1 << n) for _ in range(n)]
        for row in shared_rows:
            rows_b[row] = rows_a[row]
        return CancellingXor(
            n=n,
            seed=seed,
            shared_rows=tuple(sorted(set(shared_rows))),
            rows_a=tuple(rows_a),
            rows_b=tuple(rows_b),
        )

    def _apply(self, rows: tuple[int, ...], x: int) -> int:
        out = 0
        for index, row in enumerate(rows):
            if (row & x).bit_count() & 1:
                out |= 1 << index
        return out

    def __call__(self, x: int) -> int:
        _check_input(x, self.n, self.target_id)
        # Written as two applications and an XOR, which is what makes the
        # cancellation invisible to an operation-by-operation analysis.
        return self._apply(self.rows_a, x) ^ self._apply(self.rows_b, x)

    @property
    def constant_output_bits(self) -> tuple[int, ...]:
        """Output bits that are identically zero, by construction."""
        return tuple(
            index
            for index in range(self.n)
            if (self.rows_a[index] ^ self.rows_b[index]) == 0
        )


@dataclass(frozen=True, slots=True)
class CancellingSchedule:
    """A message schedule whose wiring carries words that cancel inside it.

    Present as a blindness class for Module 5. That module decides whether a
    meet-in-the-middle split exists by asking which block words each chunk
    *consumes*, and it answers by closing a recurrence over word indices --
    unioning the operands of every step, exactly as Module 2's reachability
    does. A word that reaches a chunk through the wiring and cancels inside it
    is still counted as consumed, so it is not counted neutral, so a split that
    really exists is not found.

    The recurrence here is ``W[t] = W[t-4] XOR W[t-4] XOR W[t-1]``. The first
    two terms are the same word and annihilate, so every derived word is simply
    ``W[t-1]`` and the whole tail depends on block word 3 alone. The wiring,
    which cannot see that, reports the tail as consuming every block word.

    Cut at round 3 over the eight rounds:

    ====================  ===================  ==================
    quantity              by the wiring        in truth
    ====================  ===================  ==================
    forward  [0, 3)       {0, 1, 2}            {0, 1, 2}
    backward [3, 8)       {0, 1, 2, 3}         {3}
    forward neutral       {}                   {0, 1, 2}
    backward neutral      {3}                  {3}
    independent split     **no**               **yes**
    ====================  ===================  ==================

    So the module emits "no independent split at this cut" for a schedule that
    has one, with three words of forward freedom going unreported. The failure
    is in the safe direction for a security claim -- it under-reports attack
    structure rather than inventing it -- which is precisely why it is worth
    stating: a null from this module is not evidence that no split exists.
    """

    block_words: int = 4
    n_rounds: int = 8

    target_id: str = "cancelling-schedule"

    #: The recurrence's back-references, with the repeated one written twice.
    #: Module 5's closure unions these; the arithmetic cancels the pair.
    offsets: tuple[int, ...] = (4, 4, 1)

    @staticmethod
    def create(block_words: int = 4, n_rounds: int = 8) -> "CancellingSchedule":
        if block_words < 1:
            raise ValueError("block_words must be positive")
        if n_rounds < block_words:
            raise ValueError("n_rounds must be at least block_words")
        return CancellingSchedule(block_words=block_words, n_rounds=n_rounds)

    def evaluate(self, words: list[int]) -> list[int]:
        """Expand the schedule. The XOR pair cancels, so W[t] == W[t-1]."""
        if len(words) != self.block_words:
            raise ValueError(f"expected {self.block_words} block words")
        out = list(words)
        for t in range(self.block_words, self.n_rounds):
            value = 0
            for offset in self.offsets:
                value ^= out[t - offset]
            out.append(value)
        return out

    def wiring_sources(self, index: int) -> frozenset[int]:
        """Closure over the offsets: what the wiring says W[index] is built from.

        Deliberately the same shape of computation Module 5 performs, because
        the point of the class is that this computation is correct about the
        wiring and wrong about the function.
        """
        if not 0 <= index < self.n_rounds:
            raise ValueError(f"index {index} out of range")
        sources: list[frozenset[int]] = []
        for t in range(index + 1):
            if t < self.block_words:
                sources.append(frozenset({t}))
                continue
            union: set[int] = set()
            for offset in self.offsets:
                union |= sources[t - offset]
            sources.append(frozenset(union))
        return sources[index]

    def wiring_consumption(self, start: int, end: int) -> frozenset[int]:
        union: set[int] = set()
        for t in range(start, end):
            union |= self.wiring_sources(t)
        return frozenset(union)


@dataclass(frozen=True, slots=True)
class RotateXorConstant:
    """``f(x) = (x <<< r) XOR C``: a round that is transparent to an RX pair.

    Present as a blindness class for Module 6. The plain rotational relation
    asks whether ``f(x <<< r) == f(x) <<< r``. Here:

        f(x <<< r)   = (x <<< 2r) XOR C
        f(x) <<< r   = (x <<< 2r) XOR (C <<< r)

    which agree only when ``C == C <<< r``. For a constant that is not
    rotation-invariant they never agree, at any input, so the plain measure
    reports probability **exactly 0** -- its null, and the strongest form of it.

    But the offset between the two sides is ``C XOR (C <<< r)``: the *same*
    value at every input. That is a rotational-XOR characteristic of probability
    **exactly 1**. The structure is total and the plain measure sees none of it,
    which is the reason the technique is named for both halves.

    ``rotation_invariant_constant`` builds the other case -- a ``C`` equal to its
    own rotation -- so a test can show the class turns off when the mechanism
    is removed rather than only that it turns on.
    """

    width: int
    amount: int
    constant: int

    target_id: str = "rotate-xor-constant"

    @property
    def n_in(self) -> int:
        return self.width

    @property
    def n_out(self) -> int:
        return self.width

    @staticmethod
    def create(width: int = 16, amount: int = 3, constant: int = 0x00FF) -> "RotateXorConstant":
        if width < 2:
            raise ValueError("width must be at least 2")
        if not 0 < amount < width:
            raise ValueError(f"amount must be in (0, {width})")
        return RotateXorConstant(
            width=width, amount=amount, constant=constant & ((1 << width) - 1)
        )

    @staticmethod
    def rotation_invariant_constant(width: int, amount: int) -> int:
        """A constant equal to its own rotation, so the class stops applying.

        The all-ones word is invariant under every rotation, so with it the
        plain relation holds everywhere and there is nothing for the measure to
        miss -- the control that shows the blindness needs the mechanism.
        """
        return (1 << width) - 1

    def _rotl(self, value: int) -> int:
        width, amount = self.width, self.amount % self.width
        mask = (1 << width) - 1
        value &= mask
        return ((value << amount) | (value >> (width - amount))) & mask

    def __call__(self, x: int) -> int:
        return self._rotl(x) ^ self.constant

    @property
    def expected_rx_offset(self) -> int:
        """``C XOR (C <<< r)`` -- the constant offset, derived not measured."""
        return self.constant ^ self._rotl(self.constant)
