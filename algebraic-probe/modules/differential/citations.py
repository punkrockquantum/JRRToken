"""Citations Module 3 relies on, and the state of verification of each.

Unlike Modules 2, 4 and 6, section 5 *does* name an anchor for this module:
reduced-round SHA-256 collision and semi-free-start results. So M3 is not
blocked by E-05's "no anchor exists" -- it is blocked by E-04's egress problem,
which is a different and repairable thing. The distinction matters, because one
is a gap in the brief and the other is a gap in this environment.
"""

from __future__ import annotations

from tiers.provenance import Citation, CitationIndex, Verification

_EGRESS_NOTE = (
    "primary source not reachable from the build environment: eprint.iacr.org "
    "returns EGRESS_BLOCKED, so no step count or characteristic probability "
    "could be transcribed. The numeric claim must be read out of the paper, with "
    "the round count and the attack model it applies to, before the case can run "
    "(ESCALATIONS.md E-04)"
)

CITE_SHA256_DIFFERENTIAL = Citation(
    key="CITE-SHA256-DIFF",
    authors="(to be recorded with the transcription)",
    title="reduced-round SHA-256 collision and semi-free-start results",
    venue="(to be recorded with the transcription)",
    year=0,
    locator="named in section 5 of the brief as Module 3's anchor; specific "
    "reference to be recorded when the value is transcribed",
    claim=(
        "the best published differential characteristic for reduced-round "
        "SHA-256: its probability and the number of steps it covers, which is "
        "the value this module must reproduce before it is trusted on anything "
        "new"
    ),
    verification=Verification.UNVERIFIED,
    verification_note=_EGRESS_NOTE,
)

CITATIONS = CitationIndex(citations=(CITE_SHA256_DIFFERENTIAL,))
