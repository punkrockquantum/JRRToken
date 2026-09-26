"""Which round kind moves the solving degree.

A **post-hoc** analysis of committed runs. Nothing here is pre-registered:
PREREG-003 registered a fitted model (which failed) and a structure criterion
(which was met in two cells), and this question was not asked in advance. It is
therefore hypothesis-generating and is written down as such.

It exists as a script rather than as a number in a commit message because the
rule the whole project runs under is that every number traces to a computation
that can be re-run and give the same answer. Run it with no arguments:

    python3 analysis/round_kind_effect.py

It reads the newest committed ladder per spec digest, walks each ladder's
consecutive rungs, and attributes the change in solving degree to the kind of
round that rung added.

The reason the question is worth asking: a Poseidon-family security argument
treats full rounds as the expensive, strong ones and partial rounds as the
cheap ones that nonetheless keep the degree growing. If the solving degree --
the quantity that governs Gröbner cost -- moves with one kind and not the
other, that is a statement about where the algebraic difficulty actually comes
from.

The reason the answer may not mean what it looks like: a full round introduces
``width`` new variables and equations, a partial round introduces one. Adding
more generators can *lower* a system's degree of regularity, so a difference
between the two kinds may be a property of this **encoding** rather than of the
primitive. Settling that needs the same measurement under a second, independent
encoding of the same cipher. Until then this is about a model of a cipher.
"""

from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import spec as S  # noqa: E402


def newest_per_spec(runs: Path) -> dict[str, Path]:
    """The most recent run for each spec digest that carries solving degrees.

    Earlier runs of the same spec predate the solving-degree instrument and
    carry ``None``; they are skipped rather than counted as zero.
    """
    newest: dict[str, Path] = {}
    for path in runs.glob("ladder-*.json"):
        record = json.loads(path.read_text(encoding="utf-8"))
        if "poseidon" not in record["spec"]:
            continue
        if not any(r.get("solving_degree") is not None for r in record["rungs"]):
            continue
        digest = record["spec_digest"]
        if digest not in newest or os.path.getmtime(path) > os.path.getmtime(newest[digest]):
            newest[digest] = path
    return newest


def shape_of(spec_render: str) -> tuple[int, int, int, int]:
    """``(width, rounds_full_first, rounds_partial, rounds_full_last)``."""
    width = int(spec_render.split("width=")[1].split()[0])
    shape = spec_render.split("rounds=")[1].split()[0]
    inner = shape.split("(")[1].rstrip(")")
    first, partial, last = inner.split("+")
    return width, int(first.rstrip("f")), int(partial.rstrip("p")), int(last.rstrip("f"))


def main() -> int:
    runs = ROOT / "runs"
    records = newest_per_spec(runs)
    if not records:
        print("no runs carrying solving degrees; run the sweep first")
        return 1

    changes: dict[str, list[int]] = defaultdict(list)
    print("effect on solving degree of the round added at each step\n")
    for path in sorted(records.values()):
        record = json.loads(path.read_text(encoding="utf-8"))
        width, first, partial, last = shape_of(record["spec"])
        spec = S.poseidon_like(
            prime=record["rungs"][0].get("prime", 1073741831),
            width=width,
            rounds_full=first + last,
            rounds_partial=partial,
        )
        kinds = list(spec.round_kinds())
        rungs = [r for r in record["rungs"] if r["solving_degree"] is not None]
        steps = []
        for before, after in zip(rungs, rungs[1:]):
            added = kinds[after["rounds"] - 1]
            change = after["solving_degree"] - before["solving_degree"]
            changes[added].append(change)
            steps.append(f"+{added[0]}:{change:+d}")
        label = f"t{width} {first}f+{partial}p+{last}f"
        print(f"  {label:16} " + " ".join(steps))

    print()
    for kind, values in sorted(changes.items()):
        mean = sum(values) / len(values)
        print(
            f"adding a {kind:8} round: n={len(values):2}  "
            f"range=[{min(values):+d}, {max(values):+d}]  mean={mean:+.2f}"
        )

    partial = changes.get("partial", [])
    full = changes.get("full", [])
    if partial and full:
        print()
        print(
            f"  every partial round raised it (min {min(partial):+d}); "
            f"full rounds range [{min(full):+d}, {max(full):+d}] about a mean of "
            f"{sum(full) / len(full):+.2f}"
        )
        print(
            "  POST-HOC. Not pre-registered, and possibly a property of the "
            "one-variable-per-S-box encoding rather than of the primitive: a "
            "full round adds `width` variables and equations where a partial "
            "round adds one, and more generators can lower a degree of "
            "regularity. A second independent encoding would settle it."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
