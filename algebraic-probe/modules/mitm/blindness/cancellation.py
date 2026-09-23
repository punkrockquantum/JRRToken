"""Blindness class for Module 5: consumption over-approximates dependence.

Section 6 requires, for every negative result, the mechanism, a blindness
statement naming a concrete function class that has the property being searched
for and would still produce the same null, and that class implemented and run as
a test.

Module 5's null is "no independent split was found at this cut, so the two
chunks cannot be enumerated separately". It decides that by asking which block
words each chunk *consumes*, and it answers by unioning the operands of every
step of the schedule recurrence. That is sound as an upper bound on influence
and says nothing about whether the influence survives. Terms cancel.

``core.targets.CancellingSchedule`` is the class. Its recurrence is
``W[t] = W[t-4] XOR W[t-4] XOR W[t-1]``: the first two terms are the same word
and annihilate, so every derived word is just ``W[t-1]`` and the whole tail
depends on block word 3 alone. The wiring cannot see the cancellation, so it
reports the tail as consuming every block word.

At the cut after round 3:

    by the wiring    forward neutral {}           -> no independent split
    in truth         forward neutral {0, 1, 2}    -> an independent split, with
                                                    three words of freedom

So the module reports no split for a schedule that has one. The direction
matters and is worth stating: this under-reports attack structure rather than
inventing it, so it cannot manufacture a false positive. What it can do is make
a null look like evidence of absence, and a null from Module 5 is not that.

Worth recording alongside: on SHA-256's real schedule the two paths **agree
exactly** at every schedule word measured, so this over-approximation is a
property the measure has rather than one SHA-256 exercises. The class is
constructed for that reason -- the blindness is real, and the primary target
does not happen to trigger it.

As with the other modules' classes, no measurement code is imported here. Both
the consumption measure and the dependence probe are injected by
``tests/test_blindness_mitm.py``, so ``modules/`` and ``verify/`` stay
independent.
"""

from __future__ import annotations

from typing import Any, Callable

from core.targets import CancellingSchedule
from tiers.finding import BlindnessTest

COUNTEREXAMPLE_CLASS = (
    "W[t] = W[t-4] XOR W[t-4] XOR W[t-1] (core.targets.CancellingSchedule): a "
    "schedule whose wiring carries every block word into the tail while the "
    "tail depends on one of them"
)

BLINDNESS_STATEMENT = (
    "A meet-in-the-middle split is decided here by set difference on consumed "
    "block words, and consumption is computed by unioning the operands of each "
    "step of the recurrence. A word that reaches a chunk and cancels inside it "
    "is counted as consumed and therefore not counted neutral, so the split it "
    "would have permitted is not reported. In the counterexample the forward "
    "chunk truly has three neutral words and the measure reports none, so the "
    "null 'no independent split at this cut' is emitted for a schedule that "
    "splits cleanly. The measure is correct about the wiring and wrong about "
    "the function."
)

MECHANISM = (
    "Consumption is accumulated step by step and has no way to observe that two "
    "contributions to the same word are equal and cancel. The cancellation is a "
    "property of the composition, not of any single step, so no amount of care "
    "in the propagation rules can see it -- each rule is individually correct "
    "and their union is loose."
)

#: What refuting this class would look like.
FALSIFIER = (
    "if the consumption measure reported fewer than all block words for the "
    "cancelling tail, it would be tracking dependence rather than consumption "
    "and this class would not be a blindness class; if the tail genuinely "
    "depended on every block word there would be no split for the measure to "
    "miss"
)

#: The cut the class is exhibited at, and what each side truly has there.
CUT = 3
TRUE_FORWARD_NEUTRAL = frozenset({0, 1, 2})
TRUE_BACKWARD_NEUTRAL = frozenset({3})


def counterexample() -> CancellingSchedule:
    return CancellingSchedule.create()


def null_predicate(wiring_forward_neutral: frozenset[int]) -> bool:
    """The null this measurement emits: no freedom on the forward side."""
    return not wiring_forward_neutral


def structure_predicate(
    true_forward_neutral: frozenset[int], true_backward_neutral: frozenset[int]
) -> bool:
    """The property being searched for, present in the counterexample.

    A blindness class has to *have* the structure, not merely evade the
    measure. If the schedule had no real split there would be nothing missed.
    """
    return bool(true_forward_neutral) and bool(true_backward_neutral)


def check(
    consumption_measure: Callable[[Any, int, int], frozenset[int]],
    dependence_measure: Callable[[Any, int, int], frozenset[int]],
    *,
    test_id: str,
    computation_id: str,
) -> BlindnessTest:
    """Run both measures on the counterexample.

    ``consumption_measure(target, start, end)`` returns the words the wiring
    says the rounds ``[start, end)`` consume; ``dependence_measure`` returns the
    words those rounds were observed actually to depend on.

    Passes only if the measure returns its null *and* the split is really
    there: blindness needs the structure present and the instrument missing it.
    """
    target = counterexample()
    end = target.n_rounds

    wiring_forward = consumption_measure(target, 0, CUT)
    wiring_backward = consumption_measure(target, CUT, end)
    true_forward = dependence_measure(target, 0, CUT)
    true_backward = dependence_measure(target, CUT, end)

    wiring_forward_neutral = wiring_forward - wiring_backward
    true_forward_neutral = true_forward - true_backward
    true_backward_neutral = true_backward - true_forward

    same_null = null_predicate(wiring_forward_neutral)
    has_structure = structure_predicate(true_forward_neutral, true_backward_neutral)

    return BlindnessTest(
        test_id=test_id,
        function_class=f"{COUNTEREXAMPLE_CLASS} at cut={CUT}, rounds={end}",
        passed=same_null and has_structure,
        computation_id=computation_id,
        observed=(
            f"wiring_forward_neutral={sorted(wiring_forward_neutral)} "
            f"reports_no_split={same_null} "
            f"true_forward_neutral={sorted(true_forward_neutral)} "
            f"true_backward_neutral={sorted(true_backward_neutral)} "
            f"structure_present={has_structure}"
        ),
    )
