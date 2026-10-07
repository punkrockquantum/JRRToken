"""Registration for Module 6."""

from __future__ import annotations

from harness.registry import REGISTRY, ModuleSpec
from tiers.tier import Tier

from .calibration.suite import MODULE_ID, SUITE
from .measure import measure

PREREG_PATH = "modules/rx/prereg/PREREG-M6.md"

SPEC = ModuleSpec(
    module_id=MODULE_ID,
    title="Rotational-XOR propagation",
    # Tiers P and S, as section 9 declares. The linear propagation fact and the
    # addition probability are deductive; the sampled path is the Tier S one.
    # There is no enumerative path in the module -- the exhaustive count lives
    # in verify/ as a check, not as a measurement the module emits.
    declared_tiers=frozenset({Tier.P, Tier.S}),
    prereg_path=PREREG_PATH,
    runner_path="harness/runner.py",
    suite=SUITE,
    measure=measure,
    targets=("sha256-compression-parametrised",),
)

REGISTRY.register(SPEC)
