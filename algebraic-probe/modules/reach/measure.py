"""Module 2's measurement path: dependency-graph reachability and free rounds.

Section 9 declares Module 2's quantity as "input bits reachable to each output
bit at round r; degrees of freedom", and its tier as **P only**. Both parts are
deductive: which input bits *can* influence an output bit is a property of the
wiring, established by propagating reachable sets through the target's own code,
and the count of directly settable message words is a property of the schedule.
No enumeration and no sampling appear anywhere in this file.

Two granularities, and the difference between them is the point.

  word level   The classical dependency graph. W[t] is built from W[t-16],
               W[t-15], W[t-7] and W[t-2], so the set of original block words
               reachable to round t is a transitive closure over that relation.
               This is what a pen-and-paper analysis gives.

  bit level    The same question asked of individual bits, propagated through
               ``core.sha256.compress`` itself with a reachable-set word type.

I expected the bit-level answer to be strictly tighter, on the grounds that
rotations and shifts move bits rather than mixing them. It is not. Measured,
``word_level_overstatement`` is **0 at every round count**: modular addition's
carry chain unions every operand bit at or below each position, and there are
enough additions per round that every bit of a consumed word becomes reachable
anyway. The word-level graph loses nothing here, which is a fact about ARX and
not about the implementation -- a design whose mixing were rotation-only would
separate the two.

Reachability is an over-approximation of dependence in both cases: a bit can be
reachable through the wiring and still have no algebraic influence, because terms
cancel. That gap is what ``blindness/cancellation.py`` exhibits, and it is why
this module reports a *reachable set* and never claims an output actually depends
on what it names.

This module implements its own propagation rather than reusing
``modules.degree.measure.SupportWord``. The two answer different questions --
that one carries degree bounds and caps them, this one carries only sets -- and
keeping them apart means a mistake in either is not shared by both.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

from core.sha256 import BLOCK_BITS, FULL_ROUNDS, WORD_BITS, SHA256Compression
from core.sha256 import IV as SHA256_IV
from core.sha256 import compress as sha256_compress
from tiers.errors import ProbeError

#: Words in a message block. W[0..15] are the block itself; beyond that the
#: schedule recurrence produces them.
BLOCK_WORDS = BLOCK_BITS // WORD_BITS

#: The schedule recurrence's back-references: W[t] = W[t-16] + s0(W[t-15])
#: + W[t-7] + s1(W[t-2]).
SCHEDULE_OFFSETS = (16, 15, 7, 2)


class ReachRefused(ProbeError):
    """The requested reachability quantity has no path or exceeds a guard."""


# ---------------------------------------------------------------------------
# Word level: the classical dependency graph
# ---------------------------------------------------------------------------


def schedule_sources(index: int) -> frozenset[int]:
    """Original block words W[0..15] reachable to schedule word W[index].

    Transitive closure of the recurrence. For index < 16 the word *is* a block
    word, so the answer is itself.
    """
    if index < 0:
        raise ValueError("schedule index must be non-negative")
    if index >= FULL_ROUNDS:
        raise ReachRefused(
            f"schedule word {index} is beyond the {FULL_ROUNDS}-round schedule"
        )
    sources: list[frozenset[int]] = []
    for t in range(index + 1):
        if t < BLOCK_WORDS:
            sources.append(frozenset({t}))
            continue
        union: set[int] = set()
        for offset in SCHEDULE_OFFSETS:
            union |= sources[t - offset]
        sources.append(frozenset(union))
    return sources[index]


def reachable_words(n_rounds: int) -> frozenset[int]:
    """Block words reachable to the state after ``n_rounds`` rounds.

    Round t consumes schedule word W[t], so the state after r rounds is built
    from W[0..r-1] and the block words those close over.
    """
    if not 0 <= n_rounds <= FULL_ROUNDS:
        raise ValueError(f"n_rounds must be in [0, {FULL_ROUNDS}]")
    union: set[int] = set()
    for t in range(n_rounds):
        union |= schedule_sources(t)
    return frozenset(union)


def first_round_reaching_every_word() -> int:
    """Least r with every block word reachable. A wiring fact, not a measurement
    of diffusion strength: reachable is not the same as influential."""
    for rounds in range(FULL_ROUNDS + 1):
        if len(reachable_words(rounds)) == BLOCK_WORDS:
            return rounds
    raise ReachRefused("no round count reaches every block word")  # pragma: no cover


# ---------------------------------------------------------------------------
# Degrees of freedom
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class FreedomBudget:
    """How much of the message an attacker still sets directly at round r."""

    n_rounds: int
    free_words: int
    free_bits: int
    consumed_words: int
    derived_words: int
    last_directly_settable_round: int
    derivation: str

    def render(self) -> str:
        return (
            f"rounds={self.n_rounds} free_words={self.free_words} "
            f"free_bits={self.free_bits} derived_words={self.derived_words} "
            f"last_directly_settable_round={self.last_directly_settable_round}"
        )


def freedom_budget(n_rounds: int) -> FreedomBudget:
    """Tier P. The block words rounds [0, n_rounds) consume, split by whether the
    attacker sets them directly.

    W[0..15] are the block and are chosen freely: 512 bits. From round 16 the
    schedule determines W[t] from earlier words, so a later round consumes no new
    freedom -- it spends what the first sixteen already committed. The budget is
    therefore a wiring fact, and it is the reason message-modification arguments
    run out at round 16 rather than gradually.
    """
    if not 0 <= n_rounds <= FULL_ROUNDS:
        raise ValueError(f"n_rounds must be in [0, {FULL_ROUNDS}]")
    consumed = n_rounds
    free = min(n_rounds, BLOCK_WORDS)
    derived = max(0, n_rounds - BLOCK_WORDS)
    return FreedomBudget(
        n_rounds=n_rounds,
        free_words=free,
        free_bits=free * WORD_BITS,
        consumed_words=consumed,
        derived_words=derived,
        last_directly_settable_round=min(n_rounds, BLOCK_WORDS) - 1 if n_rounds else -1,
        derivation=(
            f"rounds [0, {n_rounds}) consume schedule words W[0..{n_rounds - 1}]; "
            f"of those, {free} are block words the attacker sets directly "
            f"({free * WORD_BITS} bits of the {BLOCK_BITS}-bit block) and {derived} are "
            "determined by the schedule recurrence from words already committed"
        )
        if n_rounds
        else "no round consumes a schedule word, so no freedom is spent",
    )


# ---------------------------------------------------------------------------
# Bit level: reachable sets propagated through the target's own code
# ---------------------------------------------------------------------------


class ReachWord:
    """A word whose bits each carry the set of input bits that can reach them.

    A bit is ``None`` when no input can reach it -- a constant -- and otherwise a
    bitmask over input positions. Every rule is a union, because reachability
    does not distinguish how a bit is combined, only whether it is involved. That
    is exactly what makes this coarser than a degree bound and exactly why it is
    an over-approximation of dependence.
    """

    __slots__ = ("bits", "width")

    def __init__(self, bits: Sequence[int | None], width: int) -> None:
        if len(bits) != width:
            raise ValueError(f"expected {width} bits, got {len(bits)}")
        self.bits = tuple(bits)
        self.width = width

    # -- constructors ------------------------------------------------------

    @staticmethod
    def inputs(width: int, first_index: int = 0) -> "ReachWord":
        return ReachWord([1 << (first_index + i) for i in range(width)], width)

    @staticmethod
    def constant(width: int) -> "ReachWord":
        """A known word: no input reaches it, whatever its value."""
        return ReachWord([None] * width, width)

    # -- helpers -----------------------------------------------------------

    def _coerce(self, other: object) -> "ReachWord | int":
        if isinstance(other, ReachWord):
            if other.width != self.width:
                raise ValueError(f"width mismatch: {self.width} vs {other.width}")
            return other
        if isinstance(other, int):
            return other
        raise TypeError(f"cannot combine ReachWord with {type(other).__name__}")

    @staticmethod
    def _join(a: int | None, b: int | None) -> int | None:
        if a is None:
            return b
        if b is None:
            return a
        return a | b

    @property
    def reachable(self) -> int:
        """Union over every bit of this word."""
        total = 0
        for bit in self.bits:
            if bit is not None:
                total |= bit
        return total

    @property
    def reachable_count(self) -> int:
        return self.reachable.bit_count()

    # -- operators ---------------------------------------------------------
    #
    # A constant operand contributes nothing, which is what keeps the round
    # constants and the IV out of the reachable set.

    def _elementwise(self, other: object) -> "ReachWord":
        other = self._coerce(other)
        if isinstance(other, int):
            # Combining with a literal cannot bring an input bit into reach.
            return self
        return ReachWord(
            [self._join(a, b) for a, b in zip(self.bits, other.bits)], self.width
        )

    __xor__ = __rxor__ = _elementwise
    __or__ = __ror__ = _elementwise

    def __and__(self, other: object) -> "ReachWord":
        coerced = self._coerce(other)
        if isinstance(coerced, int):
            # Masking with a literal clears bits, and a cleared bit is constant.
            return ReachWord(
                [b if (coerced >> i) & 1 else None for i, b in enumerate(self.bits)],
                self.width,
            )
        return self._elementwise(other)

    __rand__ = __and__

    def __invert__(self) -> "ReachWord":
        return self

    def __lshift__(self, amount: int) -> "ReachWord":
        return ReachWord(
            [self.bits[i - amount] if i >= amount else None for i in range(self.width)],
            self.width,
        )

    def __rshift__(self, amount: int) -> "ReachWord":
        return ReachWord(
            [
                self.bits[i + amount] if i + amount < self.width else None
                for i in range(self.width)
            ],
            self.width,
        )

    def __add__(self, other: object) -> "ReachWord":
        """Modular addition. The carry into position i can be influenced by every
        operand bit at or below i, so reachability accumulates upward."""
        coerced = self._coerce(other)
        if isinstance(coerced, int):
            # Adding a literal still propagates a carry, which mixes this word's
            # own lower bits upward even though no new input enters.
            running: int | None = None
            bits: list[int | None] = []
            for bit in self.bits:
                running = self._join(running, bit)
                bits.append(running)
            return ReachWord(bits, self.width)
        running = None
        bits = []
        for x, y in zip(self.bits, coerced.bits):
            running = self._join(self._join(running, x), y)
            bits.append(running)
        return ReachWord(bits, self.width)

    __radd__ = __add__

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"ReachWord(width={self.width}, reachable={self.reachable_count})"


@dataclass(frozen=True, slots=True)
class ReachResult:
    """Tier P. Which input bits can reach the output, and how tight that is."""

    n_rounds: int
    #: Reachable input bits as a bitmask over **absolute block-bit positions**,
    #: so it can be compared against a dependence matrix rather than only
    #: counted. A count alone cannot be checked for soundness -- the identity of
    #: the bits is what the claim is about.
    reachable_mask: int
    reachable_bits: int
    total_input_bits: int
    reachable_words: int
    total_words: int
    per_output_bit_min: int
    per_output_bit_max: int
    derivation: str

    @property
    def complete(self) -> bool:
        return self.reachable_bits == self.total_input_bits

    @property
    def word_level_overstatement(self) -> int:
        """Bits the word-level graph names that the bit-level propagation does
        not. The word-level answer counts a whole word once any of its bits is
        involved, so it can only be at least as large."""
        return self.reachable_words * WORD_BITS - self.reachable_bits

    def render(self) -> str:
        return (
            f"rounds={self.n_rounds} reachable_bits={self.reachable_bits}"
            f"/{self.total_input_bits} reachable_words={self.reachable_words}"
            f"/{self.total_words} per_output_bit=[{self.per_output_bit_min},"
            f"{self.per_output_bit_max}] complete={self.complete} "
            f"word_level_overstatement={self.word_level_overstatement}"
        )


def sha256_reachability(target: SHA256Compression) -> ReachResult:
    """Trace ``core.sha256.compress`` with reachable-set words.

    The target's own code is run, not re-implemented, so the answer cannot drift
    from the function it describes -- the same discipline ``keccak_bound`` and
    ``sha256_support_bound`` follow.
    """
    free_mask = target.free_mask
    words: list[ReachWord] = []
    for index in range(BLOCK_WORDS):
        low = WORD_BITS * (BLOCK_WORDS - 1 - index)
        words.append(
            ReachWord(
                [
                    (1 << (low + offset)) if (free_mask >> (low + offset)) & 1 else None
                    for offset in range(WORD_BITS)
                ],
                WORD_BITS,
            )
        )

    state = [ReachWord.constant(WORD_BITS) for _ in SHA256_IV]
    out = sha256_compress(words, state, target.n_rounds)

    union = 0
    per_bit: list[int] = []
    for word in out:
        union |= word.reachable
        for bit in word.bits:
            per_bit.append(0 if bit is None else bit.bit_count())

    words_touched = reachable_words(target.n_rounds)
    return ReachResult(
        n_rounds=target.n_rounds,
        reachable_mask=union,
        reachable_bits=union.bit_count(),
        total_input_bits=target.free_bits,
        reachable_words=len(words_touched),
        total_words=BLOCK_WORDS,
        per_output_bit_min=min(per_bit) if per_bit else 0,
        per_output_bit_max=max(per_bit) if per_bit else 0,
        derivation=(
            "reachable input-bit sets propagated through core.sha256.compress "
            "itself: every operator unions its operands' sets, a literal operand "
            "contributes nothing, shifts and rotations move sets rather than "
            "merging them, and modular addition unions every operand bit at or "
            f"below each position because the carry reaches there. Over "
            f"{target.n_rounds} rounds {union.bit_count()} of {target.free_bits} "
            "input bits can reach the output"
        ),
    )


# ---------------------------------------------------------------------------
# The calibration entry point
# ---------------------------------------------------------------------------


def measure(target: Any, case: Any) -> int:
    """Dispatch on the quantity the calibration case names."""
    quantity = case.quantity
    if quantity == "reachable_input_bits":
        if not isinstance(target, SHA256Compression):
            raise ReachRefused(
                "the reachability path traces the SHA-256 compression function; "
                f"{type(target).__name__} has no schedule to trace"
            )
        return sha256_reachability(target).reachable_bits
    if quantity == "reachable_block_words":
        if not isinstance(target, SHA256Compression):
            raise ReachRefused(
                "block-word reachability is a property of the SHA-256 message "
                f"schedule; {type(target).__name__} has none"
            )
        return len(reachable_words(target.n_rounds))
    if quantity == "free_message_bits":
        if not isinstance(target, SHA256Compression):
            raise ReachRefused(
                f"{type(target).__name__} has no message schedule, so no freedom "
                "budget"
            )
        return freedom_budget(target.n_rounds).free_bits
    raise ReachRefused(f"no measurement path for quantity {quantity!r}")
