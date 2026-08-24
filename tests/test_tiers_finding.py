"""Section 6: a null result is not a result until mechanism, blindness statement
and a passing blindness test are all present."""

from __future__ import annotations

from tiers import BlindnessTest, Mechanism, Provenance, Status, negative, positive, prove

PROV = Provenance(computation_id="TEST-002")


def a_result():
    return prove(
        metric="d_ub", value=511, target="t", provenance=PROV, derivation="composition bound"
    )


def a_mechanism(agrees: bool = True) -> Mechanism:
    return Mechanism(
        statement="chi has degree 2 and every other step is linear, so r rounds have degree <= 2^r",
        derivation_id="M1-MECH-001",
        predicted_value="511",
        observed_value="511",
        agrees=agrees,
    )


def a_blindness_test(passed: bool = True) -> BlindnessTest:
    return BlindnessTest(
        test_id="tests/test_blindness_inverse.py::test_inverse_map_returns_the_same_null",
        function_class="x -> x^(-1) over GF(2^n)",
        passed=passed,
        computation_id="M1-BLIND-001",
        observed="algebraic_degree=10 saturated_maximum=10",
    )


def test_complete_negative_is_labelled_negative() -> None:
    finding = negative(
        result=a_result(),
        mechanism=a_mechanism(),
        blindness_statement="the inverse map has maximal degree and is solved by one inversion",
        blindness_test=a_blindness_test(),
    )
    assert finding.status is Status.NEGATIVE
    assert finding.downgrade_reasons == ()


def test_missing_mechanism_downgrades_to_incomplete() -> None:
    finding = negative(
        result=a_result(),
        mechanism=None,
        blindness_statement="statement",
        blindness_test=a_blindness_test(),
    )
    assert finding.status is Status.INCOMPLETE
    assert any("mechanism" in r for r in finding.downgrade_reasons)


def test_missing_blindness_statement_downgrades() -> None:
    finding = negative(
        result=a_result(),
        mechanism=a_mechanism(),
        blindness_statement="",
        blindness_test=a_blindness_test(),
    )
    assert finding.status is Status.INCOMPLETE
    assert any("blindness statement" in r for r in finding.downgrade_reasons)


def test_missing_blindness_test_downgrades() -> None:
    finding = negative(
        result=a_result(),
        mechanism=a_mechanism(),
        blindness_statement="statement",
        blindness_test=None,
    )
    assert finding.status is Status.INCOMPLETE
    assert any("blindness test" in r for r in finding.downgrade_reasons)


def test_failing_blindness_test_downgrades() -> None:
    finding = negative(
        result=a_result(),
        mechanism=a_mechanism(),
        blindness_statement="statement",
        blindness_test=a_blindness_test(passed=False),
    )
    assert finding.status is Status.INCOMPLETE
    assert any("did not reproduce the null" in r for r in finding.downgrade_reasons)


def test_structural_disagreement_downgrades() -> None:
    finding = negative(
        result=a_result(),
        mechanism=a_mechanism(agrees=False),
        blindness_statement="statement",
        blindness_test=a_blindness_test(),
    )
    assert finding.status is Status.INCOMPLETE
    assert any("disagrees" in r for r in finding.downgrade_reasons)


def test_positive_findings_need_no_blindness_machinery() -> None:
    assert positive(a_result()).status is Status.POSITIVE


def test_finding_render_lists_every_downgrade_reason() -> None:
    finding = negative(
        result=a_result(), mechanism=None, blindness_statement="", blindness_test=None
    )
    rendered = finding.render()
    assert rendered.count("downgraded_because=") == 3
    assert "status=INCOMPLETE" in rendered
