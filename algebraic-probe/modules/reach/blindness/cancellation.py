"""Blindness class for Module 2: reachability over-approximates dependence.

Section 6 requires, for every negative result, the mechanism, a blindness
statement naming a concrete function class that has the property being searched
for and would still produce the same null, and that class implemented and run as
a test.

The null Module 2 emits is "every input bit is reachable to every output bit at
this round count, so no dependency deficiency remains to exploit". Reachability
is computed by unioning the operands of each operation, which is sound as an
*upper* bound on influence and says nothing about whether the influence survives.
Terms cancel. A bit can be reachable through the wiring and be a constant.

``core.targets.CancellingXor`` is the class. ``f(x) = (A x) XOR (B x)`` over
GF(2): every operation unions its operands, so reachability reports the full
input set for every output bit. But the function is ``(A XOR B) x``, and on the
rows where A and B were made identical the sum is the zero row -- those output
bits are identically zero, depend on nothing, and are exhaustively verifiable as
constant.

So a dependency analysis can report complete diffusion for a function with
provably constant output bits. That is not a defect in the reachability
computation, which is doing exactly what it claims; it is the reason this module
reports a *reachable set* and never claims an output actually depends on what it
names.

As with Module 1's classes, no measurement code is imported here. Both the
reachability measure and the exhaustive dependence check are injected by
``tests/test_blindness_cancellation.py``, so ``modules/`` and ``verify/`` stay
independent.
"""

from __future__ import annotations

from typing import Any, Callable

from core.targets import CancellingXor
from tiers.finding import BlindnessTest

COUNTEREXAMPLE_CLASS = (
    "f(x) = (A x) XOR (B x) over GF(2) with A and B sharing rows "
    "(core.targets.CancellingXor): fully reachable, with provably constant "
    "output bits"
)

BLINDNESS_STATEMENT = (
    "Reachability unions the operands of every operation, so it is an upper bound "
    "on influence and not a statement about it. Written as two matrix "
    "applications and an XOR, f(x) = (A x) XOR (B x) presents every input bit as "
    "reaching every output bit. The function it computes is (A XOR B) x, and on "
    "any row where A and B agree that row of the sum is zero: the output bit is "
    "identically zero and depends on no input at all. A dependency analysis "
    "therefore reports complete diffusion for a function with constant outputs, "
    "and 'every bit is reachable' carries no information about whether any bit is "
    "influential."
)

MECHANISM = (
    "Reachability is computed operation by operation and has no way to observe "
    "that two contributions to the same output bit are equal and cancel. The "
    "cancellation is a property of the composition, not of any single operation, "
    "so no amount of care in the propagation rules can see it -- the rules are "
    "individually correct and their union is loose."
)

#: What refuting this class would look like: reachability would have to report
#: something short of complete for a target whose constant bits it cannot see.
FALSIFIER = (
    "if the reachability measure reported fewer than all input bits for the "
    "constant output bits, it would be tracking dependence rather than "
    "reachability and this class would not be a blindness class"
)


def counterexample(n: int, seed: int, shared_rows: tuple[int, ...]) -> CancellingXor:
    return CancellingXor.create(n, seed, shared_rows)


def null_predicate(reachable_bits: int, n: int) -> bool:
    """The null this measurement emits: every input bit reaches the output."""
    return reachable_bits == n


def structure_predicate(constant_bits: tuple[int, ...]) -> bool:
    """The property being searched for, present in the counterexample.

    A blindness class has to have the property, not merely evade the measure. If
    no output bit were constant there would be nothing for reachability to miss.
    """
    return len(constant_bits) > 0


def check(
    reach_measure: Callable[[Any], int],
    dependence_measure: Callable[[Any], tuple[int, ...]],
    *,
    n: int,
    seed: int,
    shared_rows: tuple[int, ...],
    test_id: str,
    computation_id: str,
) -> BlindnessTest:
    """Run both measures on the counterexample.

    ``reach_measure(target) -> reachable input-bit count``;
    ``dependence_measure(target) -> the output bits that are actually constant``.

    Passes only if reachability returns its null *and* constant output bits are
    really there: blindness needs the structure present and the instrument
    missing it.
    """
    target = counterexample(n, seed, shared_rows)
    reachable = reach_measure(target)
    constant = dependence_measure(target)

    same_null = null_predicate(reachable, n)
    has_structure = structure_predicate(constant)

    return BlindnessTest(
        test_id=test_id,
        function_class=f"{COUNTEREXAMPLE_CLASS} at n={n}, shared_rows={shared_rows}",
        passed=same_null and has_structure,
        computation_id=computation_id,
        observed=(
            f"reachable_input_bits={reachable}/{n} reports_complete={same_null} "
            f"constant_output_bits={list(constant)} structure_present={has_structure}"
        ),
    )
