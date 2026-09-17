"""Exhaustive exact algebraic degree for every target whose input space fits.

This is the brute-force arm. It consumes the whole input space -- 2^25 inputs for
Keccak-f[25], 2^9 for MiMC over GF(2^9) -- and computes the exact algebraic
degree by Moebius transform. Nothing is sampled, so every number it emits is
Tier E, and the two quantities it reports about the instrument are deductive
consequences of that:

  soundness  the module's certified Tier P bound must be at least the exact
             degree. This is falsifiable: an unsound propagation rule fails here.
  gap        bound minus exact degree, per round. The tightness of the
             instrument, measured rather than asserted.

What this does NOT do. It does not supply the published anchor that
``CAL-M1-GT-KECCAK-R*`` and ``CAL-M1-GT-MIMC-R*`` are waiting on. A value
computed here is a value I computed; substituting it for CITE-BCD11 or
CITE-EGLORSW20 is what Class 2 of the completion brief forbids. Those cases stay
pending and the calibration gate stays blocked. See ESCALATIONS.md E-09.

Usage:
    python scripts/exhaust.py                 # human-readable table to stdout
    python scripts/exhaust.py --emit-module   # the generated data file
    python scripts/exhaust.py --keccak-max 6  # stop after this round count
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core.keccak import KeccakF  # noqa: E402
from core.mimc import MiMC, standard_rounds  # noqa: E402
from modules.degree.measure import (  # noqa: E402
    keccak_bound,
    mimc_bound,
    mimc_derived_bound,
)
from verify import packed  # noqa: E402
from verify.keccak_columns import WIDTH as KECCAK_WIDTH  # noqa: E402
from verify.keccak_columns import evaluate_at, keccak25_columns  # noqa: E402

COMPUTATION_ID_KECCAK = "M1-EXH-KECCAK-001"
COMPUTATION_ID_MIMC = "M1-EXH-MIMC-001"

#: MiMC parameters. n = 9 is the parameterisation the calibration suite declares.
MIMC_N = 9
MIMC_SEED = 0

#: Inputs at which the packed column evaluation is checked against
#: ``core.keccak.permute``. Fixed here so the check is the same on every run.
CROSS_CHECK_INPUTS = (0, 1, 2, 3, 7, 12345, 99999, 1 << 12, (1 << 25) - 1, (1 << 24) + 5)


def keccak_rows(max_rounds: int) -> list[dict[str, object]]:
    """Exact degree of r-round Keccak-f[25] for r = 1..max_rounds.

    Stops early once the degree reaches the permutation maximum: beyond that
    point the exact degree cannot rise and every later round is the same row.
    """
    masks = packed.weight_masks(KECCAK_WIDTH)
    rows: list[dict[str, object]] = []
    for rounds in range(1, max_rounds + 1):
        started = time.time()
        columns = keccak25_columns(rounds)

        reference = KeccakF.create(lane_log2=0, n_rounds=rounds)
        mismatches = [
            x for x in CROSS_CHECK_INPUTS if evaluate_at(columns, x) != reference(x)
        ]
        if mismatches:
            raise AssertionError(
                f"packed columns disagree with core.keccak.permute at rounds={rounds}, "
                f"inputs {mismatches}: the exhaustive path is not evaluating the "
                "target it claims to"
            )

        profile = tuple(
            packed.degree_of_column(packed.moebius_column(column, KECCAK_WIDTH), KECCAK_WIDTH, masks)
            for column in columns
        )
        exact = max(profile)
        bound = keccak_bound(reference)
        rows.append(
            {
                "rounds": rounds,
                "exact_degree": exact,
                "profile_min": min(profile),
                "profile_max": exact,
                "module_bound": bound.value,
                "trivial_bound": reference.trivial_degree_bound,
                "gap": bound.value - exact,
                "sound": bound.value >= exact,
                "seconds": round(time.time() - started, 2),
            }
        )
        if exact >= KECCAK_WIDTH - 1:
            break
    return rows


def mimc_rows(max_rounds: int) -> list[dict[str, object]]:
    """Exact degree of r-round MiMC over GF(2^MIMC_N), both bounds beside it."""
    rows: list[dict[str, object]] = []
    for rounds in range(1, max_rounds + 1):
        target = MiMC.create(n=MIMC_N, n_rounds=rounds, seed=MIMC_SEED)
        columns = packed.pack_truth_table(target, MIMC_N, MIMC_N)
        profile = packed.degree_profile_from_columns(columns, MIMC_N)
        exact = max(profile)
        naive = mimc_bound(target).value
        derived = mimc_derived_bound(target).value
        rows.append(
            {
                "rounds": rounds,
                "exact_degree": exact,
                "profile_min": min(profile),
                "profile_max": exact,
                "naive_bound": naive,
                "derived_bound": derived,
                "gap_naive": naive - exact,
                "gap_derived": derived - exact,
                "sound_naive": naive >= exact,
                "sound_derived": derived >= exact,
                "univariate_exponent": target.univariate_degree,
            }
        )
    return rows


def _mean(values: list[int]) -> float:
    return sum(values) / len(values) if values else 0.0


def render_table(keccak: list[dict], mimc: list[dict]) -> str:
    lines = [
        f"exhaustive_exact_degree computation_ids=[{COMPUTATION_ID_KECCAK},{COMPUTATION_ID_MIMC}]",
        f"  method=full-domain Moebius transform over packed columns tier=E sampled=none",
        "",
        f"target=keccak-f[25] variables={KECCAK_WIDTH} space=2^{KECCAK_WIDTH} "
        f"cross_checked_against=core.keccak.permute inputs={len(CROSS_CHECK_INPUTS)}",
    ]
    for row in keccak:
        lines.append(
            f"  rounds={row['rounds']} exact_degree={row['exact_degree']} "
            f"module_bound={row['module_bound']} gap={row['gap']} sound={row['sound']} "
            f"profile=[{row['profile_min']},{row['profile_max']}] seconds={row['seconds']}"
        )
    sound_k = all(bool(r["sound"]) for r in keccak)
    tight_k = [int(r["rounds"]) for r in keccak if int(r["gap"]) == 0]
    lines.append(
        f"  soundness_holds_every_round={sound_k} "
        f"rounds_with_gap_zero={tight_k} "
        f"mean_gap={_mean([int(r['gap']) for r in keccak]):.4g}"
    )
    lines.append("")
    lines.append(
        f"target=mimc-gf2n[{MIMC_N}] variables={MIMC_N} space=2^{MIMC_N} seed={MIMC_SEED}"
    )
    for row in mimc:
        lines.append(
            f"  rounds={row['rounds']} exact_degree={row['exact_degree']} "
            f"naive_bound={row['naive_bound']} derived_bound={row['derived_bound']} "
            f"gap_naive={row['gap_naive']} gap_derived={row['gap_derived']} "
            f"sound_naive={row['sound_naive']} sound_derived={row['sound_derived']}"
        )
    lines.append(
        f"  soundness_holds_every_round_naive={all(bool(r['sound_naive']) for r in mimc)} "
        f"derived={all(bool(r['sound_derived']) for r in mimc)}"
    )
    lines.append(
        f"  mean_gap_naive={_mean([int(r['gap_naive']) for r in mimc]):.4g} "
        f"mean_gap_derived={_mean([int(r['gap_derived']) for r in mimc]):.4g}"
    )
    lines.append("")
    lines.append(
        "  not_a_published_anchor=True "
        "pending_cases=[CAL-M1-GT-KECCAK-R1,CAL-M1-GT-KECCAK-R2,CAL-M1-GT-KECCAK-R3,"
        "CAL-M1-GT-MIMC-R1,CAL-M1-GT-MIMC-R2,CAL-M1-GT-MIMC-R3] escalation=E-09"
    )
    return "\n".join(lines)


def render_module(keccak: list[dict], mimc: list[dict]) -> str:
    """The generated data file the calibration suite imports."""

    def literal(rows: list[dict]) -> str:
        out = []
        for row in rows:
            items = ", ".join(f'"{k}": {v!r}' for k, v in row.items() if k != "seconds")
            out.append(f"    {{{items}}},")
        return "\n".join(out)

    return f'''"""Exhaustive exact algebraic degrees. GENERATED -- do not edit by hand.

Regenerate with:

    python scripts/exhaust.py --emit-module > modules/degree/calibration/exhaustive_truth.py

Every number here is the output of a full-domain Moebius transform over the
target's entire input space (computation {COMPUTATION_ID_KECCAK} for Keccak-f[25],
{COMPUTATION_ID_MIMC} for MiMC over GF(2^{MIMC_N})). Nothing is sampled. The values
are committed rather than recomputed on import because the Keccak arm takes tens
of seconds; ``tests/test_exhaustive_truth.py`` regenerates them and asserts this
file is byte-equal to a fresh run, which is what keeps a committed constant
traceable to a computation rather than to a belief.

These are NOT the published anchors that CAL-M1-GT-* are waiting on. See
ESCALATIONS.md E-09.
"""

from __future__ import annotations

KECCAK_WIDTH = {KECCAK_WIDTH}
MIMC_N = {MIMC_N}
MIMC_SEED = {MIMC_SEED}

COMPUTATION_ID_KECCAK = "{COMPUTATION_ID_KECCAK}"
COMPUTATION_ID_MIMC = "{COMPUTATION_ID_MIMC}"

#: Exact degree of r-round Keccak-f[25], r = 1 .. the round at which it
#: saturates at the permutation maximum of {KECCAK_WIDTH - 1}.
KECCAK_EXACT: tuple[dict[str, object], ...] = (
{literal(keccak)}
)

#: Exact degree of r-round MiMC over GF(2^{MIMC_N}).
MIMC_EXACT: tuple[dict[str, object], ...] = (
{literal(mimc)}
)


def keccak_exact_degree(rounds: int) -> int:
    for row in KECCAK_EXACT:
        if row["rounds"] == rounds:
            return int(row["exact_degree"])  # type: ignore[arg-type]
    raise KeyError(f"no exhaustive Keccak-f[25] row for rounds={{rounds}}")


def mimc_exact_degree(rounds: int) -> int:
    for row in MIMC_EXACT:
        if row["rounds"] == rounds:
            return int(row["exact_degree"])  # type: ignore[arg-type]
    raise KeyError(f"no exhaustive MiMC row for rounds={{rounds}}")
'''


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keccak-max", type=int, default=8)
    parser.add_argument("--mimc-max", type=int, default=None)
    parser.add_argument(
        "--emit-module",
        action="store_true",
        help="print the generated data file instead of the human-readable table",
    )
    args = parser.parse_args(argv)

    mimc_max = args.mimc_max if args.mimc_max is not None else standard_rounds(MIMC_N) + 3
    keccak = keccak_rows(args.keccak_max)
    mimc = mimc_rows(mimc_max)

    print(render_module(keccak, mimc) if args.emit_module else render_table(keccak, mimc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
