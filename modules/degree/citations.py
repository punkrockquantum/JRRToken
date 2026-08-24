"""Citations Module 1 relies on, and the state of verification of each.

Prime directive 2.1(b): a citation carries the full reference. The
``verification`` field records something narrower and more important than
whether the paper exists: whether the *number* this repository relies on has
been read out of the primary source. A citation in state UNVERIFIED blocks every
calibration case whose expected value depends on it.

Verification state as of the commit that introduces this file: the network
egress policy of the environment this repository was built in blocks
eprint.iacr.org, inria.hal.science and the other hosts carrying these papers, so
no per-round table or complexity figure could be transcribed from a primary
source here. See DECISIONS.md D-003.
"""

from __future__ import annotations

from tiers.provenance import Citation, CitationIndex, Verification

_EGRESS_NOTE = (
    "primary source not reachable from the build environment: WebFetch of "
    "eprint.iacr.org and inria.hal.science returned EGRESS_BLOCKED on 2026-08-24; "
    "the numeric claim must be transcribed from the paper before the case can run"
)

CITE_BCD11 = Citation(
    key="CITE-BCD11",
    authors="Christina Boura, Anne Canteaut, Christophe De Cannière",
    title="Higher-Order Differential Properties of Keccak and Luffa",
    venue="Fast Software Encryption (FSE) 2011",
    year=2011,
    locator="IACR ePrint 2010/589",
    claim=(
        "upper bounds on the algebraic degree of r rounds of Keccak-f and of its "
        "inverse, per round; and a bound on the degree of iterated permutations whose "
        "non-linear layer is parallel applications of smaller balanced S-boxes"
    ),
    verification=Verification.UNVERIFIED,
    verification_note=_EGRESS_NOTE,
)

CITE_EGLORSW20 = Citation(
    key="CITE-EGLORSW20",
    authors=(
        "Maria Eichlseder, Lorenzo Grassi, Reinhard Lüftenegger, Morten Øygarden, "
        "Christian Rechberger, Markus Schofnegger, Qingju Wang"
    ),
    title=(
        "An Algebraic Attack on Ciphers with Low-Degree Round Functions: "
        "Application to Full MiMC"
    ),
    venue="ASIACRYPT 2020",
    year=2020,
    locator="IACR ePrint 2020/182",
    claim=(
        "the growth of the algebraic degree of the r-round MiMC construction over "
        "GF(2^n) with the cube round function, as a function of r"
    ),
    verification=Verification.UNVERIFIED,
    verification_note=_EGRESS_NOTE,
)

CITE_SHATTERED = Citation(
    key="CITE-SHATTERED",
    authors="Marc Stevens, Elie Bursztein, Pierre Karpman, Ange Albertini, Yarik Markov",
    title="The First Collision for Full SHA-1",
    venue="CRYPTO 2017",
    year=2017,
    locator="proceedings of CRYPTO 2017; project site shattered.io",
    claim=(
        "the computation producing the collision cost approximately 2^63.1 SHA-1 "
        "compression function calls, used here as the data-complexity ceiling below "
        "which an implied distinguisher is treated as practically reachable"
    ),
    verification=Verification.UNVERIFIED,
    verification_note=_EGRESS_NOTE,
)

CITE_CARLET21 = Citation(
    key="CITE-CARLET21",
    authors="Claude Carlet",
    title="Boolean Functions for Cryptography and Coding Theory",
    venue="Cambridge University Press",
    year=2021,
    locator="monograph; chapter on the algebraic degree of power functions",
    claim=(
        "the algebraic degree of the power function x -> x^d over GF(2^n) equals wt(d), "
        "the binary Hamming weight of the exponent"
    ),
    verification=Verification.UNVERIFIED,
    verification_note=(
        _EGRESS_NOTE
        + "; no calibration case depends on this citation, because the same values are "
        "established in-repo by exhaustive ANF (computation M1-CTRL-POW-001)"
    ),
)

CITATIONS = CitationIndex(
    citations=(CITE_BCD11, CITE_EGLORSW20, CITE_SHATTERED, CITE_CARLET21)
)
