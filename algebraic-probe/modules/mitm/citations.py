"""Citations Module 5's calibration depends on.

Section 5 of the brief names "published preimage attacks on reduced-round
SHA-256" as this module's anchor, without naming a paper. So the reference has
to be chosen as well as transcribed, and neither can be done from here:
``eprint.iacr.org`` returns ``EGRESS_BLOCKED`` from this environment (D-003).

This is the same class as ``CITE-BCD11``, ``CITE-EGLORSW20`` and
``CITE-SHA256-DIFF`` -- an anchor that exists and cannot be reached -- and it is
tracked under **E-04**, not E-05. The two have different remedies: E-04 needs a
number transcribed, E-05 needs someone to confirm no anchor exists.

Nothing in this module substitutes a value computed here for the published one.
Class 2 of the brief forbids exactly that, and the in-repo measurement of where
a word-level split stops being available is reported as its own computation,
with its own scope statement, and is not compared numerically to any paper.
"""

from __future__ import annotations

from tiers.provenance import Citation, CitationIndex, Verification

_EGRESS_NOTE = (
    "primary source not reachable from the build environment: eprint.iacr.org "
    "returns EGRESS_BLOCKED, so no round count could be transcribed. The claim "
    "must be read out of the paper, with the attack model and the cost it "
    "assumes, before the case can run (ESCALATIONS.md E-04)"
)

CITE_SHA256_MITM = Citation(
    key="CITE-SHA256-MITM",
    authors="(to be recorded with the transcription)",
    title="meet-in-the-middle preimage attacks on reduced-round SHA-256",
    venue="(to be recorded with the transcription)",
    year=0,
    locator="named in section 5 of the brief as Module 5's anchor; the specific "
    "reference is to be chosen and recorded when the value is transcribed",
    claim=(
        "the number of SHA-256 rounds a published meet-in-the-middle preimage "
        "attack reaches, and the attack model it assumes, which is the value "
        "this module must be checked against before it is trusted on anything "
        "new"
    ),
    verification=Verification.UNVERIFIED,
    verification_note=_EGRESS_NOTE,
)

CITATIONS = CitationIndex(citations=(CITE_SHA256_MITM,))
