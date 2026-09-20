"""Calibrate the sampled witness probe against exactly-known degrees.

This is the probabilistic arm. It exists because the exhaustive arm
(``scripts/exhaust.py``) produced something that did not exist before: targets
whose exact algebraic degree is known over their complete input space. A sampled
probe can now be measured against truth rather than against its own worst-case
model.

Two quantities, two tiers, and they are kept apart:

  soundness (Tier P)  A degree of exactly d means every derivative of order
                      d+1 vanishes identically. So at k > d the probe must never
                      witness, for any seed, ever. A witness there is not an
                      unlucky draw -- it is a defect in the probe, the exhaustive
                      degree, or the target. Falsifiable, and checked on every
                      cell.

  rate (Tier S)       At k <= d a witness exists, and the probe finds it with
                      some probability. PREREG-M1 section 9 models that
                      probability by its Schwartz-Zippel worst case, 2^-k. This
                      measures what it actually is, with an exact
                      Clopper-Pearson interval, because a rate quoted as a single
                      point is what section 3 forbids.

What this does NOT license. The measured rate is for functions whose degree is
known. The promotion case is a function whose degree is unknown -- that is the
entire reason a bound is needed -- so a rate measured here is not evidence about
a rate there, and the D-010 closure is not reopened, reweighted, or
reinterpreted by anything in this file. If the worst case turns out to be
conservative, that is information for the operator deciding E-01, and it is
reported as that and nothing more.

Usage:
    python scripts/witness_calibration.py              # human-readable table
    python scripts/witness_calibration.py --emit-module
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core.keccak import KeccakF  # noqa: E402
from core.targets import LinearMapGF2, PowerMap  # noqa: E402
from modules.degree.calibration.exhaustive_truth import KECCAK_EXACT  # noqa: E402
from modules.degree.measure import exact_degree, witness_lower_bound  # noqa: E402
from stats.power import clopper_pearson_interval  # noqa: E402

COMPUTATION_ID = "M1-WITNESS-CAL-001"

#: The pre-registered seed count per Tier S cell (PREREG-M1, seeds_per_cell).
SEEDS_PER_CELL = 50

#: Fixed seed block, so every run draws the same subspaces.
SEED_BASE = 20260920

#: A probe at dimension k costs 2^k target evaluations per seed. Above this the
#: run stops being something that fits in a test suite; cells needing more are
#: reported as skipped with their cost, never silently dropped.
MAX_PROBE_DIM = 13

CONFIDENCE = 0.95


def _seeds() -> list[int]:
    return [SEED_BASE + i for i in range(SEEDS_PER_CELL)]


def measure_cell(target, k: int, n: int, exact: int) -> dict[str, object]:
    """One (target, probe dimension) cell: how often did the probe witness?"""
    seeds = _seeds()
    witnessed = 0
    for seed in seeds:
        outcome = witness_lower_bound(target, k, [seed], n)
        if outcome.witnessed:
            witnessed += 1
    rate = witnessed / len(seeds)
    low, high = clopper_pearson_interval(witnessed, len(seeds), CONFIDENCE)
    vanishes_deductively = k > exact
    return {
        "k": k,
        "exact_degree": exact,
        "witness_possible": not vanishes_deductively,
        "witnessed": witnessed,
        "seeds": len(seeds),
        "rate": round(rate, 6),
        "ci_low": round(low, 6),
        "ci_high": round(high, 6),
        "worst_case_p": round(2.0**-k, 10),
        # The load-bearing assertion. A witness above the exact degree
        # contradicts a theorem, not a model.
        "soundness_violated": bool(vanishes_deductively and witnessed > 0),
    }


def _cells_for(label: str, target, n: int, exact: int) -> dict[str, object]:
    rows = []
    skipped = []
    # The deductive claim bites above the exact degree, so the sweep runs two
    # dimensions past it rather than one. A single cell where vanishing is
    # required is a single point, and a probe broken at exactly that k would
    # look clean; two cells make that coincidence do more work.
    highest = min(exact + 2, n)
    for k in range(1, highest + 1):
        if k > MAX_PROBE_DIM:
            skipped.append({"k": k, "cost_evaluations_per_seed": 2**k})
            continue
        rows.append(measure_cell(target, k, n, exact))
    return {
        "target": label,
        "n": n,
        "exact_degree": exact,
        "cells": rows,
        "skipped": skipped,
    }


def collect() -> list[dict[str, object]]:
    results = []

    # Degree 1: the floor. Every derivative of order 2 vanishes.
    linear = LinearMapGF2.random_invertible(13, 20260824)
    results.append(_cells_for("linear-map-gf2 n=13", linear, 13, exact_degree(linear)))

    # Power maps: exact degree is wt(e), and the exhaustive path confirms it.
    for exponent in (3, 7, 31, 4095):
        target = PowerMap.create(13, exponent)
        results.append(
            _cells_for(f"power-map-gf2n n=13 d={exponent}", target, 13, exact_degree(target))
        )

    # The real primitive, at every round whose exact degree the exhaustive arm
    # established and whose probe cost is affordable.
    for row in KECCAK_EXACT:
        rounds = int(row["rounds"])  # type: ignore[arg-type]
        exact = int(row["exact_degree"])  # type: ignore[arg-type]
        if exact + 1 > MAX_PROBE_DIM:
            results.append(
                {
                    "target": f"keccak-f[25] rounds={rounds}",
                    "n": 25,
                    "exact_degree": exact,
                    "cells": [],
                    "skipped": [
                        {"k": exact + 1, "cost_evaluations_per_seed": 2 ** (exact + 1)}
                    ],
                }
            )
            continue
        results.append(
            _cells_for(
                f"keccak-f[25] rounds={rounds}", KeccakF.create(lane_log2=0, n_rounds=rounds), 25, exact
            )
        )
    return results


def render_table(results: list[dict]) -> str:
    lines = [
        f"witness_calibration computation_id={COMPUTATION_ID} "
        f"seeds_per_cell={SEEDS_PER_CELL} seed_base={SEED_BASE} confidence={CONFIDENCE}",
        "  soundness_arm=tier-P a witness above the exact degree contradicts a theorem",
        "  rate_arm=tier-S measured per-draw witness probability, with an exact interval",
        "",
    ]
    violations = 0
    for entry in results:
        lines.append(
            f"target={entry['target']} n={entry['n']} exact_degree={entry['exact_degree']}"
        )
        for cell in entry["cells"]:
            if cell["soundness_violated"]:
                violations += 1
            lines.append(
                f"  k={cell['k']} witness_possible={cell['witness_possible']} "
                f"witnessed={cell['witnessed']}/{cell['seeds']} rate={cell['rate']} "
                f"ci=[{cell['ci_low']},{cell['ci_high']}] worst_case_p={cell['worst_case_p']} "
                f"soundness_violated={cell['soundness_violated']}"
            )
        for skip in entry["skipped"]:
            lines.append(
                f"  k={skip['k']} skipped=cost evaluations_per_seed={skip['cost_evaluations_per_seed']} "
                f"guard=MAX_PROBE_DIM={MAX_PROBE_DIM}"
            )
    lines.append("")
    lines.append(f"soundness_violations={violations}")

    above = [
        c
        for entry in results
        for c in entry["cells"]
        if not c["witness_possible"]
    ]
    at_or_below = [
        c for entry in results for c in entry["cells"] if c["witness_possible"]
    ]
    lines.append(
        f"cells_above_exact_degree={len(above)} witnessed_in_any={sum(1 for c in above if c['witnessed'])}"
    )
    exceeding = [c for c in at_or_below if c["ci_low"] > c["worst_case_p"]]
    lines.append(
        f"cells_at_or_below={len(at_or_below)} "
        f"cells_whose_interval_excludes_the_worst_case_from_below={len(exceeding)}"
    )
    lines.append(
        "scope=rates measured on targets of known degree; the promotion case is a "
        "target of unknown degree, so these do not bear on it. D-010 unchanged. "
        "escalation=E-01"
    )
    return "\n".join(lines)


def render_module(results: list[dict]) -> str:
    body = []
    for entry in results:
        body.append(f"    {entry!r},")
    return f'''"""Witness-probe calibration against exactly-known degrees. GENERATED.

Regenerate with:

    python scripts/witness_calibration.py --emit-module > modules/degree/calibration/witness_truth.py

Computation {COMPUTATION_ID}. Soundness cells are Tier P; rate cells are Tier S
with {SEEDS_PER_CELL} seeds and an exact Clopper-Pearson interval. See the
docstring of scripts/witness_calibration.py for what these do and do not license.
"""

from __future__ import annotations

COMPUTATION_ID = "{COMPUTATION_ID}"
SEEDS_PER_CELL = {SEEDS_PER_CELL}
SEED_BASE = {SEED_BASE}
MAX_PROBE_DIM = {MAX_PROBE_DIM}
CONFIDENCE = {CONFIDENCE}

WITNESS_CELLS: tuple[dict, ...] = (
{chr(10).join(body)}
)


def soundness_violations() -> list[dict]:
    """Cells where the probe witnessed above the exact degree. Must be empty."""
    return [
        cell
        for entry in WITNESS_CELLS
        for cell in entry["cells"]
        if cell["soundness_violated"]
    ]
'''


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--emit-module", action="store_true")
    args = parser.parse_args(argv)
    results = collect()
    print(render_module(results) if args.emit_module else render_table(results))
    violations = sum(
        1 for entry in results for cell in entry["cells"] if cell["soundness_violated"]
    )
    return 1 if violations else 0


if __name__ == "__main__":
    raise SystemExit(main())
