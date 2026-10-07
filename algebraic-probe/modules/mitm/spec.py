"""Registration for Module 5."""

from __future__ import annotations

from harness.registry import REGISTRY, ModuleSpec
from tiers.tier import Tier

from .calibration.suite import MODULE_ID, SUITE
from .measure import measure

PREREG_PATH = "modules/mitm/prereg/PREREG-M5.md"

SPEC = ModuleSpec(
    module_id=MODULE_ID,
    title="Meet-in-the-middle and biclique structure",
    # Tiers P and E, as section 9 declares. The consumption closure is
    # deductive; the sweep over cuts is a complete enumeration of a stated,
    # finite space. Nothing here samples, and the registry's router refuses the
    # probabilistic regime for this module.
    declared_tiers=frozenset({Tier.P, Tier.E}),
    prereg_path=PREREG_PATH,
    runner_path="harness/runner.py",
    suite=SUITE,
    measure=measure,
    targets=("sha256-compression-parametrised",),
)

REGISTRY.register(SPEC)
