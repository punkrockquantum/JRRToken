"""Citations Module 2 relies on: none, deliberately.

Both of Module 2's quantities are properties of the SHA-256 message schedule's
wiring, established by transitive closure and by propagating reachable sets
through ``core.sha256.compress`` itself. Neither rests on a number transcribed
from anywhere, so the index is empty and nothing here can be blocked by the
egress problem that holds E-04 open.

That is not the same as the module being calibrated. Section 5 requires a
*published anchor* an independent reader can check against a paper, and neither
brief names one for Module 2. The suite is therefore built with
``allow_missing_ground_truth`` and the module ships calibration-blocked
(ESCALATIONS.md E-05), exactly as Module 4 does.
"""

from __future__ import annotations

from tiers.provenance import CitationIndex

CITATIONS = CitationIndex(citations=())
