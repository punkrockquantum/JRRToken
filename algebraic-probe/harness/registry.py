"""Module registration and the regime router.

Section 3.1: "a module declares its tier at registration time and the harness
refuses to run it under the wrong regime."

The router is the only way to obtain an execution handle for a module, so the
tier/regime pairing cannot be bypassed by calling the module directly through
the harness.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from tiers.errors import CalibrationBlocked, ProbeError, RegimeViolation
from tiers.tier import TIER_REGIME, Regime, Tier

from .calibration import CalibrationSuite


@dataclass(frozen=True, slots=True)
class ModuleSpec:
    module_id: str
    title: str
    declared_tiers: frozenset[Tier]
    prereg_path: str
    runner_path: str
    suite: CalibrationSuite
    #: The measurement implementation. ``None`` until the module is built.
    measure: Callable[..., Any] | None = None
    targets: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not self.declared_tiers:
            raise ProbeError(f"{self.module_id}: a module must declare at least one tier")
        if self.suite.module_id != self.module_id:
            raise CalibrationBlocked(
                f"calibration suite belongs to {self.suite.module_id}, not {self.module_id}"
            )

    def allowed_regimes(self) -> frozenset[Regime]:
        return frozenset(TIER_REGIME[t] for t in self.declared_tiers)

    def render(self) -> str:
        return (
            f"module={self.module_id} tiers={sorted(t.value for t in self.declared_tiers)} "
            f"regimes={sorted(r.value for r in self.allowed_regimes())} "
            f"prereg={self.prereg_path} runner={self.runner_path} "
            f"measure_implemented={self.measure is not None} "
            f"targets={list(self.targets)}"
        )


class Registry:
    def __init__(self) -> None:
        self._specs: dict[str, ModuleSpec] = {}

    def register(self, spec: ModuleSpec) -> ModuleSpec:
        if spec.module_id in self._specs and self._specs[spec.module_id] is not spec:
            raise ProbeError(f"module {spec.module_id!r} is already registered")
        self._specs[spec.module_id] = spec
        return spec

    def get(self, module_id: str) -> ModuleSpec:
        try:
            return self._specs[module_id]
        except KeyError:
            raise ProbeError(f"no module registered under {module_id!r}") from None

    def ids(self) -> tuple[str, ...]:
        return tuple(sorted(self._specs))

    def route(self, module_id: str, *, tier: Tier, regime: Regime) -> ModuleSpec:
        """Return the module spec, or refuse the tier/regime pairing."""
        spec = self.get(module_id)
        if tier not in spec.declared_tiers:
            raise RegimeViolation(
                f"{module_id} declared tiers "
                f"{sorted(t.value for t in spec.declared_tiers)}; Tier {tier.value} was requested"
            )
        expected = TIER_REGIME[tier]
        if regime is not expected:
            raise RegimeViolation(
                f"Tier {tier.value} runs under the {expected.value} regime, not "
                f"{regime.value}. "
                + (
                    "Repetition adds nothing to a Tier P result (section 3)."
                    if tier is Tier.P
                    else "Routing a module to the wrong regime is refused (section 3.1)."
                )
            )
        return spec


REGISTRY = Registry()
