"""Module 5's measurement path: meet-in-the-middle splitting structure.

Section 9 declares the quantity as "splitting points, independent chunks,
matching degrees of freedom" and the tiers as **P and E**. Both are properties
of the message schedule's wiring, so nothing here samples.

What a meet-in-the-middle split is, as this module measures it. Cut the round
sequence at a point. The rounds before the cut form one chunk and the rounds
after it form the other. A block word consumed by one chunk and *not* by the
other is **neutral** for that chunk: it can be varied to move one side while the
other stands still. A split with a non-empty neutral set on each side is what
lets the two sides be enumerated independently and met in the middle.

Two quantities, two tiers:

  ``split_at``            Tier P. For one stated cut, the words each chunk
                          consumes, the two neutral sets, and the degrees of
                          freedom in bits. Deductive: a transitive closure over
                          the schedule recurrence, no enumeration.

  ``enumerate_splits``    Tier E. Every cut in a stated round range, exhausted.
                          The space is small and finite -- at most 65 cuts for
                          the full schedule -- so this is a complete enumeration
                          of a stated space rather than a search.

**What this is not.** A split with neutral words on both sides is *necessary*
for a meet-in-the-middle attack and nowhere near sufficient. This module does
not model matching, memory, partial matching, message compensation, or the cost
of the meet itself; it does not evaluate SHA-256 at all. It reports a property
of the schedule's wiring, and a positive reading is an absence of one obstacle,
not the presence of an attack.

**And it over-approximates.** Consumption is computed by unioning the operands
of the recurrence, exactly as Module 2's reachability does, so it says a chunk
consumes a word whenever the wiring carries it there -- whether or not the
contribution survives. A word that reaches a chunk and cancels inside it is
reported as consumed, so it is *not* counted neutral, so a split that genuinely
exists can be missed. ``blindness/cancellation.py`` exhibits that class.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from tiers.errors import ProbeError

#: The SHA-256 message schedule recurrence's back-references:
#: W[t] = W[t-16] + sigma0(W[t-15]) + W[t-7] + sigma1(W[t-2]).
#: Written out here rather than imported from Module 2, so that the two modules
#: reading the same schedule are two readings. They agree; a disagreement would
#: mean one of them is wrong about SHA-256.
SCHEDULE_OFFSETS = (16, 15, 7, 2)

BLOCK_WORDS = 16
WORD_BITS = 32
FULL_ROUNDS = 64


class MitmRefused(ProbeError):
    """The requested split quantity has no path or is out of range."""


def _check_round(value: int, name: str) -> None:
    if not 0 <= value <= FULL_ROUNDS:
        raise MitmRefused(f"{name} must be in [0, {FULL_ROUNDS}]; got {value}")


def schedule_word_sources(index: int) -> frozenset[int]:
    """Block words W[0..15] that schedule word W[index] is built from.

    Transitive closure of the recurrence. For index < 16 the word *is* a block
    word, so the answer is itself.
    """
    if index < 0:
        raise ValueError("schedule index must be non-negative")
    if index >= FULL_ROUNDS:
        raise MitmRefused(
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


def words_consumed(start: int, end: int) -> frozenset[int]:
    """Block words consumed by the rounds in ``[start, end)``.

    An empty range consumes nothing, which is why a cut at either extreme has
    one chunk with everything neutral and one with nothing: a "split" that is
    not a split.
    """
    _check_round(start, "start")
    _check_round(end, "end")
    if start > end:
        raise MitmRefused(f"start {start} is after end {end}")
    union: set[int] = set()
    for t in range(start, end):
        union |= schedule_word_sources(t)
    return frozenset(union)


@dataclass(frozen=True, slots=True)
class Split:
    """One cut of the round sequence, and what each side can move alone."""

    start: int
    cut: int
    end: int
    forward_words: frozenset[int]
    backward_words: frozenset[int]

    @property
    def forward_neutral(self) -> frozenset[int]:
        """Words the forward chunk consumes and the backward chunk does not."""
        return self.forward_words - self.backward_words

    @property
    def backward_neutral(self) -> frozenset[int]:
        return self.backward_words - self.forward_words

    @property
    def shared_words(self) -> frozenset[int]:
        return self.forward_words & self.backward_words

    @property
    def independent(self) -> bool:
        """Both sides have something they alone can move.

        Both, not either: a neutral set on one side only gives no meet. The
        empty chunks at the extremes fail here, which is the intended reading.
        """
        return bool(self.forward_neutral) and bool(self.backward_neutral)

    @property
    def forward_dof_bits(self) -> int:
        return len(self.forward_neutral) * WORD_BITS

    @property
    def backward_dof_bits(self) -> int:
        return len(self.backward_neutral) * WORD_BITS

    @property
    def matching_dof_bits(self) -> int:
        """The smaller of the two, which is what a meet is limited by.

        Reported as the minimum rather than the sum, because a meet needs both
        sides to move and the short side is the constraint.
        """
        return min(self.forward_dof_bits, self.backward_dof_bits)

    def render(self) -> str:
        return (
            f"start={self.start} cut={self.cut} end={self.end} "
            f"forward_neutral={sorted(self.forward_neutral)} "
            f"backward_neutral={sorted(self.backward_neutral)} "
            f"shared={len(self.shared_words)} "
            f"dof_forward={self.forward_dof_bits} "
            f"dof_backward={self.backward_dof_bits} "
            f"matching_dof={self.matching_dof_bits} "
            f"independent={self.independent}"
        )


#: A consumption function: given a round range, the block words it consumes.
#: SHA-256's is ``words_consumed``. A target that carries its own schedule --
#: the blindness class does -- supplies its own, so the splitting logic is
#: exercised on both rather than duplicated for the counterexample.
Consume = Any


def consumption_for(target: Any):
    """The consumption function for a target.

    A target exposing ``wiring_consumption`` brings its own schedule and is
    measured on it. Anything else is measured on SHA-256's, which is what this
    module is for.
    """
    own = getattr(target, "wiring_consumption", None)
    if callable(own):
        return own
    return words_consumed


def split_at(
    cut: int, start: int = 0, end: int = FULL_ROUNDS, consume: Consume = None
) -> Split:
    """Tier P. One stated cut, resolved deductively from the wiring."""
    consume = consume if consume is not None else words_consumed
    if not start <= cut <= end:
        raise MitmRefused(f"cut {cut} is outside the range [{start}, {end}]")
    return Split(
        start=start,
        cut=cut,
        end=end,
        forward_words=frozenset(consume(start, cut)),
        backward_words=frozenset(consume(cut, end)),
    )


def enumerate_splits(
    start: int = 0, end: int = FULL_ROUNDS, consume: Consume = None
) -> tuple[Split, ...]:
    """Tier E. Every cut in ``[start, end]``, exhausted.

    The space is ``end - start + 1`` cuts and is stated in full, so this is an
    enumeration rather than a search: there is no cut in the range it does not
    examine and none outside the range it claims anything about.
    """
    if start > end:
        raise MitmRefused(f"start {start} is after end {end}")
    return tuple(split_at(cut, start, end, consume) for cut in range(start, end + 1))


def independent_splits(
    start: int = 0, end: int = FULL_ROUNDS, consume: Consume = None
) -> tuple[Split, ...]:
    """The cuts from the exhaustive enumeration that have both neutral sets."""
    return tuple(s for s in enumerate_splits(start, end, consume) if s.independent)


def best_split(start: int = 0, end: int = FULL_ROUNDS) -> Split | None:
    """The independent cut with the most matching degrees of freedom.

    ``None`` when no cut in the range is independent, which is a result and not
    a failure: it says the schedule ties the two sides together everywhere in
    that range.

    Ties are broken towards the earlier cut, so the answer is deterministic
    rather than dependent on enumeration order.
    """
    candidates = independent_splits(start, end)
    if not candidates:
        return None
    return max(candidates, key=lambda s: (s.matching_dof_bits, -s.cut))


def last_independent_round(
    start: int = 0, max_end: int = FULL_ROUNDS, consume: Consume = None
) -> int:
    """Largest ``end`` for which some cut in ``[start, end]`` is independent.

    The round count at which the schedule stops offering a split of this shape.
    Returns ``start - 1`` when no round count in range offers one at all.

    ``max_end`` and ``consume`` are taken rather than assumed, for the same
    reason the other entry points take them: a function that can only ever be
    asked about SHA-256 cannot be tested on a schedule whose answer differs, and
    a mutant dropping the final round from this sweep survived until it could
    be. Nothing splits at SHA-256's round 64, so on SHA-256 alone that mutant
    changes no output at all.
    """
    _check_round(start, "start")
    _check_round(max_end, "max_end")
    answer = start - 1
    for end in range(start, max_end + 1):
        if independent_splits(start, end, consume):
            answer = end
    return answer


def measure(target: Any, case: Any) -> Any:
    """Dispatch on the quantity the calibration case names."""
    quantity = case.quantity
    parameters = getattr(case, "parameters", {}) or {}
    if not hasattr(target, "n_rounds"):
        raise MitmRefused(
            f"{type(target).__name__} has no round schedule to split; this "
            "module measures a property of the SHA-256 message schedule"
        )
    start = parameters.get("start", 0)
    end = parameters.get("end", target.n_rounds)
    consume = consumption_for(target)

    if quantity == "independent_split_count":
        return len(independent_splits(start, end, consume))
    if quantity == "matching_dof_bits":
        candidates = independent_splits(start, end, consume)
        if not candidates:
            return 0
        return max(candidates, key=lambda s: (s.matching_dof_bits, -s.cut)).matching_dof_bits
    if quantity == "neutral_word_count":
        split = split_at(parameters["cut"], start, end, consume)
        return len(split.forward_neutral) + len(split.backward_neutral)
    if quantity == "last_independent_round":
        return last_independent_round(start)
    raise MitmRefused(f"no measurement path for quantity {quantity!r}")
