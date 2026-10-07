"""Module 5: meet-in-the-middle splitting structure.

The load-bearing test is soundness: consumption must *contain* dependence. It is
checked against ``verify/mitm.py``, which evaluates the real
``core.sha256.message_schedule`` and shares no code with the module. A block
word observed to move a chunk that the module says the chunk does not consume
would refute the module, and that is what the check looks for.

The three hypotheses PREREG-M5 §3 registered before the measurement was run
against SHA-256 are resolved here.
"""

from __future__ import annotations

import pytest

from core.sha256 import FULL_ROUNDS, SHA256Compression
from core.targets import CancellingSchedule, PowerMap
from modules.mitm.measure import (
    BLOCK_WORDS,
    WORD_BITS,
    MitmRefused,
    best_split,
    consumption_for,
    enumerate_splits,
    independent_splits,
    last_independent_round,
    measure,
    schedule_word_sources,
    split_at,
    words_consumed,
)
from verify.mitm import (
    consumption_contains_dependence,
    observed_consumption,
    observed_dependence,
)

# -- soundness: consumption contains dependence ------------------------------


@pytest.mark.parametrize("start,end", [(0, 8), (0, 16), (0, 20), (8, 24), (0, 24)])
def test_consumption_contains_observed_dependence(start: int, end: int) -> None:
    """PREREG-M5 H1, against the independent path."""
    holds, escaping = consumption_contains_dependence(
        words_consumed(start, end), observed_consumption(start, end, end)
    )
    assert holds, f"block words escaping the consumption set: {sorted(escaping)}"


def test_the_two_paths_agree_exactly_on_the_real_schedule() -> None:
    """Not merely contained: equal, at every schedule word below 24.

    Consumption is an upper bound in principle -- that is the blindness class --
    but on SHA-256 it happens to be tight. Recorded as a measurement rather than
    assumed, because if a later change made it loose the blindness class would
    stop being hypothetical and the module's nulls would weaken.
    """
    observed = observed_dependence(24)
    for t in range(24):
        assert observed[t] == schedule_word_sources(t), t


# -- the registered hypotheses -----------------------------------------------


def test_h2_matching_freedom_never_exceeds_half_the_block() -> None:
    """PREREG-M5 H2. More than half would mean neutral sets double-counted."""
    half = BLOCK_WORDS * WORD_BITS // 2
    for end in range(1, FULL_ROUNDS + 1):
        best = best_split(0, end)
        if best is not None:
            assert best.matching_dof_bits <= half, end


def test_h3_matching_freedom_is_monotone_non_increasing() -> None:
    """PREREG-M5 H3, confirmed: the schedule never regains splittability."""
    previous = None
    for end in range(16, FULL_ROUNDS + 1):
        best = best_split(0, end)
        value = best.matching_dof_bits if best is not None else 0
        if previous is not None:
            assert value <= previous, f"freedom rose at end={end}"
        previous = value


def test_the_matching_freedom_falls_by_one_word_per_round() -> None:
    """The substantive Tier E result, asserted as the closed form it follows.

    From the round at which the whole block is consumed, each further round
    costs exactly one word of matching freedom, and it reaches zero at 24.
    """
    for end in range(16, 24):
        best = best_split(0, end)
        assert best is not None, end
        assert best.matching_dof_bits == (24 - end) * WORD_BITS, end
    assert best_split(0, 24) is None


def test_the_last_round_with_a_word_level_split_is_23() -> None:
    assert last_independent_round(0) == 23
    assert independent_splits(0, 23)
    assert not independent_splits(0, 24)


def test_the_best_split_of_the_first_sixteen_rounds_halves_the_block() -> None:
    """Below round 16 nothing is derived, so the cut at 8 partitions cleanly."""
    best = best_split(0, 16)
    assert best is not None
    assert best.cut == 8
    assert best.forward_neutral == frozenset(range(0, 8))
    assert best.backward_neutral == frozenset(range(8, 16))
    assert best.matching_dof_bits == 256


# -- the enumeration ---------------------------------------------------------


def test_the_sweep_examines_every_cut_in_the_range() -> None:
    """Tier E: a stated space, exhausted, with nothing outside it claimed."""
    splits = enumerate_splits(0, 20)
    assert len(splits) == 21
    assert [s.cut for s in splits] == list(range(21))


def test_a_cut_at_either_extreme_leaves_a_chunk_empty_and_is_not_independent() -> None:
    for end in (1, 8, 24, 64):
        assert not split_at(0, 0, end).independent
        assert not split_at(end, 0, end).independent


def test_an_empty_chunk_consumes_nothing() -> None:
    assert words_consumed(5, 5) == frozenset()


def test_ties_break_towards_the_earlier_cut_so_the_answer_is_deterministic() -> None:
    first = best_split(0, 16)
    for _ in range(3):
        assert best_split(0, 16).cut == first.cut


# -- the schedule ------------------------------------------------------------


def test_a_block_word_is_its_own_source() -> None:
    for index in range(BLOCK_WORDS):
        assert schedule_word_sources(index) == frozenset({index})


def test_the_first_derived_word_has_the_recurrence_s_four_sources() -> None:
    assert schedule_word_sources(16) == frozenset({0, 1, 9, 14})


def test_module_five_and_module_two_read_the_same_schedule() -> None:
    """Two modules, two hand-written copies of the recurrence.

    M5 does not import M2's closure, deliberately: a second reading is worth
    more than a shared one. A disagreement would mean one of them is wrong
    about SHA-256.
    """
    from modules.reach.measure import schedule_sources

    for index in range(FULL_ROUNDS):
        assert schedule_word_sources(index) == schedule_sources(index), index


# -- refusals ----------------------------------------------------------------


def test_an_out_of_range_round_is_refused() -> None:
    with pytest.raises(MitmRefused, match=r"must be in \[0, 64\]"):
        words_consumed(0, 65)
    with pytest.raises(MitmRefused, match="is after end"):
        words_consumed(9, 4)
    with pytest.raises(MitmRefused, match="outside the range"):
        split_at(20, 0, 10)


def test_a_schedule_index_beyond_the_round_count_is_refused() -> None:
    with pytest.raises(MitmRefused, match="beyond the 64-round schedule"):
        schedule_word_sources(FULL_ROUNDS)
    with pytest.raises(ValueError, match="non-negative"):
        schedule_word_sources(-1)


def test_the_dispatch_refuses_a_target_with_no_schedule() -> None:
    class Case:
        quantity = "independent_split_count"
        parameters: dict = {}

    with pytest.raises(MitmRefused, match="no round schedule to split"):
        measure(PowerMap.create(9, 3), Case())


def test_the_dispatch_refuses_an_unknown_quantity() -> None:
    class Case:
        quantity = "something_else"
        parameters: dict = {}

    with pytest.raises(MitmRefused, match="no measurement path"):
        measure(SHA256Compression.create(n_rounds=8), Case())


# -- a target that brings its own schedule -----------------------------------


def test_a_target_carrying_its_own_wiring_is_measured_on_it() -> None:
    """The counterexample is a schedule too, and is measured as one."""
    target = CancellingSchedule.create()
    consume = consumption_for(target)
    assert consume is not words_consumed
    assert consume(0, 3) == frozenset({0, 1, 2})
    assert len(independent_splits(0, target.n_rounds, consume)) == 0


def test_a_target_without_its_own_wiring_falls_back_to_sha256() -> None:
    assert consumption_for(SHA256Compression.create(n_rounds=8)) is words_consumed


# -- the suite ---------------------------------------------------------------


def test_the_controls_pass_and_the_gate_stays_blocked() -> None:
    from modules.mitm.calibration.suite import SUITE

    report = SUITE.run_controls(measure)
    assert report.satisfied, report.render()
    status = SUITE.gate()
    assert status.blocked
    assert status.blocking_citations == ("CITE-SHA256-MITM",)


def test_the_module_has_a_named_anchor_like_m3_and_unlike_m2_m4_m6() -> None:
    from harness.calibration import CaseKind
    from modules.mitm.calibration.suite import SUITE

    assert not SUITE.allow_missing_ground_truth
    published = [c for c in SUITE.cases if c.kind is CaseKind.PUBLISHED_GROUND_TRUTH]
    assert len(published) == 1
    assert published[0].expectation_provenance.citation_key == "CITE-SHA256-MITM"


# -- the soundness check's direction -----------------------------------------


def test_soundness_holds_when_consumption_is_strictly_looser_than_dependence() -> None:
    """The permitted direction, on a schedule that actually exercises it.

    On SHA-256 the two sets are *equal*, so every soundness assertion above
    passes whichever way the subtraction runs -- which let a mutant that
    inverted it survive. ``CancellingSchedule`` separates them: the wiring says
    the tail consumes all four block words and the probe finds only one, which
    is consumption being loose and is allowed. Soundness must still hold.
    """
    target = CancellingSchedule.create()
    consumed = target.wiring_consumption(3, target.n_rounds)
    observed = _observed_tail(target)
    assert consumed == frozenset({0, 1, 2, 3})
    assert observed == frozenset({3})
    assert observed < consumed, "the sets must differ, or this proves nothing"

    holds, escaping = consumption_contains_dependence(consumed, observed)
    assert holds
    assert escaping == frozenset()


def test_soundness_fails_when_a_word_escapes_the_consumption_set() -> None:
    """The refuting direction, exhibited rather than trusted."""
    holds, escaping = consumption_contains_dependence(
        frozenset({0, 1}), frozenset({0, 1, 7})
    )
    assert not holds
    assert escaping == frozenset({7})


def _observed_tail(target) -> frozenset[int]:
    from verify.mitm import observed_dependence_of

    observed = observed_dependence_of(
        target.evaluate, target.block_words, target.n_rounds
    )
    union: set[int] = set()
    for t in range(3, target.n_rounds):
        union |= observed[t]
    return frozenset(union)


def test_the_final_round_of_the_sweep_is_examined() -> None:
    """A schedule whose *last* round still splits, so dropping it is visible.

    SHA-256 offers no split at round 64, so a sweep that stopped one round
    early gave the identical answer on the only schedule this function could be
    asked about -- an equivalent mutant by construction rather than by luck.
    Measured against the counterexample's true dependence, where a split does
    survive to the final round, the off-by-one shows up.
    """
    target = CancellingSchedule.create()

    def truth(start, end):
        return _dependence_over(target, start, end)

    assert independent_splits(0, target.n_rounds, truth)
    assert (
        last_independent_round(0, max_end=target.n_rounds, consume=truth)
        == target.n_rounds
    )


def _dependence_over(target, start, end) -> frozenset[int]:
    from verify.mitm import observed_dependence_of

    observed = observed_dependence_of(
        target.evaluate, target.block_words, target.n_rounds
    )
    union: set[int] = set()
    for t in range(start, end):
        union |= observed[t]
    return frozenset(union)
