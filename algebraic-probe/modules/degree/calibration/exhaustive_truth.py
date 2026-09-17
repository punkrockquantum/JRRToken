"""Exhaustive exact algebraic degrees. GENERATED -- do not edit by hand.

Regenerate with:

    python scripts/exhaust.py --emit-module > modules/degree/calibration/exhaustive_truth.py

Every number here is the output of a full-domain Moebius transform over the
target's entire input space (computation M1-EXH-KECCAK-001 for Keccak-f[25],
M1-EXH-MIMC-001 for MiMC over GF(2^9)). Nothing is sampled. The values
are committed rather than recomputed on import because the Keccak arm takes tens
of seconds; ``tests/test_exhaustive_truth.py`` regenerates them and asserts this
file is byte-equal to a fresh run, which is what keeps a committed constant
traceable to a computation rather than to a belief.

These are NOT the published anchors that CAL-M1-GT-* are waiting on. See
ESCALATIONS.md E-09.
"""

from __future__ import annotations

KECCAK_WIDTH = 25
MIMC_N = 9
MIMC_SEED = 0

COMPUTATION_ID_KECCAK = "M1-EXH-KECCAK-001"
COMPUTATION_ID_MIMC = "M1-EXH-MIMC-001"

#: Exact degree of r-round Keccak-f[25], r = 1 .. the round at which it
#: saturates at the permutation maximum of 24.
KECCAK_EXACT: tuple[dict[str, object], ...] = (
    {"rounds": 1, "exact_degree": 2, "profile_min": 2, "profile_max": 2, "module_bound": 2, "trivial_bound": 2, "gap": 0, "sound": True},
    {"rounds": 2, "exact_degree": 4, "profile_min": 4, "profile_max": 4, "module_bound": 4, "trivial_bound": 4, "gap": 0, "sound": True},
    {"rounds": 3, "exact_degree": 8, "profile_min": 8, "profile_max": 8, "module_bound": 8, "trivial_bound": 8, "gap": 0, "sound": True},
    {"rounds": 4, "exact_degree": 16, "profile_min": 16, "profile_max": 16, "module_bound": 16, "trivial_bound": 16, "gap": 0, "sound": True},
    {"rounds": 5, "exact_degree": 22, "profile_min": 22, "profile_max": 22, "module_bound": 24, "trivial_bound": 24, "gap": 2, "sound": True},
    {"rounds": 6, "exact_degree": 24, "profile_min": 24, "profile_max": 24, "module_bound": 24, "trivial_bound": 24, "gap": 0, "sound": True},
)

#: Exact degree of r-round MiMC over GF(2^9).
MIMC_EXACT: tuple[dict[str, object], ...] = (
    {"rounds": 1, "exact_degree": 2, "profile_min": 2, "profile_max": 2, "naive_bound": 2, "derived_bound": 2, "gap_naive": 0, "gap_derived": 0, "sound_naive": True, "sound_derived": True, "univariate_exponent": 3},
    {"rounds": 2, "exact_degree": 2, "profile_min": 2, "profile_max": 2, "naive_bound": 4, "derived_bound": 3, "gap_naive": 2, "gap_derived": 1, "sound_naive": True, "sound_derived": True, "univariate_exponent": 9},
    {"rounds": 3, "exact_degree": 4, "profile_min": 4, "profile_max": 4, "naive_bound": 8, "derived_bound": 4, "gap_naive": 4, "gap_derived": 0, "sound_naive": True, "sound_derived": True, "univariate_exponent": 27},
    {"rounds": 4, "exact_degree": 4, "profile_min": 4, "profile_max": 4, "naive_bound": 8, "derived_bound": 6, "gap_naive": 4, "gap_derived": 2, "sound_naive": True, "sound_derived": True, "univariate_exponent": 81},
    {"rounds": 5, "exact_degree": 6, "profile_min": 6, "profile_max": 6, "naive_bound": 8, "derived_bound": 7, "gap_naive": 2, "gap_derived": 1, "sound_naive": True, "sound_derived": True, "univariate_exponent": 243},
    {"rounds": 6, "exact_degree": 8, "profile_min": 8, "profile_max": 8, "naive_bound": 8, "derived_bound": 8, "gap_naive": 0, "gap_derived": 0, "sound_naive": True, "sound_derived": True, "univariate_exponent": 218},
    {"rounds": 7, "exact_degree": 8, "profile_min": 8, "profile_max": 8, "naive_bound": 8, "derived_bound": 8, "gap_naive": 0, "gap_derived": 0, "sound_naive": True, "sound_derived": True, "univariate_exponent": 143},
    {"rounds": 8, "exact_degree": 8, "profile_min": 8, "profile_max": 8, "naive_bound": 8, "derived_bound": 8, "gap_naive": 0, "gap_derived": 0, "sound_naive": True, "sound_derived": True, "univariate_exponent": 429},
    {"rounds": 9, "exact_degree": 8, "profile_min": 8, "profile_max": 8, "naive_bound": 8, "derived_bound": 8, "gap_naive": 0, "gap_derived": 0, "sound_naive": True, "sound_derived": True, "univariate_exponent": 265},
)


def keccak_exact_degree(rounds: int) -> int:
    for row in KECCAK_EXACT:
        if row["rounds"] == rounds:
            return int(row["exact_degree"])  # type: ignore[arg-type]
    raise KeyError(f"no exhaustive Keccak-f[25] row for rounds={rounds}")


def mimc_exact_degree(rounds: int) -> int:
    for row in MIMC_EXACT:
        if row["rounds"] == rounds:
            return int(row["exact_degree"])  # type: ignore[arg-type]
    raise KeyError(f"no exhaustive MiMC row for rounds={rounds}")

