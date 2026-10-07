"""Citations for Module 4.

Section 5 of the original brief makes a published anchor a blanket precondition
and names one for M1, M3 and M5 only. Module 4 has none in either brief, so the
index is deliberately empty and the module ships calibration-blocked rather than
uncalibrated. See ESCALATIONS.md E-05.
"""

from __future__ import annotations

from tiers.provenance import CitationIndex

#: Empty by design, not by omission.
CITATIONS = CitationIndex(citations=())

NO_ANCHOR_REASON = (
    "no published higher-order-differential or integral result is named for this "
    "module in either brief, and section 5 requires one that an independent reader "
    "can check against a paper before the module is trusted on anything new"
)
