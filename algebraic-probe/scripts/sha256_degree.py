"""Algebraic degree of the round-parametrised SHA-256 compression function.

The primary target, measured for the first time. Three arms, three tiers, and the
point of running all three is that no one of them settles the question:

  upper bound (Tier P)   Degree propagated through ``core.sha256.compress``
                         itself. Two variants, because the obvious one is
                         useless: tracking a degree number alone lets modular
                         addition's carry rule multiply it (4526 after one
                         round, 1.6e13 after three), so only the free-variable
                         ceiling keeps it finite. Tracking each bit's variable
                         *support* alongside the degree, and capping at
                         ``popcount(support)`` after every operation, gives a
                         bound that means something.

  lower bound (Tier P)   A restriction of a function has degree no greater than
                         the function, so the exact degree of a restricted
                         target is a *proven* lower bound on the unrestricted
                         one. Exhausting a k-bit window costs 2^k evaluations,
                         which is affordable where 2^512 is not.

  witness (Tier P)       One non-zero k-th order derivative on the unrestricted
                         512-bit input proves degree >= k, with no enumeration
                         at all. An independent route to the same lower bound.

What the arms cannot do, stated so the gap is visible: the upper bound's
round-dependence cannot be checked exhaustively. A restricted target saturates at
its own free-variable count, so the restriction ceiling bites before the round
count does, and seeing round-dependence would need a window wider than 32 bits --
4.3e9 evaluations at the very least. The round-dependence is Tier P only.

Usage:
    python scripts/sha256_degree.py
    python scripts/sha256_degree.py --emit-module
    python scripts/sha256_degree.py --max-exhaustive-bits 18
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core.sha256 import BLOCK_BITS, FULL_ROUNDS, SHA256Compression  # noqa: E402
from modules.degree.measure import (  # noqa: E402
    sha256_bound,
    sha256_support_bound,
    witness_lower_bound,
)
from verify import packed  # noqa: E402

COMPUTATION_ID = "M1-SHA256-001"

#: Round counts the upper bound is reported at.
BOUND_ROUNDS = (0, 1, 2, 3, 4, 5, 6, 8, 12, 16, 17, 24, 32, 48, 64)

#: Round counts the exhaustive lower bound is computed at.
EXHAUSTIVE_ROUNDS = (1, 2, 4, 8, 16, 64)

#: Free-window widths exhausted. Each costs 2^width evaluations.
EXHAUSTIVE_BITS = (10, 14, 16)

#: Probe dimensions for the witness arm, on the unrestricted target.
WITNESS_DIMS = (8, 12, 16)

#: Fixed seeds for the witness arm.
WITNESS_SEEDS = tuple(20260922 + i for i in range(3))

#: The free window sits in W[0], the first message word any round consumes.
#: At offset 0 it would sit in W[15], which no round below 15 touches, so every
#: degree would be 0 -- true, and useless as a check.
FREE_OFFSET = SHA256Compression.WORD0_OFFSET


def upper_bounds() -> list[dict[str, object]]:
    rows = []
    for rounds in BOUND_ROUNDS:
        target = SHA256Compression.create(n_rounds=rounds)
        naive = sha256_bound(target)
        refined = sha256_support_bound(target)
        rows.append(
            {
                "rounds": rounds,
                "free_bits": BLOCK_BITS,
                "naive_bound": naive.value,
                "support_bound": refined.value,
                "improvement": naive.value - refined.value,
                "saturated": refined.value >= BLOCK_BITS,
            }
        )
    return rows


def exhaustive_lower_bounds(max_bits: int) -> list[dict[str, object]]:
    rows = []
    for free_bits in EXHAUSTIVE_BITS:
        if free_bits > max_bits:
            rows.append({"free_bits": free_bits, "skipped": 2**free_bits})
            continue
        for rounds in EXHAUSTIVE_ROUNDS:
            started = time.time()
            target = SHA256Compression.create(
                n_rounds=rounds, free_bits=free_bits, free_offset=FREE_OFFSET
            )
            columns = packed.pack_truth_table(target, target.n_in, target.n_out)
            profile = packed.degree_profile_from_columns(columns, target.n_in)
            exact = max(profile)
            support = sha256_support_bound(target).value
            naive = sha256_bound(target).value
            rows.append(
                {
                    "free_bits": free_bits,
                    "rounds": rounds,
                    "exact_degree": exact,
                    "profile_min": min(profile),
                    "support_bound": support,
                    "naive_bound": naive,
                    "sound": support >= exact and naive >= exact,
                    "saturated_at_free_bits": exact == free_bits,
                    "space_fraction_log2": free_bits - BLOCK_BITS,
                    "seconds": round(time.time() - started, 2),
                }
            )
    return rows


def witness_bounds() -> list[dict[str, object]]:
    rows = []
    for rounds in EXHAUSTIVE_ROUNDS:
        target = SHA256Compression.create(n_rounds=rounds)
        upper = sha256_support_bound(target).value
        for k in WITNESS_DIMS:
            outcome = witness_lower_bound(target, k, list(WITNESS_SEEDS), n=BLOCK_BITS)
            rows.append(
                {
                    "rounds": rounds,
                    "probe_dim": k,
                    "witnessed": outcome.witnessed,
                    "seeds_drawn": outcome.seeds_drawn,
                    "witness_seed": outcome.witness_seed,
                    "upper_bound": upper,
                }
            )
    return rows


def render_table(upper: list[dict], lower: list[dict], witness: list[dict]) -> str:
    lines = [
        f"sha256_degree computation_id={COMPUTATION_ID} "
        f"target=sha256-compression-parametrised block_bits={BLOCK_BITS} "
        f"full_rounds={FULL_ROUNDS} free_offset={FREE_OFFSET}",
        "",
        "  upper bound, tier=P, 512 free message bits, chaining value fixed to the IV",
    ]
    for row in upper:
        lines.append(
            f"    rounds={row['rounds']} naive_bound={row['naive_bound']} "
            f"support_bound={row['support_bound']} "
            f"improvement={row['improvement']} saturated={row['saturated']}"
        )
    unsaturated = [r for r in upper if not r["saturated"] and int(r["rounds"]) > 0]
    lines.append(
        f"  rounds_with_a_sub_ceiling_bound={[int(r['rounds']) for r in unsaturated]} "
        f"naive_is_at_the_ceiling_everywhere="
        f"{all(int(r['naive_bound']) >= BLOCK_BITS for r in upper if int(r['rounds']) > 0)}"
    )

    lines.append("")
    lines.append(
        "  lower bound, tier=E on a restricted space which is tier=P on the full "
        "target: a restriction's degree never exceeds the function's"
    )
    for row in lower:
        if "skipped" in row:
            lines.append(
                f"    free_bits={row['free_bits']} skipped=cost "
                f"evaluations={row['skipped']}"
            )
            continue
        lines.append(
            f"    free_bits={row['free_bits']} rounds={row['rounds']} "
            f"exact_degree={row['exact_degree']} support_bound={row['support_bound']} "
            f"sound={row['sound']} saturated_at_free_bits={row['saturated_at_free_bits']} "
            f"space_fraction=2^{row['space_fraction_log2']}"
        )
    measured = [r for r in lower if "skipped" not in r]
    lines.append(
        f"  soundness_holds_every_cell={all(bool(r['sound']) for r in measured)} "
        f"cells_saturated_at_the_restriction_ceiling="
        f"{sum(1 for r in measured if r['saturated_at_free_bits'])}/{len(measured)} "
        f"proven_lower_bound={max((int(r['exact_degree']) for r in measured), default=0)}"
    )

    lines.append("")
    lines.append(
        "  witness, tier=P when it witnesses, on the unrestricted 512-bit input"
    )
    for row in witness:
        lines.append(
            f"    rounds={row['rounds']} probe_dim={row['probe_dim']} "
            f"witnessed={row['witnessed']} seeds_drawn={row['seeds_drawn']} "
            f"witness_seed={row['witness_seed']} upper_bound={row['upper_bound']}"
        )
    all_witnessed = all(bool(r["witnessed"]) for r in witness)
    highest = max((int(r["probe_dim"]) for r in witness if r["witnessed"]), default=0)
    lines.append(
        f"  every_probe_witnessed={all_witnessed} highest_proven_dimension={highest}"
    )

    lines.append("")
    lines.append(
        "  scope=the upper bound's round-dependence is not exhaustively checkable "
        "here: a restricted target saturates at its own free-variable count, so the "
        "restriction ceiling bites before the round count does, and a window wider "
        "than 32 bits would need at least 4.3e9 evaluations. The round-dependence "
        "is tier P only. No published anchor is claimed for any value here; "
        "escalation=E-04 still blocks the literature comparison."
    )
    return "\n".join(lines)


def render_module(upper: list[dict], lower: list[dict], witness: list[dict]) -> str:
    def literal(rows: list[dict]) -> str:
        return "\n".join(
            f"    {{{', '.join(f'{k!r}: {v!r}' for k, v in r.items() if k != 'seconds')}}},"
            for r in rows
        )

    return f'''"""Algebraic degree of the SHA-256 compression function. GENERATED.

Regenerate with:

    python scripts/sha256_degree.py --emit-module > modules/degree/calibration/sha256_truth.py

Computation {COMPUTATION_ID}. The upper bounds are Tier P (propagated through
core.sha256.compress). The lower bounds are Tier E over a restricted input
window, which makes them Tier P lower bounds on the unrestricted target because a
restriction's degree never exceeds the function's. The witness rows are Tier P
wherever they witnessed.

No published anchor is claimed for any value here; E-04 still blocks the
literature comparison.
"""

from __future__ import annotations

COMPUTATION_ID = "{COMPUTATION_ID}"
BLOCK_BITS = {BLOCK_BITS}
FULL_ROUNDS = {FULL_ROUNDS}
FREE_OFFSET = {FREE_OFFSET}
WITNESS_SEEDS = {WITNESS_SEEDS!r}

UPPER_BOUNDS: tuple[dict, ...] = (
{literal(upper)}
)

LOWER_BOUNDS: tuple[dict, ...] = (
{literal(lower)}
)

WITNESS_ROWS: tuple[dict, ...] = (
{literal(witness)}
)


def support_bound(rounds: int) -> int:
    for row in UPPER_BOUNDS:
        if row["rounds"] == rounds:
            return int(row["support_bound"])  # type: ignore[arg-type]
    raise KeyError(f"no SHA-256 upper-bound row for rounds={{rounds}}")


def proven_lower_bound() -> int:
    """The largest degree proven by exhausting a restricted window."""
    return max(
        int(r["exact_degree"]) for r in LOWER_BOUNDS if "exact_degree" in r
    )
'''


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--emit-module", action="store_true")
    parser.add_argument("--max-exhaustive-bits", type=int, default=16)
    args = parser.parse_args(argv)

    upper = upper_bounds()
    lower = exhaustive_lower_bounds(args.max_exhaustive_bits)
    witness = witness_bounds()

    print(
        render_module(upper, lower, witness)
        if args.emit_module
        else render_table(upper, lower, witness)
    )
    unsound = [r for r in lower if "sound" in r and not r["sound"]]
    return 1 if unsound else 0


if __name__ == "__main__":
    raise SystemExit(main())
