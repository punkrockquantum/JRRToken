"""The promotion gate: four criteria, all four, or it stays in the log.

Section 7. The gate is defined here, in code, and instantiated with concrete
numbers by each module's pre-registration before any results exist.

  1. THRESHOLD               -- pre-registered metric and number, derivation stated
  2. INDEPENDENT VERIFICATION -- re-derived through verify/, which shares no code
  3. COST COMPARISON          -- against generic bounds INCLUDING memory access,
                                with brute force always among the baselines
  4. FALSIFICATION TEST       -- what would make this an artefact, and the result

Nothing here decides what a number means. The gate decides only whether a
candidate is allowed to appear in a report at all.
"""

from __future__ import annotations

import enum
import math
from dataclasses import dataclass, field

from tiers.errors import ProbeError
from tiers.result import Result
from tiers.tier import Tier


class Direction(enum.Enum):
    GREATER_IS_BETTER = ">"
    LESS_IS_BETTER = "<"


@dataclass(frozen=True, slots=True)
class ThresholdCheck:
    metric: str
    value: float
    threshold: float
    direction: Direction
    derivation: str  # power analysis, generic bound, or published value

    def __post_init__(self) -> None:
        if not self.derivation.strip():
            raise ProbeError(
                "a threshold without a stated derivation is a threshold chosen because "
                "it felt right (prime directive 2.2)"
            )

    @property
    def margin(self) -> float:
        if self.direction is Direction.GREATER_IS_BETTER:
            return self.value - self.threshold
        return self.threshold - self.value

    @property
    def passed(self) -> bool:
        return self.margin > 0.0

    def render(self) -> str:
        return (
            f"criterion=threshold metric={self.metric} value={self.value:.6g} "
            f"direction={self.direction.value} threshold={self.threshold:.6g} "
            f"margin={self.margin:.6g} passed={self.passed} derivation={self.derivation}"
        )


@dataclass(frozen=True, slots=True)
class VerificationCheck:
    """Re-derivation through an independently implemented path in verify/."""

    verifier_id: str  # dotted path, must live under verify/
    discovering_module: str
    observed_by_module: str
    observed_by_verifier: str
    shares_no_code_assertion: str  # the CI check id that enforces independence

    def __post_init__(self) -> None:
        if not self.verifier_id.startswith("verify."):
            raise ProbeError(
                f"verifier {self.verifier_id!r} must live in verify/: a verifier inside "
                "the discovering module can become circular (section 7.2)"
            )

    @property
    def passed(self) -> bool:
        return self.observed_by_module == self.observed_by_verifier

    def render(self) -> str:
        return (
            f"criterion=independent_verification verifier={self.verifier_id} "
            f"module_value={self.observed_by_module} verifier_value={self.observed_by_verifier} "
            f"agrees={self.passed} independence_check={self.shares_no_code_assertion}"
        )


@dataclass(frozen=True, slots=True)
class CostRow:
    """One approach, costed in the same units as every other row."""

    approach: str
    operations: float  # primitive evaluations
    memory_bytes: float
    memory_accesses: float
    unit: str

    def effective_log2(self, access_cost_in_ops: float) -> float:
        total = self.operations + self.memory_accesses * access_cost_in_ops
        if total <= 0.0:
            raise ProbeError(f"{self.approach}: effective cost must be positive")
        return math.log2(total)

    def render(self, access_cost_in_ops: float) -> str:
        return (
            f"approach={self.approach} log2_ops={math.log2(self.operations):.4g} "
            f"log2_mem_bytes={math.log2(self.memory_bytes) if self.memory_bytes > 0 else float('-inf'):.4g} "
            f"log2_mem_accesses={math.log2(self.memory_accesses) if self.memory_accesses > 0 else float('-inf'):.4g} "
            f"log2_effective={self.effective_log2(access_cost_in_ops):.4g} unit={self.unit}"
        )


@dataclass(frozen=True, slots=True)
class CostComparison:
    candidate: CostRow
    baselines: tuple[CostRow, ...]
    access_cost_in_ops: float
    access_cost_derivation: str

    def __post_init__(self) -> None:
        if not self.access_cost_derivation.strip():
            raise ProbeError(
                "the memory-access cost ratio must state its derivation; a naive "
                "operation count overstates attack advantage (section 7.3)"
            )
        names = {b.approach.lower() for b in self.baselines}
        if not any("brute" in n for n in names):
            raise ProbeError(
                "brute force is always one of the baselines (section 7.3, finding C)"
            )
        units = {self.candidate.unit, *(b.unit for b in self.baselines)}
        if len(units) != 1:
            raise ProbeError(f"cost rows must share one unit; got {sorted(units)}")

    @property
    def best_baseline(self) -> CostRow:
        return min(self.baselines, key=lambda b: b.effective_log2(self.access_cost_in_ops))

    @property
    def advantage_log2(self) -> float:
        return self.best_baseline.effective_log2(
            self.access_cost_in_ops
        ) - self.candidate.effective_log2(self.access_cost_in_ops)

    @property
    def passed(self) -> bool:
        return self.advantage_log2 > 0.0

    def render(self) -> str:
        lines = [
            f"criterion=cost_comparison access_cost_in_ops={self.access_cost_in_ops:.6g} "
            f"advantage_log2={self.advantage_log2:.4g} passed={self.passed} "
            f"access_cost_derivation={self.access_cost_derivation}",
            "  candidate " + self.candidate.render(self.access_cost_in_ops),
        ]
        lines += [
            "  baseline  " + b.render(self.access_cost_in_ops)
            for b in sorted(
                self.baselines, key=lambda b: b.effective_log2(self.access_cost_in_ops)
            )
        ]
        return "\n".join(lines)


@dataclass(frozen=True, slots=True)
class FalsificationCheck:
    test_id: str
    #: What would have to be true for this to be an encoding bug, a calibration
    #: failure, or a search artefact rather than a finding.
    artefact_hypotheses: tuple[str, ...]
    ran: bool
    survived: bool
    observed: str

    def __post_init__(self) -> None:
        if not self.artefact_hypotheses:
            raise ProbeError(
                "a falsification test must name the artefact hypotheses it rules out "
                "(section 7.4)"
            )

    @property
    def passed(self) -> bool:
        return self.ran and self.survived

    def render(self) -> str:
        return (
            f"criterion=falsification test={self.test_id} ran={self.ran} "
            f"survived={self.survived} observed={self.observed} "
            f"artefact_hypotheses={list(self.artefact_hypotheses)}"
        )


@dataclass(frozen=True, slots=True)
class PromotionDecision:
    candidate_id: str
    result: Result
    threshold: ThresholdCheck
    verification: VerificationCheck
    cost: CostComparison
    falsification: FalsificationCheck
    scope_statement: str
    commit: str
    extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.scope_statement.strip():
            raise ProbeError("a promoted candidate must carry a scope statement (section 7)")
        if not self.commit.strip():
            raise ProbeError("a promoted candidate must carry the commit id that produced it")

    @property
    def criteria(self) -> tuple[tuple[str, bool], ...]:
        return (
            ("threshold", self.threshold.passed),
            ("independent_verification", self.verification.passed),
            ("cost_comparison", self.cost.passed),
            ("falsification", self.falsification.passed),
        )

    @property
    def promoted(self) -> bool:
        return all(passed for _, passed in self.criteria)

    @property
    def failed_criteria(self) -> tuple[str, ...]:
        return tuple(name for name, passed in self.criteria if not passed)

    def render(self) -> str:
        """Report format for a promoted candidate (section 7). No prose."""
        lines = [
            f"candidate={self.candidate_id} promoted={self.promoted} "
            f"failed_criteria={list(self.failed_criteria)}",
            f"  tier={self.result.tier.value} {self.result.render()}",
            "  " + self.threshold.render(),
            "  " + self.verification.render(),
        ]
        lines += ["  " + line for line in self.cost.render().splitlines()]
        lines += [
            "  " + self.falsification.render(),
            f"  scope={self.scope_statement}",
            f"  commit={self.commit}",
        ]
        if self.result.tier is Tier.E and self.result.space is not None:
            lines.append(f"  {self.result.space.render()}")
        return "\n".join(lines)
