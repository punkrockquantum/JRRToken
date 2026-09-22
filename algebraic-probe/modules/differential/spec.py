"""Registration for Module 3."""

from __future__ import annotations

from harness.registry import REGISTRY, ModuleSpec
from tiers.tier import Tier

from .calibration.suite import MODULE_ID, SUITE
from .measure import measure

PREREG_PATH = "modules/differential/prereg/PREREG-M3.md"

SPEC = ModuleSpec(
    module_id=MODULE_ID,
    title="Differential characteristic search",
    # Tier E for counted probabilities, Tier S for sampled ones. Section 9
    # declares both; no deductive path exists here, because a differential
    # probability is a count over inputs and not a theorem about the target.
    declared_tiers=frozenset({Tier.E, Tier.S}),
    prereg_path=PREREG_PATH,
    runner_path="harness/runner.py",
    suite=SUITE,
    measure=measure,
    targets=("sha256-compression-parametrised",),
)

REGISTRY.register(SPEC)
