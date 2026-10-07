"""Citations Module 6 relies on: none, deliberately.

Module 6's quantities are the propagation probability of one modular addition
and the count of additions that sinks a characteristic to the random level.
Both are computed here -- the first as an exact rational from a carry argument,
checked against a full enumeration over every ``(x, y)`` pair in
``verify/rotational.py``; the second by counting the additions
``core.sha256.compress`` actually performs, with the real function instrumented.
Neither rests on a number transcribed from anywhere, so the index is empty and
nothing here can be blocked by the egress problem that holds E-04 open.

That is not the same as the module being calibrated. Section 5 requires a
*published anchor* an independent reader can check against a paper, and neither
brief names one for Module 6. The suite is therefore built with
``allow_missing_ground_truth`` and the module ships calibration-blocked
(ESCALATIONS.md E-05), exactly as Modules 2 and 4 do.

Worth separating from the E-04 modules: M1, M3 and M5 are blocked because an
anchor exists and cannot be reached. M6 is blocked because the brief names
none. The remedies differ -- transcribe a number, versus confirm that no anchor
exists -- and collapsing them would hide which of the two is outstanding.
"""

from __future__ import annotations

from tiers.provenance import CitationIndex

CITATIONS = CitationIndex(citations=())
