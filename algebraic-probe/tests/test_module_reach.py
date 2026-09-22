"""Module 2: dependency-graph reachability and the freedom budget.

The load-bearing test is soundness: reachability must *contain* dependence. It is
checked against the independent exhaustive path in ``verify/dependence.py``,
which shares no code with the module, on every target small enough to exhaust. An
input bit outside the reachable set on which an output bit demonstrably depends
would refute the module, and that is what the check looks for.

The two hypotheses PREREG-M2 §3 registered before the measurement path existed
are resolved here: H3 holds, H2 does not, and the test that refutes H2 asserts
the refutation rather than being deleted.
"""

from __future__ import annotations

import pytest

from core.sha256 import BLOCK_BITS, FULL_ROUNDS, SHA256Compression
from core.targets import CancellingXor, LinearMapGF2, PowerMap
from modules.reach.measure import (
    BLOCK_WORDS,
    ReachRefused,
    ReachWord,
    first_round_reaching_every_word,
    freedom_budget,
    measure,
    reachable_words,
    schedule_sources,
    sha256_reachability,
)
from verify.dependence import (
    constant_output_bits,
    dependence_matrix,
    reachability_contains_dependence,
)

W0 = SHA256Compression.WORD0_OFFSET


# -- soundness: reachability contains dependence -----------------------------


@pytest.mark.parametrize("free_bits,rounds", [(8, 1), (8, 4), (10, 2), (10, 64), (12, 8)])
def test_reachability_contains_actual_dependence(free_bits: int, rounds: int) -> None:
    """PREREG-M2 H1, against the independent exhaustive path."""
    target = SHA256Compression.create(
        n_rounds=rounds, free_bits=free_bits, free_offset=W0
    )
    result = sha256_reachability(target)
    # The module works in absolute block-bit positions; the dependence matrix
    # works in the target's own input coordinates. Shift, rather than compare a
    # count, so the check is about the identity of the bits.
    reachable_in_target_coords = result.reachable_mask >> target.free_offset
    holds, escaping = reachability_contains_dependence(
        target, target.n_in, target.n_out, reachable_in_target_coords
    )
    assert result.reachable_bits <= free_bits
    assert holds, f"input bits escaping the reachable set: {bin(escaping)}"


def test_a_target_with_no_reachable_bits_has_no_dependence() -> None:
    """Zero rounds: the floor, checked both ways."""
    target = SHA256Compression.create(n_rounds=0, free_bits=8, free_offset=W0)
    assert sha256_reachability(target).reachable_bits == 0
    matrix = dependence_matrix(target, 8, target.n_out)
    assert all(row == 0 for row in matrix), "nothing can depend on an unread message"


# -- the two registered hypotheses -------------------------------------------


def test_h3_holds_union_completeness_precedes_per_bit_completeness() -> None:
    """PREREG-M2 H3, confirmed. The union of reachable bits is complete at round
    16 -- the round that consumes the last block word -- but five more rounds
    pass before *every* output bit reaches *every* input bit."""
    union_round = next(
        r
        for r in range(FULL_ROUNDS + 1)
        if sha256_reachability(SHA256Compression.create(n_rounds=r)).reachable_bits
        == BLOCK_BITS
    )
    per_bit_round = next(
        r
        for r in range(FULL_ROUNDS + 1)
        if sha256_reachability(SHA256Compression.create(n_rounds=r)).per_output_bit_min
        == BLOCK_BITS
    )
    assert union_round == 16
    assert per_bit_round == 21
    assert union_round < per_bit_round


def test_h2_is_refuted_the_bit_level_answer_is_no_tighter() -> None:
    """PREREG-M2 H2, **refuted**, and asserted as such.

    The prediction was that bit-level propagation would be strictly tighter than
    the word-level closure somewhere, since rotations and shifts move bits rather
    than merging them. It never is: modular addition's carry chain unions every
    operand bit at or below each position, and there are enough additions per
    round that every bit of a consumed word becomes reachable anyway.

    This is a fact about ARX mixing, not about the implementation. A design whose
    mixing were rotation-only would separate the two, which is why the test
    asserts the refutation rather than being removed.
    """
    overstatements = {
        sha256_reachability(
            SHA256Compression.create(n_rounds=r)
        ).word_level_overstatement
        for r in range(FULL_ROUNDS + 1)
    }
    assert overstatements == {0}, overstatements


# -- the schedule ------------------------------------------------------------


def test_the_first_derived_word_has_the_recurrence_s_four_sources() -> None:
    assert schedule_sources(16) == frozenset({0, 1, 9, 14})


def test_a_block_word_is_its_own_source() -> None:
    for index in range(BLOCK_WORDS):
        assert schedule_sources(index) == frozenset({index})


def test_schedule_sources_only_grow() -> None:
    previous = 0
    for index in range(BLOCK_WORDS, FULL_ROUNDS):
        size = len(schedule_sources(index))
        assert size >= previous or index <= BLOCK_WORDS + 8
        previous = max(previous, size)
    assert len(schedule_sources(FULL_ROUNDS - 1)) == BLOCK_WORDS


def test_every_block_word_is_reachable_exactly_at_round_16() -> None:
    assert first_round_reaching_every_word() == BLOCK_WORDS
    assert len(reachable_words(15)) == 15
    assert len(reachable_words(16)) == 16


def test_reachable_words_grows_one_per_round_until_the_block_is_consumed() -> None:
    for rounds in range(BLOCK_WORDS + 1):
        assert len(reachable_words(rounds)) == rounds


def test_a_schedule_index_beyond_the_round_count_is_refused() -> None:
    with pytest.raises(ReachRefused, match="beyond the 64-round schedule"):
        schedule_sources(FULL_ROUNDS)
    with pytest.raises(ValueError, match="non-negative"):
        schedule_sources(-1)


# -- the freedom budget ------------------------------------------------------


def test_freedom_saturates_at_the_block_and_never_grows_again() -> None:
    for rounds in range(BLOCK_WORDS + 1):
        assert freedom_budget(rounds).free_bits == rounds * 32
    for rounds in (17, 24, 40, 64):
        budget = freedom_budget(rounds)
        assert budget.free_bits == BLOCK_BITS
        assert budget.derived_words == rounds - BLOCK_WORDS


def test_zero_rounds_spends_no_freedom() -> None:
    budget = freedom_budget(0)
    assert budget.free_bits == 0
    assert budget.last_directly_settable_round == -1
    assert "no round consumes" in budget.derivation


def test_the_last_directly_settable_round_is_fifteen() -> None:
    assert freedom_budget(FULL_ROUNDS).last_directly_settable_round == 15


def test_an_out_of_range_round_count_is_refused() -> None:
    with pytest.raises(ValueError, match=r"n_rounds must be in \[0, 64\]"):
        freedom_budget(65)
    with pytest.raises(ValueError, match=r"n_rounds must be in \[0, 64\]"):
        reachable_words(-1)


# -- the ReachWord type ------------------------------------------------------


def test_reach_words_union_on_every_operator() -> None:
    a = ReachWord.inputs(4, first_index=0)
    b = ReachWord.inputs(4, first_index=4)
    for combined in (a ^ b, a | b, a & b):
        assert combined.reachable_count == 8


def test_a_constant_word_contributes_nothing() -> None:
    a = ReachWord.inputs(4, first_index=0)
    k = ReachWord.constant(4)
    assert (a ^ k).reachable_count == 4
    assert k.reachable_count == 0


def test_masking_with_a_literal_makes_cleared_bits_constant() -> None:
    a = ReachWord.inputs(8, first_index=0)
    assert (a & 0x0F).reachable_count == 4


def test_a_rotation_moves_sets_rather_than_merging_them() -> None:
    a = ReachWord.inputs(8, first_index=0)
    rotated = (a >> 3) | (a << 5)
    assert rotated.reachable_count == 8
    for bit in rotated.bits:
        assert bit is not None and bit.bit_count() == 1, "a rotation permutes bits"


def test_addition_accumulates_reachability_upward() -> None:
    """The carry chain: bit i can be influenced by every operand bit at or below."""
    a = ReachWord.inputs(8, first_index=0)
    b = ReachWord.inputs(8, first_index=8)
    total = a + b
    counts = [bit.bit_count() for bit in total.bits]
    assert counts == [2, 4, 6, 8, 10, 12, 14, 16]


def test_adding_a_literal_still_mixes_the_word_s_own_bits_upward() -> None:
    a = ReachWord.inputs(8, first_index=0)
    counts = [bit.bit_count() for bit in (a + 0xFF).bits]
    assert counts == [1, 2, 3, 4, 5, 6, 7, 8]


def test_complement_changes_no_reachability() -> None:
    a = ReachWord.inputs(8, first_index=0)
    assert (~a).reachable == a.reachable


def test_width_mismatch_and_bad_operand_are_refused() -> None:
    with pytest.raises(ValueError, match="width mismatch"):
        _ = ReachWord.inputs(4) ^ ReachWord.inputs(8)
    with pytest.raises(TypeError, match="cannot combine ReachWord"):
        _ = ReachWord.inputs(4) ^ object()


# -- the calibration dispatch ------------------------------------------------


def test_the_dispatch_refuses_a_target_with_no_schedule() -> None:
    class Case:
        quantity = "reachable_input_bits"

    with pytest.raises(ReachRefused, match="has no schedule to trace"):
        measure(PowerMap.create(9, 3), Case())

    class WordCase:
        quantity = "reachable_block_words"

    with pytest.raises(ReachRefused, match="property of the SHA-256 message schedule"):
        measure(LinearMapGF2.random_invertible(8, 1), WordCase())


def test_the_dispatch_refuses_an_unknown_quantity() -> None:
    class Case:
        quantity = "something_else"

    with pytest.raises(ReachRefused, match="no measurement path"):
        measure(SHA256Compression.create(n_rounds=1), Case())


# -- the blindness class -----------------------------------------------------


def test_reachability_reports_complete_diffusion_for_constant_outputs() -> None:
    """The over-approximation, exhibited on the class that carries it."""
    target = CancellingXor.create(10, 7, (2, 5))
    constant = constant_output_bits(target, 10, 10)
    assert constant == (2, 5), "the construction's constant bits, verified exhaustively"
    matrix = dependence_matrix(target, 10, 10)
    assert matrix[2] == 0 and matrix[5] == 0
    assert any(row != 0 for row in matrix), "other bits do depend on the input"
