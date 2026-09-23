"""Module 5's blindness class, run rather than asserted.

Section 6(c). Consumption unions the operands of each step of the recurrence, so
a block word that reaches a chunk and cancels inside it is counted consumed and
therefore not counted neutral -- and the split it would have permitted is not
reported. Both measures are injected here so ``modules/`` and ``verify/`` stay
independent.
"""

from __future__ import annotations

import pytest

from core.targets import CancellingSchedule
from modules.mitm.blindness import cancellation as blind
from modules.mitm.measure import independent_splits
from verify.mitm import observed_dependence_of


def _consumption(target, start, end):
    return target.wiring_consumption(start, end)


def _dependence(target, start, end):
    observed = observed_dependence_of(
        target.evaluate, target.block_words, target.n_rounds
    )
    union = set()
    for t in range(start, end):
        union |= observed[t]
    return frozenset(union)


def test_the_class_emits_the_null_while_a_split_really_exists() -> None:
    outcome = blind.check(
        _consumption,
        _dependence,
        test_id="tests/test_blindness_mitm.py",
        computation_id="M5-BLIND-001",
    )
    assert outcome.passed, outcome.observed
    assert "reports_no_split=True" in outcome.observed
    assert "structure_present=True" in outcome.observed


def test_the_cancelling_terms_really_cancel() -> None:
    """The construction, checked rather than described.

    Every derived word equals the last block word, so the tail carries one
    word's worth of information however many rounds it runs for.
    """
    target = CancellingSchedule.create()
    expanded = target.evaluate([1, 2, 4, 8])
    assert expanded[: target.block_words] == [1, 2, 4, 8]
    assert expanded[target.block_words :] == [8] * (
        target.n_rounds - target.block_words
    )


def test_the_wiring_reports_the_tail_consuming_every_block_word() -> None:
    target = CancellingSchedule.create()
    assert target.wiring_consumption(blind.CUT, target.n_rounds) == frozenset(
        range(target.block_words)
    )


def test_the_tail_truly_depends_on_one_block_word() -> None:
    target = CancellingSchedule.create()
    assert _dependence(target, blind.CUT, target.n_rounds) == frozenset({3})


def test_the_missed_split_is_the_one_the_class_names() -> None:
    target = CancellingSchedule.create()
    true_forward = _dependence(target, 0, blind.CUT)
    true_backward = _dependence(target, blind.CUT, target.n_rounds)
    assert true_forward - true_backward == blind.TRUE_FORWARD_NEUTRAL
    assert true_backward - true_forward == blind.TRUE_BACKWARD_NEUTRAL


def test_the_module_finds_no_split_where_truth_has_three() -> None:
    """The gap, counted on both sides.

    The module sees no independent cut anywhere in the counterexample; an
    analysis with access to the true dependence finds three.
    """
    target = CancellingSchedule.create()
    by_wiring = independent_splits(0, target.n_rounds, target.wiring_consumption)
    assert len(by_wiring) == 0

    def truth(start, end):
        return _dependence(target, start, end)

    by_truth = independent_splits(0, target.n_rounds, truth)
    assert len(by_truth) == 3


def test_the_predicates_can_both_fail() -> None:
    """A blindness check that cannot fail is not a check."""
    assert blind.null_predicate(frozenset()) is True
    assert blind.null_predicate(frozenset({0})) is False
    assert blind.structure_predicate(frozenset({0}), frozenset({3})) is True
    assert blind.structure_predicate(frozenset(), frozenset({3})) is False
    assert blind.structure_predicate(frozenset({0}), frozenset()) is False


def test_the_class_states_a_falsifier_and_a_mechanism() -> None:
    assert "cancel" in blind.MECHANISM
    assert blind.FALSIFIER
    assert "under-report" in blind.BLINDNESS_STATEMENT or "not counted neutral" in blind.BLINDNESS_STATEMENT


def test_a_schedule_shorter_than_its_block_is_refused() -> None:
    with pytest.raises(ValueError, match="at least block_words"):
        CancellingSchedule.create(block_words=4, n_rounds=2)
