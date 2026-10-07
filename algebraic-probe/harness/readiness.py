"""Execution readiness: per-module gates, and a decision computed from them.

A go/no-go is a judgement, and prime directive 2.2 keeps judgement out of the
output path. So the decision here is not written down anywhere -- it is derived
from a fixed set of gates, each of which is a check against the repository that
returns the same answer on every run.

The decision rule is stated below and is fixed before any gate is evaluated:

    GO for a module iff every blocking gate passes.

There is no partial credit and no weighting, because a weighting would be a
judgement about which of the brief's requirements matter more. Section 5 makes
calibration a hard block; section 6 makes an unproven null incomplete; section 7
makes promotion conditional on all four criteria. The gates below encode those
as they are written.

Every failing gate is classified by what would clear it:

    OPERATOR    -- needs a decision or an input only the operator can supply
    BUILD       -- needs code that has not been written
    DEPENDENCY  -- needs another module to reach GO first

That classification is derivable, not a preference: it follows from which gate
failed, and it is what separates "blocked on a person" from "blocked on work".
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Callable

DECISION_RULE = (
    "GO iff every blocking gate passes; any failing blocking gate yields NO-GO. "
    "Fixed before evaluation, no weighting, no partial credit."
)


class BlockClass(enum.Enum):
    NONE = "none"
    OPERATOR = "operator"
    BUILD = "build"
    DEPENDENCY = "dependency"


class Decision(enum.Enum):
    GO = "GO"
    #: Module-level gates pass and some targets are clear while others are not.
    #: A monolithic verdict would block a validated target because an unrelated
    #: one is missing, which is the opposite of acting on the gate evidence.
    PARTIAL = "PARTIAL"
    NO_GO = "NO-GO"


@dataclass(frozen=True, slots=True)
class Gate:
    """One precondition, and the check that decides it."""

    gate_id: str
    name: str
    #: The clause of the brief this gate encodes.
    requirement: str
    block_class: BlockClass
    check: Callable[[], tuple[bool, str]]
    #: A non-blocking gate is reported but does not affect the decision.
    blocking: bool = True

    def evaluate(self) -> "GateOutcome":
        try:
            passed, detail = self.check()
        except Exception as exc:  # a check that cannot run has not passed
            passed, detail = False, f"check raised {type(exc).__name__}: {exc}"
        return GateOutcome(
            gate_id=self.gate_id,
            name=self.name,
            requirement=self.requirement,
            block_class=self.block_class if not passed else BlockClass.NONE,
            blocking=self.blocking,
            passed=passed,
            detail=detail,
        )


@dataclass(frozen=True, slots=True)
class GateOutcome:
    gate_id: str
    name: str
    requirement: str
    block_class: BlockClass
    blocking: bool
    passed: bool
    detail: str

    def render(self) -> str:
        return (
            f"gate={self.gate_id} name={self.name} passed={self.passed} "
            f"blocking={self.blocking} block_class={self.block_class.value} "
            f"detail={self.detail}"
        )


@dataclass(frozen=True, slots=True)
class TargetReadiness:
    """Whether one module may run against one target."""

    target_id: str
    outcomes: tuple[GateOutcome, ...] = field(default_factory=tuple)

    @property
    def blocking_failures(self) -> tuple[GateOutcome, ...]:
        return tuple(o for o in self.outcomes if o.blocking and not o.passed)

    @property
    def decision(self) -> Decision:
        return Decision.NO_GO if self.blocking_failures else Decision.GO

    def render(self) -> str:
        blocking = [f"{o.gate_id}:{o.name}" for o in self.blocking_failures]
        line = f"  target={self.target_id} decision={self.decision.value} blocking={blocking}"
        for outcome in self.outcomes:
            if not outcome.passed:
                line += f"\n      {outcome.render()}"
        return line


@dataclass(frozen=True, slots=True)
class ModuleReadiness:
    module_id: str
    title: str
    quantity: str
    declared_tiers: str
    depends_on: tuple[str, ...]
    outcomes: tuple[GateOutcome, ...] = field(default_factory=tuple)
    targets: tuple[TargetReadiness, ...] = field(default_factory=tuple)

    @property
    def blocking_failures(self) -> tuple[GateOutcome, ...]:
        return tuple(o for o in self.outcomes if o.blocking and not o.passed)

    @property
    def targets_go(self) -> tuple[TargetReadiness, ...]:
        return tuple(t for t in self.targets if t.decision is Decision.GO)

    @property
    def decision(self) -> Decision:
        """Module-level gates first, then how many targets are clear.

        A module whose own machinery is incomplete is NO-GO whatever its
        targets look like. A module whose machinery is sound is GO on the
        targets that clear and NO-GO on those that do not; PARTIAL names that
        state rather than collapsing it to the worse of the two.
        """
        if self.blocking_failures:
            return Decision.NO_GO
        if not self.targets:
            return Decision.GO
        clear = len(self.targets_go)
        if clear == 0:
            return Decision.NO_GO
        return Decision.GO if clear == len(self.targets) else Decision.PARTIAL

    @property
    def n_passed(self) -> int:
        return sum(1 for o in self.outcomes if o.passed)

    @property
    def block_classes(self) -> tuple[str, ...]:
        return tuple(
            sorted({o.block_class.value for o in self.blocking_failures})
        )

    @property
    def shortest_path_to_go(self) -> tuple[str, ...]:
        return tuple(f"{o.gate_id}:{o.name}" for o in self.blocking_failures)

    def render(self) -> str:
        lines = [
            f"module={self.module_id} decision={self.decision.value} "
            f"gates_passed={self.n_passed}/{len(self.outcomes)} "
            f"blocking_failures={len(self.blocking_failures)} "
            f"targets_go={len(self.targets_go)}/{len(self.targets)} "
            f"block_classes={list(self.block_classes)} "
            f"depends_on={list(self.depends_on)}",
            f"  title={self.title}",
            f"  quantity={self.quantity}",
            f"  declared_tiers={self.declared_tiers}",
        ]
        lines += [f"  {o.render()}" for o in self.outcomes]
        lines.append(f"  path_to_go={list(self.shortest_path_to_go)}")
        lines += [t.render() for t in self.targets]
        return "\n".join(lines)


@dataclass(frozen=True, slots=True)
class ReadinessReport:
    commit: str
    modules: tuple[ModuleReadiness, ...]

    @property
    def go(self) -> tuple[str, ...]:
        return tuple(m.module_id for m in self.modules if m.decision is Decision.GO)

    @property
    def partial(self) -> tuple[str, ...]:
        return tuple(m.module_id for m in self.modules if m.decision is Decision.PARTIAL)

    @property
    def no_go(self) -> tuple[str, ...]:
        return tuple(m.module_id for m in self.modules if m.decision is Decision.NO_GO)

    @property
    def authorised_runs(self) -> tuple[tuple[str, str], ...]:
        """Every (module, target) pair the gates authorise. This is the list the
        operator acts on, and the tool acts on it too."""
        return tuple(
            (m.module_id, t.target_id)
            for m in self.modules
            if m.decision is not Decision.NO_GO
            for t in self.targets_of(m)
        )

    @staticmethod
    def targets_of(module: ModuleReadiness) -> tuple[TargetReadiness, ...]:
        return module.targets_go

    def root_causes(self) -> tuple[tuple[str, int], ...]:
        """Blocking gates ordered by how many modules they block.

        A gate that blocks every module is a single point of failure, and that
        is a fact about the dependency structure rather than an opinion about
        priority.
        """
        counts: dict[str, int] = {}
        for module in self.modules:
            for outcome in module.blocking_failures:
                key = f"{outcome.gate_id}:{outcome.name}"
                counts[key] = counts.get(key, 0) + 1
        return tuple(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))

    def render(self) -> str:
        lines = [
            f"commit={self.commit}",
            f"decision_rule={DECISION_RULE}",
            f"modules={len(self.modules)} go={list(self.go)} partial={list(self.partial)} "
            f"no_go={list(self.no_go)}",
            f"authorised_runs={[f'{m}:{t}' for m, t in self.authorised_runs]}",
            "",
        ]
        for module in self.modules:
            lines.append(module.render())
            lines.append("")
        lines.append("root_causes_by_modules_blocked:")
        for key, count in self.root_causes():
            lines.append(f"  gate={key} modules_blocked={count}/{len(self.modules)}")
        return "\n".join(lines) + "\n"


def evaluate(
    module_id: str,
    title: str,
    quantity: str,
    declared_tiers: str,
    depends_on: tuple[str, ...],
    gates: tuple[Gate, ...],
    target_gates: dict[str, tuple[Gate, ...]] | None = None,
) -> ModuleReadiness:
    return ModuleReadiness(
        module_id=module_id,
        title=title,
        quantity=quantity,
        declared_tiers=declared_tiers,
        depends_on=depends_on,
        outcomes=tuple(gate.evaluate() for gate in gates),
        targets=tuple(
            TargetReadiness(
                target_id=target_id,
                outcomes=tuple(gate.evaluate() for gate in target_gate_list),
            )
            for target_id, target_gate_list in (target_gates or {}).items()
        ),
    )
