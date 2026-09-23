"""Observed word dependence in the SHA-256 message schedule -- M5's independent path.

Section 7.2 makes an independent verification path a precondition of promotion.
``modules/mitm`` computes which block words a round consumes by closing the
recurrence ``W[t] = W[t-16] + sigma0(W[t-15]) + W[t-7] + sigma1(W[t-2])`` over
word indices, as a graph. It never evaluates SHA-256.

This file does the opposite. It calls ``core.sha256.message_schedule`` -- the
real implementation, the one ``hashlib`` agrees with -- flips bits of one block
word at a time, and records which schedule words actually changed. Nothing here
knows the recurrence; it knows only what the schedule produced.

The two answer the same question by different routes, and the check between them
is one-directional by construction:

    observed dependence  is a subset of  true dependence  is a subset of  consumption

Flipping bits can only *find* dependence, never invent it, so an observed
dependence outside the module's consumption set refutes the module -- a wrong
offset in ``SCHEDULE_OFFSETS`` shows up here immediately. The converse is not a
defect: a word counted as consumed but never observed to matter may be a genuine
cancellation, which is the blindness class M5 declares.

Nothing here imports ``modules/`` and nothing in ``modules/`` may import it
(``scripts/ci_checks.py``).
"""

from __future__ import annotations

from typing import Callable

from core.sha256 import BLOCK_BITS, FULL_ROUNDS, WORD_BITS, message_schedule

#: Block words in one SHA-256 message block. Derived from the block and word
#: widths that core/sha256.py declares, rather than written as 16 here.
BLOCK_WORDS = BLOCK_BITS // WORD_BITS

#: Base block-word vectors the probes are taken around. Fixed rather than drawn,
#: so this file is a deterministic computation: the same call gives the same
#: answer on any machine, which is what a verification path has to do.
BASE_VECTORS: tuple[tuple[int, ...], ...] = (
    tuple(0 for _ in range(BLOCK_WORDS)),
    tuple(0xFFFFFFFF for _ in range(BLOCK_WORDS)),
    tuple((0x9E3779B9 * (i + 1)) & 0xFFFFFFFF for i in range(BLOCK_WORDS)),
)

#: Bit positions flipped in each word. All 32, so a dependence carried by any
#: single bit is found; a dependence visible only under a multi-bit change is
#: not, and this file does not claim otherwise.
PROBE_BITS: tuple[int, ...] = tuple(range(WORD_BITS))


class MitmVerifyRefused(Exception):
    """The requested probe is outside the schedule."""


def observed_dependence_of(
    expand: Callable[[list[int]], list[int]],
    block_words: int,
    n_rounds: int,
    bases: tuple[tuple[int, ...], ...] | None = None,
    probe_bits: tuple[int, ...] | None = None,
) -> list[frozenset[int]]:
    """Observed dependence for any schedule-shaped expansion.

    ``expand`` takes the block words and returns the expanded schedule. Kept
    general so the same probe drives both SHA-256's real schedule and the
    constructed counterexample M5's blindness class uses -- a blindness class
    checked by a different method than the thing it is a counterexample to
    would not be checking the same property.
    """
    bases = bases if bases is not None else tuple(
        tuple(v for _ in range(block_words)) for v in (0, 0xFFFFFFFF)
    ) + (tuple((0x9E3779B9 * (i + 1)) & 0xFFFFFFFF for i in range(block_words)),)
    probe_bits = probe_bits if probe_bits is not None else PROBE_BITS

    found: list[set[int]] = [set() for _ in range(n_rounds)]
    for base in bases:
        reference = expand(list(base))
        for word_index in range(block_words):
            for bit in probe_bits:
                perturbed = list(base)
                perturbed[word_index] ^= 1 << bit
                changed = expand(perturbed)
                for t in range(min(n_rounds, len(changed), len(reference))):
                    if changed[t] != reference[t]:
                        found[t].add(word_index)
    return [frozenset(s) for s in found]


def observed_dependence(n_rounds: int = FULL_ROUNDS) -> list[frozenset[int]]:
    """Block words each SHA-256 schedule word was *observed* to depend on.

    Returns one set per schedule index in ``[0, n_rounds)``. A word index is in
    the set when flipping one of its bits, around one of the base vectors,
    changed that schedule word.
    """
    if not 0 <= n_rounds <= FULL_ROUNDS:
        raise MitmVerifyRefused(f"n_rounds must be in [0, {FULL_ROUNDS}]")
    return observed_dependence_of(
        lambda words: message_schedule(words, n_rounds),
        BLOCK_WORDS,
        n_rounds,
        BASE_VECTORS,
        PROBE_BITS,
    )


def observed_consumption(start: int, end: int, n_rounds: int | None = None) -> frozenset[int]:
    """Union of the observed dependence over the rounds in ``[start, end)``."""
    if start > end:
        raise MitmVerifyRefused(f"start {start} is after end {end}")
    per_word = observed_dependence(n_rounds if n_rounds is not None else max(end, 1))
    union: set[int] = set()
    for t in range(start, end):
        if t < len(per_word):
            union |= per_word[t]
    return frozenset(union)


def consumption_contains_dependence(
    consumed: frozenset[int], observed: frozenset[int]
) -> tuple[bool, frozenset[int]]:
    """The soundness direction, and what escaped if it does not hold.

    Returns ``(holds, escaping)``. A non-empty ``escaping`` means the schedule
    was observed to carry a word into a range the module says it does not
    reach, which refutes the module rather than this file.
    """
    escaping = observed - consumed
    return not escaping, escaping
