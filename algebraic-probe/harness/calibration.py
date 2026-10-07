"""Calibration framework: no module is trusted until it reproduces ground truth.

Section 5. A calibration suite is declarative: every case states the target, the
quantity, the expected value, where the expected value comes from, and the exact
assertion it will make. ``CalibrationSuite.manifest()`` renders all of that
*without running anything*, which is what the first deliverable asks for.

Two gates sit in front of execution:

  GATE 1 (citation verification). A case whose expected value comes from the
  literature is inert until that value has been checked against the primary
  source. An UNVERIFIED citation blocks the module. Hard block, not a warning.

  GATE 2 (calibration outcome). Every case must pass before the module is
  permitted to run on anything new.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Any, Callable

from tiers.errors import CalibrationBlocked, NotAuthorised
from tiers.provenance import CitationIndex, Provenance, Verification


class _PendingPrimarySource:
    """Sentinel for an expected value that must be transcribed from the source.

    A calibration case may be fully declared -- target, quantity, comparator,
    assertion form -- before its expected value has been read out of the primary
    source. Writing a plausible number in the meantime is exactly the failure
    prime directive 2.1 forbids, so the value is this sentinel and the case
    blocks its module until the number is transcribed.
    """

    __slots__ = ()

    def __repr__(self) -> str:
        return "PENDING_PRIMARY_SOURCE"

    def __eq__(self, other: object) -> bool:
        return isinstance(other, _PendingPrimarySource)

    def __hash__(self) -> int:
        return hash("PENDING_PRIMARY_SOURCE")


PENDING_PRIMARY_SOURCE = _PendingPrimarySource()


class CaseKind(enum.Enum):
    PUBLISHED_GROUND_TRUTH = "published-ground-truth"
    #: The exact value, computed in this repository over the target's complete
    #: input space. Tier E: nothing is sampled, so the number is not an estimate.
    #:
    #: This kind does NOT satisfy section 5's published-anchor requirement and is
    #: deliberately not accepted in place of PUBLISHED_GROUND_TRUTH anywhere in
    #: this file. The two answer different questions. A published anchor asks
    #: whether this repository agrees with an independent party; an exhaustive
    #: computation asks whether the instrument agrees with the truth about the
    #: function *as this repository implements it*. The second cannot detect an
    #: error shared by the instrument and the target implementation, which is
    #: exactly the failure the first exists to catch.
    #:
    #: It is still a hard, falsifiable check -- a bound that exceeds the exact
    #: degree is unsound and fails here -- so these cases run, and they run under
    #: ``run_controls`` without lifting any gate. Whether the gate should ever
    #: recognise one as an anchor substitute is ESCALATIONS.md E-09.
    EXHAUSTIVE_GROUND_TRUTH = "exhaustive-ground-truth"
    POSITIVE_CONTROL = "positive-control"
    NEGATIVE_CONTROL = "negative-control"
    INTERMEDIATE_CONTROL = "intermediate-control"
    BLINDNESS = "blindness"


class Comparator(enum.Enum):
    EQUAL = "=="
    AT_MOST = "<="
    AT_LEAST = ">="
    IN_SET = "in"

    def holds(self, observed: Any, expected: Any) -> bool:
        if self is Comparator.EQUAL:
            return observed == expected
        if self is Comparator.AT_MOST:
            return observed <= expected
        if self is Comparator.AT_LEAST:
            return observed >= expected
        return observed in expected


@dataclass(frozen=True, slots=True)
class CalibrationCase:
    case_id: str
    kind: CaseKind
    target_id: str
    target_factory: Callable[[], Any]
    quantity: str
    comparator: Comparator
    expected: Any
    expectation_provenance: Provenance
    #: The exact assertion, in words, that this case will make. Printed by the
    #: manifest before anything runs.
    assertion: str
    #: Why this case is in the suite -- what failure it would catch.
    rationale: str
    parameters: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for name in ("case_id", "target_id", "quantity", "assertion", "rationale"):
            if not str(getattr(self, name)).strip():
                raise CalibrationBlocked(f"CalibrationCase.{name} must be non-empty")

    def manifest_line(self) -> str:
        params = " ".join(f"{k}={v}" for k, v in sorted(self.parameters.items()))
        return (
            f"case={self.case_id} kind={self.kind.value} target={self.target_id} "
            f"quantity={self.quantity} asserts={self.quantity} {self.comparator.value} "
            f"{self.expected} {params} provenance={self.expectation_provenance.render()}"
        ).rstrip()


@dataclass(frozen=True, slots=True)
class CaseOutcome:
    case_id: str
    observed: Any
    expected: Any
    comparator: Comparator
    passed: bool
    detail: str = ""

    def render(self) -> str:
        return (
            f"case={self.case_id} observed={self.observed} "
            f"{self.comparator.value} expected={self.expected} passed={self.passed}"
            + (f" detail={self.detail}" if self.detail else "")
        )


@dataclass(frozen=True, slots=True)
class GateStatus:
    module_id: str
    blocked: bool
    blocking_citations: tuple[str, ...]
    blocking_reasons: tuple[str, ...]

    def render(self) -> str:
        return (
            f"module={self.module_id} calibration_blocked={self.blocked} "
            f"blocking_citations={list(self.blocking_citations)} "
            f"blocking_reasons={list(self.blocking_reasons)}"
        )


@dataclass(frozen=True, slots=True)
class CalibrationReport:
    module_id: str
    outcomes: tuple[CaseOutcome, ...]

    @property
    def satisfied(self) -> bool:
        return all(o.passed for o in self.outcomes)

    @property
    def failures(self) -> tuple[CaseOutcome, ...]:
        return tuple(o for o in self.outcomes if not o.passed)

    def render(self) -> str:
        lines = [f"module={self.module_id} calibration_satisfied={self.satisfied}"]
        lines += [f"  {o.render()}" for o in self.outcomes]
        return "\n".join(lines)


@dataclass(frozen=True, slots=True)
class CalibrationSuite:
    module_id: str
    cases: tuple[CalibrationCase, ...]
    citations: CitationIndex
    #: A module for which section 5 names no published anchor may be constructed
    #: without a ground-truth case -- and is then permanently blocked by gate().
    #: This moves the block from construction time to gate time so the module can
    #: ship calibration-blocked with a stated reason. It does not relax the gate.
    allow_missing_ground_truth: bool = False
    missing_ground_truth_reason: str = ""

    def __post_init__(self) -> None:
        ids = [c.case_id for c in self.cases]
        dupes = {i for i in ids if ids.count(i) > 1}
        if dupes:
            raise CalibrationBlocked(f"duplicate calibration case ids: {sorted(dupes)}")
        kinds = {c.kind for c in self.cases}
        required_kinds = [CaseKind.POSITIVE_CONTROL, CaseKind.NEGATIVE_CONTROL]
        if not self.allow_missing_ground_truth:
            required_kinds.insert(0, CaseKind.PUBLISHED_GROUND_TRUTH)
        elif not self.missing_ground_truth_reason.strip():
            raise CalibrationBlocked(
                f"{self.module_id}: a suite without published ground truth must state "
                "why, and the reason is what the gate reports"
            )
        for required in required_kinds:
            if required not in kinds:
                raise CalibrationBlocked(
                    f"{self.module_id}: calibration suite has no {required.value} case "
                    "(section 5 requires one)"
                )
        for case in self.cases:
            key = case.expectation_provenance.citation_key
            if key is not None:
                self.citations.get(key)  # raises on an unknown key

    # -- gate 1: citation verification --------------------------------------

    def gate(self) -> GateStatus:
        reasons: list[str] = []
        blocking: list[str] = []
        if self.allow_missing_ground_truth:
            # Permanently blocked until an anchor is supplied. The suite could be
            # constructed; it cannot be trusted on anything new.
            reasons.append(
                f"module={self.module_id} has no published-ground-truth case: "
                f"{self.missing_ground_truth_reason}"
            )
        for case in self.cases:
            if case.expected is PENDING_PRIMARY_SOURCE:
                reasons.append(
                    f"case={case.case_id} has no expected value: it must be transcribed "
                    "from the primary source before the case can assert anything"
                )
            key = case.expectation_provenance.citation_key
            if key is None:
                continue
            citation = self.citations.get(key)
            if citation.verification is Verification.UNVERIFIED:
                blocking.append(key)
                reasons.append(
                    f"case={case.case_id} depends on citation {key} whose claimed value "
                    f"has not been checked against the primary source "
                    f"({citation.verification_note})"
                )
        return GateStatus(
            module_id=self.module_id,
            blocked=bool(reasons),
            blocking_citations=tuple(sorted(set(blocking))),
            blocking_reasons=tuple(reasons),
        )

    def require_unblocked(self) -> None:
        status = self.gate()
        if status.blocked:
            raise CalibrationBlocked(
                f"{self.module_id} refuses to run: " + "; ".join(status.blocking_reasons)
            )

    # -- manifest: what the suite will assert, before it runs ---------------

    def manifest(self) -> str:
        lines = [f"calibration_suite module={self.module_id} n_cases={len(self.cases)}"]
        for kind in CaseKind:
            for case in self.cases:
                if case.kind is kind:
                    lines.append("  " + case.manifest_line())
                    lines.append(f"    assertion={case.assertion}")
                    lines.append(f"    rationale={case.rationale}")
        lines.append("  citations:")
        for citation in sorted(self.citations.citations, key=lambda c: c.key):
            lines.append("    " + citation.render())
            lines.append(f"      claim={citation.claim}")
            if citation.verification_note:
                lines.append(f"      verification_note={citation.verification_note}")
        status = self.gate()
        lines.append("  " + status.render())
        return "\n".join(lines)

    # -- gate 2: execution ---------------------------------------------------

    def run_controls(
        self, measure: Callable[[Any, CalibrationCase], Any] | None
    ) -> CalibrationReport:
        """Run only the cases whose expected value is established in this
        repository -- the controls, the blindness class, and the exhaustive
        ground truth.

        Section 5 asks two different things of a calibration suite: that the
        instrument measures what it claims (the controls), and that it agrees
        with the literature (the published ground truth). The second is a hard
        block on running against anything new, and this method does not lift it:
        it establishes the first while the second is outstanding, and the gate in
        ``gate()`` is unchanged by whether this passed.

        An EXHAUSTIVE_GROUND_TRUTH case runs here for the same reason a control
        does -- its expected value came from a computation in this repository, so
        no citation gates it -- and for the same reason it does not lift the
        block: agreeing with a number I computed is not agreeing with the
        literature.
        """
        cases = tuple(c for c in self.cases if c.kind is not CaseKind.PUBLISHED_GROUND_TRUTH)
        return self._execute(cases, measure, label=f"{self.module_id}::controls")

    def run(self, measure: Callable[[Any, CalibrationCase], Any] | None) -> CalibrationReport:
        self.require_unblocked()
        return self._execute(self.cases, measure, label=self.module_id)

    def _execute(
        self,
        cases: tuple[CalibrationCase, ...],
        measure: Callable[[Any, CalibrationCase], Any] | None,
        *,
        label: str,
    ) -> CalibrationReport:
        if measure is None:
            raise NotAuthorised(
                f"{label}: no measurement implementation is registered. "
                "The calibration suite is defined and can be inspected with "
                "manifest(), but the module's measurement path does not exist yet."
            )
        outcomes = []
        for case in cases:
            target = case.target_factory()
            try:
                observed: Any = measure(target, case)
                passed = bool(case.comparator.holds(observed, case.expected))
                detail = ""
            except Exception as exc:
                observed = f"{type(exc).__name__}"
                passed = False
                detail = str(exc)[:160]
            outcomes.append(
                CaseOutcome(
                    case_id=case.case_id,
                    observed=observed,
                    expected=case.expected,
                    comparator=case.comparator,
                    passed=passed,
                    detail=detail,
                )
            )
        return CalibrationReport(module_id=label, outcomes=tuple(outcomes))
