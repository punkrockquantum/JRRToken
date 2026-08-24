"""Registration for Module 4."""

from __future__ import annotations

from typing import Any

from harness.registry import REGISTRY, ModuleSpec
from tiers.tier import Tier

from .calibration.suite import MODULE_ID, SUITE
from .measure import implied_order

PREREG_PATH = "modules/hod/prereg/PREREG-M4.md"


def measure(target: Any, case: Any) -> int:
    """Dispatch for the calibration suite: the implied vanishing order."""
    from modules.degree.measure import exact_degree

    if case.quantity != "implied_order":
        raise ValueError(f"no measurement path for quantity {case.quantity!r}")
    degree = exact_degree(target)
    return implied_order(degree, target.n_in, round_index=0).order


SPEC = ModuleSpec(
    module_id=MODULE_ID,
    title="Higher-order differentials and integral distinguishers",
    declared_tiers=frozenset({Tier.P, Tier.E}),
    prereg_path=PREREG_PATH,
    runner_path="harness/runner.py",
    suite=SUITE,
    measure=measure,
    targets=("mimc-gf2n", "iterated-power-map-gf2n", "power-map-gf2n", "inverse-map-gf2n"),
)

REGISTRY.register(SPEC)
