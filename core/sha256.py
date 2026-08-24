"""Primary target placeholder: round-parametrised SHA-256.

Section 9 directs that the validated parametrised implementation from the
sha256-testbed repository (C core plus cffi wrapper, bit-identical to hashlib at
64 rounds, FIPS 180-4 validated) be reused rather than rewritten, and that its
validation suite be re-run here before anything depends on it.

That repository is not reachable from this session -- see DECISIONS.md D-002 --
so nothing SHA-256-shaped is implemented here. This module exists to make the
absence explicit and to fail loudly rather than to let a hand-rolled substitute
creep into the target position.
"""

from __future__ import annotations

from tiers.errors import NotAuthorised

TARGET_ID = "sha256-compression-parametrised"

IMPORT_REQUIREMENTS = (
    "vendor the parametrised SHA-256 core from sha256-testbed into core/ without "
    "modification",
    "re-run its FIPS 180-4 validation vectors in this repository and commit the run log",
    "assert bit-identity with hashlib.sha256 at 64 rounds over the committed vector set",
    "record the upstream commit id of the vendored code in DECISIONS.md",
)


def compress(*args: object, **kwargs: object) -> int:
    raise NotAuthorised(
        "the parametrised SHA-256 target is not present in this repository. "
        "Required before it may be used: " + "; ".join(IMPORT_REQUIREMENTS)
    )
