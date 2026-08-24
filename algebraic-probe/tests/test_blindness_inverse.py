"""Section 6(c): the blindness counterexample implemented and run.

The measure is injected, so this demonstrates the null against the *exact*
reference measure in verify/. That is the strongest form the demonstration can
take: the blindness is a property of the quantity being measured, not of any
approximation to it, so no future bounding argument in Module 1 can remove it.
"""

from __future__ import annotations

import pytest

from core.gf2 import GF2n
from modules.degree.blindness.inverse_map import (
    ALGEBRAIC_TRACTABILITY,
    BLINDNESS_STATEMENT,
    COUNTEREXAMPLE_CLASS,
    check,
    counterexample,
    null_predicate,
)
from tiers.finding import Mechanism, Status, negative
from tiers.provenance import Provenance
from tiers.result import prove
from verify.anf import algebraic_degree

SIZES = (5, 7, 9, 11)


def exact_measure(target, n: int) -> int:
    return algebraic_degree(target, n, n)


@pytest.mark.parametrize("n", SIZES)
def test_inverse_map_returns_the_same_null(n: int) -> None:
    outcome = check(
        exact_measure,
        n,
        test_id="tests/test_blindness_inverse.py::test_inverse_map_returns_the_same_null",
        computation_id=f"M1-BLIND-INV-{n:02d}",
    )
    assert outcome.passed
    assert f"algebraic_degree={n - 1}" in outcome.observed
    assert COUNTEREXAMPLE_CLASS in outcome.function_class


@pytest.mark.parametrize("n", SIZES)
def test_the_counterexample_is_algebraically_trivial(n: int) -> None:
    """The class has the property being searched for: it is solved by one
    quadratic relation, which the degree measurement cannot see."""
    inverse = counterexample(n)
    field = GF2n(n)
    for x in range(1, 1 << n):
        assert field.mul(x, inverse(x)) == 1
    assert inverse(0) == 0
    assert ALGEBRAIC_TRACTABILITY["n_equations"] == 1
    assert ALGEBRAIC_TRACTABILITY["degree_of_system"] == 2


def test_the_null_predicate_is_the_saturated_maximum() -> None:
    assert null_predicate(8, 9)
    assert not null_predicate(7, 9)


def test_a_measure_that_did_not_return_the_null_would_fail_the_test() -> None:
    """The blindness test can fail; it is not a tautology."""
    outcome = check(
        lambda target, n: n - 3,
        9,
        test_id="synthetic",
        computation_id="SYNTHETIC",
    )
    assert not outcome.passed


def test_a_negative_backed_by_this_test_is_labelled_negative() -> None:
    outcome = check(
        exact_measure,
        11,
        test_id="tests/test_blindness_inverse.py::test_inverse_map_returns_the_same_null",
        computation_id="M1-BLIND-INV-11",
    )
    finding = negative(
        result=prove(
            metric="d_ub",
            value=511,
            target="target",
            provenance=Provenance(computation_id="M1-DUB-R64"),
            derivation="composition bound",
        ),
        mechanism=Mechanism(
            statement="the round function saturates the degree by round r",
            derivation_id="M1-MECH-001",
            predicted_value="511",
            observed_value="511",
            agrees=True,
        ),
        blindness_statement=BLINDNESS_STATEMENT,
        blindness_test=outcome,
    )
    assert finding.status is Status.NEGATIVE


def test_the_same_negative_without_the_test_is_incomplete() -> None:
    finding = negative(
        result=prove(
            metric="d_ub",
            value=511,
            target="target",
            provenance=Provenance(computation_id="M1-DUB-R64"),
            derivation="composition bound",
        ),
        mechanism=Mechanism(
            statement="the round function saturates the degree by round r",
            derivation_id="M1-MECH-001",
            predicted_value="511",
            observed_value="511",
            agrees=True,
        ),
        blindness_statement=BLINDNESS_STATEMENT,
        blindness_test=None,
    )
    assert finding.status is Status.INCOMPLETE


def test_the_blindness_statement_names_a_concrete_class_and_its_cost() -> None:
    assert "GF(2^n)" in BLINDNESS_STATEMENT
    assert "x*y = 1" in BLINDNESS_STATEMENT
    assert "one field inversion" in BLINDNESS_STATEMENT
