"""Blindness class: hierarchical landscape geometry under a saturated degree.

Section 6 of the brief requires, for every negative result: the mechanism, a
blindness statement naming a concrete function class that has the property being
searched for and would still produce the same null, and that class implemented
and run as a test.

This class was added after the three that preceded it, in response to an
objection that none of them covered: that "no degree deficiency" may have been
recorded as "no structure". The three existing classes all name *algebraic*
structure the Boolean degree cannot see -- a small implicit relation system over
the extension field, univariate tractability under Boolean saturation,
multiplicative structure. None of them names *geometric* structure in the search
landscape, and the objection is that a landscape can be locally
indistinguishable from random while being globally organised.

The class. ``core.landscape.HierarchicalEnergy`` with ``n_outer > 0``: an energy
on {0,1}^n built from two independent levels, the outer one shared by every state
in a block. Its Boolean view is the energy pushed through its own CDF and
quantised, so the marginal law of the output is uniform -- the same as the
single-level model's -- and every output bit depends on the inner level and hence
on all n input bits.

What makes it a blindness demonstration and not merely two different functions:
the single-level and hierarchical models return the *same* algebraic degree, max
and min over output bits, at every cluster count in the sweep, while the overlap
distribution over their low-energy states separates them at every one. The
degree instrument is measuring something real and is measuring it correctly; it
is simply not measuring this.

As with the other classes, no measurement code is imported here. Both measures
are injected by ``tests/test_blindness_landscape.py``, so the demonstration runs
against the exhaustive paths in ``verify/`` without ``modules/`` and ``verify/``
importing each other.
"""

from __future__ import annotations

from typing import Any, Callable

from core.landscape import HierarchicalEnergy
from tiers.finding import BlindnessTest

COUNTEREXAMPLE_CLASS = (
    "a two-level hierarchical energy on {0,1}^n (core.landscape.HierarchicalEnergy "
    "with n_outer > 0), whose Boolean view saturates the algebraic degree while its "
    "low-energy states are organised into blocks"
)

BLINDNESS_STATEMENT = (
    "Algebraic degree is a property of the algebraic normal form. The organisation "
    "of a search landscape -- how its low-energy states are distributed, whether "
    "they cluster, what overlap they share -- is a property of the joint law of the "
    "function's values across the hypercube, and the two are independent. A "
    "hierarchical landscape and a structureless one can be built to return the same "
    "degree, maximum and minimum over output bits, while their overlap "
    "distributions differ at every cluster count. A saturated degree measurement is "
    "therefore compatible with a landscape an attacker can descend: the null that "
    "Module 1 emits says nothing about geometry, and recording it as 'no structure' "
    "would be an error of scope."
)

MECHANISM = (
    "The degree measure reads the top-weight coefficients of the algebraic normal "
    "form, which are determined by the marginal law of the output. Both models are "
    "constructed so that this marginal is uniform -- the energy is pushed through "
    "its own CDF before quantisation -- so the degree is saturated in both. The "
    "hierarchy lives in which states share an energy offset, which is a statement "
    "about the joint law across states and leaves every marginal untouched."
)

#: What the objection would look like if it were wrong: the degree measure would
#: separate the regimes, and there would be nothing here to record.
FALSIFIER = (
    "if the degree profile differed between the single-level and hierarchical "
    "models at any cluster count in the sweep, the degree measure would be "
    "sensitive to landscape geometry and this class would not be a blindness class"
)


def counterexample(n: int, n_outer: int, outer_weight: float, seed: int) -> HierarchicalEnergy:
    return HierarchicalEnergy.generalised_random_energy_model(
        n, n_outer=n_outer, outer_weight=outer_weight, seed=seed
    )


def control(n: int, seed: int) -> HierarchicalEnergy:
    """The structureless model the counterexample must be indistinguishable from."""
    return HierarchicalEnergy.random_energy_model(n, seed)


def null_predicate(degree_hierarchical: tuple[int, int], degree_control: tuple[int, int]) -> bool:
    """The null this measurement emits: the same degree profile for both.

    Compared against the control rather than against a saturation constant,
    because the claim is that the instrument cannot *separate* the two -- which is
    stronger and more specific than that it saturates on each.
    """
    return degree_hierarchical == degree_control


def structure_predicate(
    mean_overlap_hierarchical: float, mean_overlap_control: float, margin: float = 0.02
) -> bool:
    """The property being searched for, present in the counterexample.

    A blindness class has to have the property, not merely evade the measure. If
    the overlap distributions did not separate, the hierarchical model would carry
    no structure to be blind to and the demonstration would be vacuous.
    """
    return mean_overlap_hierarchical > mean_overlap_control + margin


def check(
    degree_measure: Callable[[Any], tuple[int, int]],
    overlap_measure: Callable[[Any], float],
    *,
    n: int,
    n_outer: int,
    outer_weight: float,
    seed: int,
    test_id: str,
    computation_id: str,
) -> BlindnessTest:
    """Run both measures on the counterexample and on the control.

    ``degree_measure(target) -> (max, min)`` over output bits;
    ``overlap_measure(target) -> mean q`` over the low-energy states.

    The test passes only if the degree measure returns the same answer for both
    *and* the overlap measure separates them: blindness requires that the
    structure be there and that the instrument miss it.
    """
    hierarchical = counterexample(n, n_outer, outer_weight, seed)
    structureless = control(n, seed)

    degree_hierarchical = degree_measure(hierarchical)
    degree_control = degree_measure(structureless)
    overlap_hierarchical = overlap_measure(hierarchical)
    overlap_control = overlap_measure(structureless)

    same_null = null_predicate(degree_hierarchical, degree_control)
    has_structure = structure_predicate(overlap_hierarchical, overlap_control)

    return BlindnessTest(
        test_id=test_id,
        function_class=(
            f"{COUNTEREXAMPLE_CLASS} at n={n}, n_outer={n_outer}, "
            f"outer_weight={outer_weight}"
        ),
        passed=same_null and has_structure,
        computation_id=computation_id,
        observed=(
            f"degree_hierarchical={degree_hierarchical} degree_control={degree_control} "
            f"same_null={same_null} mean_overlap_hierarchical={overlap_hierarchical:.6g} "
            f"mean_overlap_control={overlap_control:.6g} structure_present={has_structure}"
        ),
    )
