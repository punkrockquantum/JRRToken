"""Does the degree measure's null survive a change in landscape geometry?

The question this answers. Module 1's null is "the algebraic degree has
saturated". That is a statement about the algebraic normal form. Statistical
mechanics describes landscapes whose local statistics are indistinguishable from
random while their global organisation is hierarchical and exploitable, so the
null and the structure can come apart. If they do, the recorded null is
incomplete: "no degree deficiency" would have been mistaken for "no structure".

The experiment. Two landscapes from one construction (``core.landscape``),
differing only in how many bits of hierarchy they carry, measured four ways:

  algebraic degree     the instrument under test. Exhaustive, Tier E, via
                       verify/packed.
  local minima         against the i.i.d. prediction 2^n/(n+1), derived in-repo
                       in verify.landscape.expected_local_minima_iid.
  overlap P(q)         over pairs of the lowest-energy states.
  density of states    first four moments against the standard normal.

Three of those are falsifiable predictions about the single-level model. The
sweep over cluster count is what separates a structural signature from a
finite-size artefact: a discriminator that fades as the cluster count grows was
measuring sample noise, and one that persists was measuring hierarchy.

Usage:
    python scripts/landscape.py
    python scripts/landscape.py --emit-module
    python scripts/landscape.py --n 14
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core.landscape import HierarchicalEnergy  # noqa: E402
from verify import landscape as L  # noqa: E402
from verify import packed  # noqa: E402

COMPUTATION_ID = "M1-LANDSCAPE-001"
DERIVATION_ID = "M1-LAND-DERIVE-001"

#: Exhausted in full for every cell. 14 keeps the whole sweep near a minute.
DEFAULT_N = 14

SEED = 20260920

#: Weight carried by the outer (cluster) level of the hierarchy.
OUTER_WEIGHT = 0.7

#: Cluster counts swept, as bits. 0 is the single-level model.
OUTER_BITS = (0, 2, 4, 6, 8, 10)

#: Low-energy states whose pairwise overlaps form P(q).
N_LOWEST = 64

#: An overlap above this counts as "clustered" for the mass statistic. Two states
#: sharing no structure differ in about half their bits, giving q about 0.
OVERLAP_THRESHOLD = 0.5


def measure(n: int, n_outer: int) -> dict[str, object]:
    """One landscape, measured every way. Exhaustive throughout."""
    if n_outer == 0:
        target = HierarchicalEnergy.random_energy_model(n, SEED)
    else:
        target = HierarchicalEnergy.generalised_random_energy_model(
            n, n_outer=n_outer, outer_weight=OUTER_WEIGHT, seed=SEED
        )

    values = L.energies(target.energy, n)
    minima = L.local_minima(values, n)
    predicted = L.expected_local_minima_iid(n)
    distribution = L.overlap_distribution(values, n, N_LOWEST)
    mean, variance, skewness, kurtosis = L.moments(values)

    columns = packed.pack_truth_table(target, n, target.n_out)
    profile = packed.degree_profile_from_columns(columns, n)

    return {
        "n": n,
        "n_outer": n_outer,
        "n_clusters": target.n_clusters,
        "hierarchical": target.is_hierarchical,
        # the instrument under test
        "degree_max": max(profile),
        "degree_min": min(profile),
        # prediction 1
        "local_minima": len(minima),
        "local_minima_predicted_iid": round(predicted, 4),
        "local_minima_ratio": round(len(minima) / predicted, 6),
        # prediction 2
        "mean_overlap": round(distribution.mean, 6),
        "var_overlap": round(distribution.variance, 6),
        "overlap_mass_above_threshold": round(
            distribution.mass_above(OVERLAP_THRESHOLD), 6
        ),
        # prediction 3
        "dos_mean": round(mean, 6),
        "dos_variance": round(variance, 6),
        "dos_skewness": round(skewness, 6),
        "dos_excess_kurtosis": round(kurtosis, 6),
        "dos_mean_fluctuation_predicted": round(
            target.density_of_states_mean_fluctuation, 6
        ),
    }


def collect(n: int) -> list[dict[str, object]]:
    return [measure(n, bits) for bits in OUTER_BITS]


#: What counts as a statistic "seeing" the hierarchy. These were fixed after the
#: sweep was run, so they describe the sweep rather than test a prediction. They
#: are written out here, as constants, because a threshold applied silently in a
#: comparison is exactly the kind of number this repository refuses.
MINIMA_CRITERION = "local_minima: |ratio - 1| > 0.10"
OVERLAP_CRITERION = "overlap: mean_q exceeds the single-level baseline by > 0.02"
DOS_CRITERION = "density_of_states: |mean| > 0.10"

MINIMA_MARGIN = 0.10
OVERLAP_MARGIN = 0.02
DOS_MARGIN = 0.10


def separations(rows: list[dict]) -> dict[str, set[int]]:
    """For each statistic, the cluster counts (as n_outer) where it separates.

    A statistic that separates nowhere is as informative as one that separates
    everywhere, so this returns the set rather than a verdict.
    """
    baseline = rows[0]
    hierarchical = [r for r in rows if r["hierarchical"]]
    return {
        "local_minima": {
            int(r["n_outer"])
            for r in hierarchical
            if abs(float(r["local_minima_ratio"]) - 1.0) > MINIMA_MARGIN
        },
        "overlap": {
            int(r["n_outer"])
            for r in hierarchical
            if float(r["mean_overlap"]) > float(baseline["mean_overlap"]) + OVERLAP_MARGIN
        },
        "density_of_states": {
            int(r["n_outer"])
            for r in hierarchical
            if abs(float(r["dos_mean"])) > DOS_MARGIN
        },
    }


def render_table(rows: list[dict]) -> str:
    baseline = rows[0]
    degrees = {(int(r["degree_max"]), int(r["degree_min"])) for r in rows}

    lines = [
        f"landscape_geometry computation_id={COMPUTATION_ID} "
        f"derivation_id={DERIVATION_ID} n={baseline['n']} seed={SEED} "
        f"outer_weight={OUTER_WEIGHT} n_lowest={N_LOWEST} tier=E sampled=none",
        "",
        "  the instrument under test",
    ]
    for row in rows:
        lines.append(
            f"    n_outer={row['n_outer']} n_clusters={row['n_clusters']} "
            f"degree_max={row['degree_max']} degree_min={row['degree_min']}"
        )
    lines.append(
        f"  distinct_degree_profiles={len(degrees)} "
        f"degree_separates_the_regimes={len(degrees) > 1}"
    )

    lines.append("")
    lines.append("  local minima, against the i.i.d. prediction 2^n/(n+1)")
    for row in rows:
        lines.append(
            f"    n_outer={row['n_outer']} observed={row['local_minima']} "
            f"predicted={row['local_minima_predicted_iid']} "
            f"ratio={row['local_minima_ratio']}"
        )

    lines.append("")
    lines.append("  overlap distribution over the lowest-energy states")
    for row in rows:
        lines.append(
            f"    n_outer={row['n_outer']} mean_q={row['mean_overlap']} "
            f"var_q={row['var_overlap']} "
            f"mass_above_{OVERLAP_THRESHOLD}={row['overlap_mass_above_threshold']}"
        )

    lines.append("")
    lines.append("  density of states, first four moments (standard normal is 0,1,0,0)")
    for row in rows:
        lines.append(
            f"    n_outer={row['n_outer']} mean={row['dos_mean']} "
            f"variance={row['dos_variance']} skewness={row['dos_skewness']} "
            f"excess_kurtosis={row['dos_excess_kurtosis']} "
            f"mean_fluctuation_predicted={row['dos_mean_fluctuation_predicted']}"
        )

    hierarchical = [r for r in rows if r["hierarchical"]]
    separation = separations(rows)

    lines.append("")
    lines.append(
        "  which statistic sees the hierarchy, and where "
        f"(hierarchical cells={len(hierarchical)})"
    )
    lines.append(
        f"    criteria: {MINIMA_CRITERION} | {OVERLAP_CRITERION} | {DOS_CRITERION}"
    )
    for name, cells in separation.items():
        blind_at = [c for c in hierarchical if int(c["n_outer"]) not in cells]
        lines.append(
            f"    {name} separates_at={sorted(cells)} "
            f"blind_at={[int(c['n_outer']) for c in blind_at]} "
            f"cells={len(cells)}/{len(hierarchical)}"
        )
    lines.append(
        "    note: these criteria were fixed after the sweep was run and are "
        "descriptive, not a pre-registered test. This is a section 6 blindness "
        "demonstration, which has no promotion path, so it passes through no gate."
    )

    lines.append("")
    lines.append(
        f"  degree_separates={len(degrees) > 1} "
        f"every_statistic_has_a_blind_cell="
        f"{all(len(c) < len(hierarchical) for c in separation.values()) or len(degrees) == 1}"
    )
    lines.append(
        "  scope=this measures what the degree instrument does not look at, on "
        "constructed landscapes. It is a blindness demonstration, not a finding "
        "about any named target, and it promotes nothing. escalation=E-11"
    )
    return "\n".join(lines)


def render_module(rows: list[dict]) -> str:
    body = "\n".join(f"    {row!r}," for row in rows)
    return f'''"""Landscape geometry against algebraic degree. GENERATED.

Regenerate with:

    python scripts/landscape.py --emit-module > modules/degree/calibration/landscape_truth.py

Computation {COMPUTATION_ID}; the i.i.d. local-minimum prediction is derived
in-repo as {DERIVATION_ID} (verify.landscape.expected_local_minima_iid). Every
row exhausts the whole hypercube; nothing is sampled.

These rows record what the degree measure cannot see. They are not a finding
about any named target and they promote nothing. See ESCALATIONS.md E-11.
"""

from __future__ import annotations

COMPUTATION_ID = "{COMPUTATION_ID}"
DERIVATION_ID = "{DERIVATION_ID}"
SEED = {SEED}
OUTER_WEIGHT = {OUTER_WEIGHT}
OUTER_BITS = {OUTER_BITS!r}
N_LOWEST = {N_LOWEST}
OVERLAP_THRESHOLD = {OVERLAP_THRESHOLD}

LANDSCAPE_ROWS: tuple[dict, ...] = (
{body}
)


def degree_profiles() -> set[tuple[int, int]]:
    """The distinct (max, min) degree profiles across the sweep.

    A single element means the degree measure returned the same answer for every
    landscape geometry in the sweep -- which is the blindness this file records.
    """
    return {{(int(r["degree_max"]), int(r["degree_min"])) for r in LANDSCAPE_ROWS}}
'''


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--n", type=int, default=DEFAULT_N)
    parser.add_argument("--emit-module", action="store_true")
    args = parser.parse_args(argv)
    rows = collect(args.n)
    print(render_module(rows) if args.emit_module else render_table(rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
