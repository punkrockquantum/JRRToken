"""Module 6's blindness class, run rather than asserted.

Section 6(c). The plain rotational relation is the special case ``offset = 0``
of the rotational-XOR relation, and a round constant alone is enough to move a
design off that case while leaving the structure whole. Both measures are
injected here so ``modules/`` and ``verify/`` stay independent.
"""

from __future__ import annotations

import pytest

from core.targets import RotateXorConstant
from modules.rx.blindness import rotational_xor as blind
from verify.rotational import count_function_propagation, rx_offsets


def _plain(target, width, amount):
    hits, total = count_function_propagation(target, width, amount)
    return hits / total


def _offsets(target, width, amount):
    return rx_offsets(target, width, amount)


def test_the_class_emits_the_strongest_null_while_structure_is_total() -> None:
    outcome = blind.check(
        _plain,
        _offsets,
        test_id="tests/test_blindness_rx.py",
        computation_id="M6-BLIND-001",
    )
    assert outcome.passed, outcome.observed
    assert "reports_no_propagation=True" in outcome.observed
    assert "structure_present=True" in outcome.observed


def test_the_plain_relation_holds_at_no_input_at_all() -> None:
    """Not at the random level: exactly zero."""
    target = blind.counterexample()
    hits, total = count_function_propagation(target, 16, 3)
    assert hits == 0
    assert total == 65536


def test_the_rotational_xor_characteristic_holds_at_every_input() -> None:
    """Exactly one offset across the whole space is probability 1."""
    target = blind.counterexample()
    offsets = rx_offsets(target, 16, 3)
    assert len(offsets) == 1
    (offset, count), = offsets.items()
    assert count == 65536
    assert offset == target.expected_rx_offset != 0


def test_the_offset_is_the_value_the_algebra_predicts() -> None:
    """C XOR (C <<< r), derived rather than read off the measurement."""
    target = blind.counterexample(width=16, amount=3, constant=0x00FF)
    predicted = target.constant ^ target._rotl(target.constant)
    assert target.expected_rx_offset == predicted
    assert predicted == 0x707


@pytest.mark.parametrize(
    "width,amount,constant", [(8, 1, 0x0F), (12, 5, 0x123), (16, 7, 0xBEEF)]
)
def test_the_class_holds_across_shapes_not_just_one(width, amount, constant) -> None:
    target = blind.counterexample(width, amount, constant)
    hits, _ = count_function_propagation(target, width, amount)
    offsets = rx_offsets(target, width, amount)
    assert hits == 0
    assert len(offsets) == 1


def test_a_rotation_invariant_constant_is_refused_as_a_counterexample() -> None:
    """The mechanism removed: nothing for the measure to miss.

    A blindness class must *have* the structure. With C equal to its own
    rotation the plain relation holds everywhere, so there is no missed
    characteristic and the class refuses to be constructed.
    """
    width, amount = 16, 4
    invariant = RotateXorConstant.rotation_invariant_constant(width, amount)
    with pytest.raises(ValueError, match="nothing for the measure to miss"):
        blind.counterexample(width, amount, invariant)


def test_the_predicates_can_both_fail() -> None:
    assert blind.null_predicate(0.0) is True
    assert blind.null_predicate(0.5) is False
    assert blind.structure_predicate(1) is True
    assert blind.structure_predicate(2) is False


def test_the_class_states_a_mechanism_and_a_falsifier() -> None:
    assert "constant" in blind.MECHANISM
    assert blind.FALSIFIER
    assert "probability 1" in blind.BLINDNESS_STATEMENT
