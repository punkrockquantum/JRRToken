"""Registration for Module 1.

The module declares its tiers here, before it has a measurement path. The
harness routes by declared tier (``harness.registry.Registry.route``) and
refuses the wrong regime; the calibration gate refuses execution while any
ground-truth case is unverified; and ``measure`` is ``None``, so
``CalibrationSuite.run`` raises rather than silently doing nothing.
"""

from __future__ import annotations

from harness.registry import REGISTRY, ModuleSpec
from tiers.tier import Tier

from .calibration.suite import MODULE_ID, SUITE
from .measure import measure

PREREG_PATH = "modules/degree/prereg/PREREG-M1.md"

SPEC = ModuleSpec(
    module_id=MODULE_ID,
    title="Algebraic degree growth versus round count",
    # Tier P for certified bounds and witnessed lower bounds; Tier E where a
    # declared input subspace is exhausted; Tier S for the sampled witness probe,
    # whose promotion path the pre-registration closes above probe dimension 2.
    declared_tiers=frozenset({Tier.P, Tier.E, Tier.S}),
    prereg_path=PREREG_PATH,
    runner_path="harness/runner.py",
    suite=SUITE,
    measure=measure,
    targets=(
        "sha256-compression-parametrised",
        "keccak-f",
        "mimc-gf2n",
        "linear-map-gf2",
        "power-map-gf2n",
        "inverse-map-gf2n",
        "random-function-sha256-prf",
    ),
)

REGISTRY.register(SPEC)
