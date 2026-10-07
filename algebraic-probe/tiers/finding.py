"""Findings, and the rule that a null result is not a result on its own.

Section 6. Every negative result must emit:
  (a) THE MECHANISM      -- derived from the round structure, not the statistic
  (b) A BLINDNESS STATEMENT -- a concrete function class with the property that
                            would still produce this null under this measurement
  (c) A PASSING BLINDNESS TEST -- that class implemented and run

A negative result without a passing blindness test is logged as INCOMPLETE.
This module refuses to produce a NEGATIVE without all three; it downgrades
rather than raising, so the incomplete result is still recorded in the log.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field

from .result import Result


class Status(enum.Enum):
    POSITIVE = "POSITIVE"
    NEGATIVE = "NEGATIVE"
    INCOMPLETE = "INCOMPLETE"


@dataclass(frozen=True, slots=True)
class BlindnessTest:
    """A counterexample class implemented and run, with its outcome."""

    test_id: str  # e.g. "modules.degree.blindness.inverse_map::test_null_is_reproduced"
    function_class: str  # the concrete class, named
    passed: bool  # did the measure return the SAME null on it?
    computation_id: str
    observed: str  # what the measure returned on the counterexample class

    def render(self) -> str:
        return (
            f"blindness_test={self.test_id} class={self.function_class} "
            f"passed={self.passed} observed={self.observed} computation={self.computation_id}"
        )


@dataclass(frozen=True, slots=True)
class Mechanism:
    """What in the round structure produces this value."""

    statement: str  # structural, derived from round function / message schedule
    derivation_id: str  # the computation or proof that derives it
    predicted_value: str  # what the structure says the number should be
    observed_value: str  # what the aggregate measurement actually produced
    agrees: bool  # section 6 corollary: flag disagreement, never paper over it

    def render(self) -> str:
        return (
            f"mechanism={self.statement} derivation={self.derivation_id} "
            f"predicted={self.predicted_value} observed={self.observed_value} "
            f"structure_agrees={self.agrees}"
        )


@dataclass(frozen=True, slots=True)
class Finding:
    """A result plus its epistemic status. Constructed only via the factories."""

    result: Result
    status: Status
    mechanism: Mechanism | None = None
    blindness_statement: str = ""
    blindness_test: BlindnessTest | None = None
    downgrade_reasons: tuple[str, ...] = field(default_factory=tuple)

    def render(self) -> str:
        lines = [f"status={self.status.value} {self.result.render()}"]
        if self.mechanism is not None:
            lines.append(f"  {self.mechanism.render()}")
        if self.blindness_statement:
            lines.append(f"  blindness_statement={self.blindness_statement}")
        if self.blindness_test is not None:
            lines.append(f"  {self.blindness_test.render()}")
        for reason in self.downgrade_reasons:
            lines.append(f"  downgraded_because={reason}")
        return "\n".join(lines)

    def to_dict(self) -> dict:
        return {
            "status": self.status.value,
            "result": self.result.to_dict(),
            "mechanism": None
            if self.mechanism is None
            else {
                "statement": self.mechanism.statement,
                "derivation_id": self.mechanism.derivation_id,
                "predicted_value": self.mechanism.predicted_value,
                "observed_value": self.mechanism.observed_value,
                "agrees": self.mechanism.agrees,
            },
            "blindness_statement": self.blindness_statement,
            "blindness_test": None
            if self.blindness_test is None
            else {
                "test_id": self.blindness_test.test_id,
                "function_class": self.blindness_test.function_class,
                "passed": self.blindness_test.passed,
                "computation_id": self.blindness_test.computation_id,
                "observed": self.blindness_test.observed,
            },
            "downgrade_reasons": list(self.downgrade_reasons),
        }


def positive(result: Result) -> Finding:
    return Finding(result=result, status=Status.POSITIVE)


def negative(
    *,
    result: Result,
    mechanism: Mechanism | None,
    blindness_statement: str,
    blindness_test: BlindnessTest | None,
) -> Finding:
    """Return a NEGATIVE finding, or an INCOMPLETE one naming what is missing.

    Section 6 is enforced here and nowhere else, so there is exactly one place
    to audit.
    """
    reasons: list[str] = []
    if mechanism is None or not mechanism.statement.strip():
        reasons.append("no mechanism stated (section 6a)")
    if not blindness_statement.strip():
        reasons.append("no blindness statement (section 6b)")
    if blindness_test is None:
        reasons.append("no blindness test implemented (section 6c)")
    elif not blindness_test.passed:
        reasons.append(
            f"blindness test {blindness_test.test_id} did not reproduce the null (section 6c)"
        )
    if mechanism is not None and not mechanism.agrees:
        reasons.append(
            "structural prediction disagrees with the aggregate measurement "
            "(section 6 corollary)"
        )
    if reasons:
        return Finding(
            result=result,
            status=Status.INCOMPLETE,
            mechanism=mechanism,
            blindness_statement=blindness_statement,
            blindness_test=blindness_test,
            downgrade_reasons=tuple(reasons),
        )
    return Finding(
        result=result,
        status=Status.NEGATIVE,
        mechanism=mechanism,
        blindness_statement=blindness_statement,
        blindness_test=blindness_test,
    )
