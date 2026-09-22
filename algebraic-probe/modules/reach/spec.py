"""Registration for Module 2."""

from __future__ import annotations

from harness.registry import REGISTRY, ModuleSpec
from tiers.tier import Tier

from .calibration.suite import MODULE_ID, SUITE
from .measure import measure

PREREG_PATH = "modules/reach/prereg/PREREG-M2.md"

SPEC = ModuleSpec(
    module_id=MODULE_ID,
    title="Dependency-graph reachability and free-round budget",
    # Tier P only, as section 9 declares: both quantities are properties of the
    # wiring, established deductively. There is no enumerative or sampled path
    # here, and the registry's router refuses either regime for this module.
    declared_tiers=frozenset({Tier.P}),
    prereg_path=PREREG_PATH,
    runner_path="harness/runner.py",
    suite=SUITE,
    measure=measure,
    targets=("sha256-compression-parametrised",),
)

REGISTRY.register(SPEC)
