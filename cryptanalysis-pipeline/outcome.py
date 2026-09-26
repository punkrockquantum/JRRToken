"""Closing out a pre-registration — the verdict, computed and chained.

The gap this fills. PREREG-002, -003 and -004 were all committed before their
runs, and their runs were stamped and chained. But every one of the first 42
chain records names **PREREG-002**, because the sweep driver stamps the
document it reads its grid from. PREREG-003 and PREREG-004 were discharged in
prose: a script printed some numbers, I read them, and I wrote down a verdict.

That is the exact failure the layer exists to prevent. A conclusion that rests
on someone's reading of a printout is not evidence, however carefully the run
underneath it was recorded. The pre-registration fixes the reading in advance
precisely so that applying it can be mechanical, and if applying it is not
mechanical then fixing it in advance bought nothing.

So an outcome is a record:

  * its **kind** is the verdict word the document itself defines
    (``outcome-survives`` and the rest), never a word chosen at writing time;
  * it is stamped with **that document's** sha256, so the chain finally
    references PREREG-003 and PREREG-004 rather than only PREREG-002;
  * it carries every registered condition with the value that decided it, so a
    reader can see which clause carried the verdict and recompute it;
  * it cites the run artefacts it was computed from **by content hash**,
    because the solving degrees for runs made before this change live in the
    ladder JSON and not in the chained payload. An outcome over those runs
    addresses the files or it addresses nothing;
  * a verdict that retracts a lead, or that cannot be read at all, is a
    negative and owes a blindness statement like any other.

What this does not do: rewrite the mis-stamped run records. They are
append-only and they stand. The outcome record names what it read, and the
mis-stamping is recorded in ``runs/NOTES.md`` beside them.
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from provenance import (
    OUTCOME_KINDS,
    PreRegistration,
    ProvenanceRefused,
    ResultLog,
    file_digest,
    load_prereg,
    mint_record,
)

#: PREREG-004 fixes this in its ``minimum_steps`` field: below it the means are
#: not worth comparing and the run is inconclusive rather than an outcome.
MINIMUM_STEPS_PER_KIND = 15

#: PREREG-004's ``outcome_survives``: the means must differ by at least this.
MINIMUM_MEAN_GAP = 1.0


class OutcomeRefused(Exception):
    """The outcome cannot be computed or recorded as stated."""


@dataclass(frozen=True, slots=True)
class Condition:
    """One registered clause, and the value that decided it."""

    name: str
    holds: bool
    detail: str

    def render(self) -> str:
        return f"  {'PASS' if self.holds else 'FAIL'}  {self.name}: {self.detail}"


@dataclass(frozen=True, slots=True)
class Outcome:
    """A pre-registration's verdict, with everything that produced it."""

    prereg_id: str
    prereg_sha256: str
    verdict: str
    conditions: tuple[Condition, ...]
    statistics: dict
    #: ``{relative path: sha256}`` for every run artefact read.
    inputs: dict[str, str] = field(default_factory=dict)
    blindness: str = ""

    def __post_init__(self) -> None:
        if self.verdict not in OUTCOME_KINDS:
            raise OutcomeRefused(
                f"{self.verdict!r} is not one of the verdict words a "
                f"pre-registration defines: {list(OUTCOME_KINDS)}. A verdict "
                "chosen at writing time is not a pre-registered reading."
            )

    def render(self) -> str:
        lines = [
            f"outcome {self.prereg_id} verdict={self.verdict} "
            f"prereg_sha256={self.prereg_sha256[:16]}",
        ]
        lines.extend(condition.render() for condition in self.conditions)
        lines.append(f"  inputs={len(self.inputs)} run artefacts, cited by content hash")
        if self.blindness:
            lines.append(f"  blindness={self.blindness}")
        return "\n".join(lines)

    def to_record(self, solver_versions: tuple[str, ...]) -> dict:
        return mint_record(
            kind=self.verdict,
            spec_digest="grid",  # an outcome spans a grid, not one spec
            solver_versions=solver_versions,
            prereg_sha256=self.prereg_sha256,
            blindness=self.blindness,
            payload={
                "prereg_id": self.prereg_id,
                "conditions": [
                    {"name": c.name, "holds": c.holds, "detail": c.detail}
                    for c in self.conditions
                ],
                "statistics": self.statistics,
                "inputs": self.inputs,
            },
        )


# -- the round-kind statistic PREREG-004 is read from ------------------------


def _shape_spec(record: dict):
    """Rebuild the spec a ladder record came from, to recover its round kinds."""
    import spec as S

    width = int(record["spec"].split("width=")[1].split()[0])
    inner = record["spec"].split("rounds=")[1].split()[0].split("(")[1].rstrip(")")
    first, partial, last = inner.split("+")
    return S.poseidon_like(
        prime=int(record["spec"].split("p=")[1].split()[0]),
        width=width,
        rounds_full=int(first.rstrip("f")) + int(last.rstrip("f")),
        rounds_partial=int(partial.rstrip("p")),
    )


def round_kind_changes(runs_dir: str | Path) -> tuple[dict, dict[str, str]]:
    """Per-encoding change in solving degree, attributed to the round added.

    Returns ``(changes, inputs)`` where ``changes`` maps
    ``(encoding, round kind)`` to the list of per-step changes, and ``inputs``
    maps each run file read to its content hash.
    """
    runs = Path(runs_dir)
    newest: dict[tuple[str, str], Path] = {}
    for path in runs.glob("ladder-*.json"):
        record = json.loads(path.read_text(encoding="utf-8"))
        if "poseidon" not in record["spec"]:
            continue
        if not any(r.get("solving_degree") is not None for r in record["rungs"]):
            continue
        key = (record.get("encoding", "sbox"), record["spec_digest"])
        import os

        if key not in newest or os.path.getmtime(path) > os.path.getmtime(newest[key]):
            newest[key] = path

    changes: dict[tuple[str, str], list[int]] = defaultdict(list)
    inputs: dict[str, str] = {}
    for (encoding, _), path in newest.items():
        record = json.loads(path.read_text(encoding="utf-8"))
        inputs[path.name] = file_digest(path)
        kinds = list(_shape_spec(record).round_kinds())
        rungs = [r for r in record["rungs"] if r["solving_degree"] is not None]
        for before, after in zip(rungs, rungs[1:]):
            added = kinds[after["rounds"] - 1]
            changes[(encoding, added)].append(
                after["solving_degree"] - before["solving_degree"]
            )
    return dict(changes), inputs


def evaluate_prereg_004(runs_dir: str | Path, prereg: PreRegistration) -> Outcome:
    """Apply PREREG-004's registered conditions and return the verdict.

    The three readings the document fixed in advance:

      survives  -- the partial-round mean exceeds the full-round mean by at
                   least 1.0, **and** the minimum partial-round change is
                   strictly greater than the full-round mean;
      vanishes  -- the separation is gone;
      reverses  -- full rounds raise the solving degree more than partial ones,
                   in which case the two encodings disagree about the cipher
                   and neither measurement may be used.

    and one gate before any of them: at least 15 attributable steps of each
    round kind under the state encoding, or the run is inconclusive.
    """
    changes, inputs = round_kind_changes(runs_dir)
    partial = changes.get(("state", "partial"), [])
    full = changes.get(("state", "full"), [])
    if not partial or not full:
        raise OutcomeRefused(
            "the state encoding produced no attributable steps of one or both "
            "round kinds; there is nothing to read"
        )

    mean_partial = sum(partial) / len(partial)
    mean_full = sum(full) / len(full)
    gap = mean_partial - mean_full

    conditions = [
        Condition(
            "minimum_steps",
            len(partial) >= MINIMUM_STEPS_PER_KIND and len(full) >= MINIMUM_STEPS_PER_KIND,
            f"{len(partial)} partial and {len(full)} full steps under the state "
            f"encoding, against a registered minimum of {MINIMUM_STEPS_PER_KIND} each",
        ),
        Condition(
            "mean_gap",
            gap >= MINIMUM_MEAN_GAP,
            f"partial mean {mean_partial:+.2f} minus full mean {mean_full:+.2f} "
            f"= {gap:+.2f}, against a registered minimum of {MINIMUM_MEAN_GAP:+.2f}",
        ),
        Condition(
            "minimum_above_full_mean",
            min(partial) > mean_full,
            f"smallest partial-round change {min(partial):+d} against full-round "
            f"mean {mean_full:+.2f}",
        ),
    ]

    by_name = {c.name: c for c in conditions}
    if not by_name["minimum_steps"].holds:
        verdict = "outcome-inconclusive"
    elif gap <= -MINIMUM_MEAN_GAP:
        verdict = "outcome-reverses"
    elif by_name["mean_gap"].holds and by_name["minimum_above_full_mean"].holds:
        verdict = "outcome-survives"
    else:
        verdict = "outcome-vanishes"

    statistics = {
        encoding_kind[0] + "/" + encoding_kind[1]: {
            "n": len(values),
            "mean": round(sum(values) / len(values), 4),
            "min": min(values),
            "max": max(values),
        }
        for encoding_kind, values in sorted(changes.items())
    }

    blindness = (
        "two encodings are two, not many: this is evidence that the separation "
        "is not an artefact of the one bookkeeping difference that was "
        "controlled, not that no encoding would show something else; the "
        "solving degree is measured by msolve alone, block 0, uncorroborated by "
        "a second implementation; rounds 1-7 at a 30-bit prime on planted "
        "instances under one monomial ordering; and a verdict over per-step "
        "means says nothing about any individual cell"
    )

    return Outcome(
        prereg_id=prereg.prereg_id,
        prereg_sha256=prereg.sha256,
        verdict=verdict,
        conditions=tuple(conditions),
        statistics=statistics,
        inputs=inputs,
        blindness=blindness,
    )


def record_outcome(
    outcome: Outcome, log_path: str | Path, solver_versions: tuple[str, ...]
) -> None:
    """Append the outcome to the hash chain, refusing to record it twice.

    A pre-registration is discharged once. A second outcome record for the same
    document and the same inputs would let a reader believe two independent
    readings agreed, when there was one reading recorded twice.
    """
    log = ResultLog(log_path)
    for existing in log.records():
        payload = existing.payload
        if (
            payload.get("prereg_id") == outcome.prereg_id
            and payload.get("kind") in OUTCOME_KINDS
            and payload.get("inputs") == outcome.inputs
        ):
            raise ProvenanceRefused(
                f"{outcome.prereg_id} already has an outcome record at seq "
                f"{existing.seq} over these same inputs. A pre-registration is "
                "discharged once; recording it twice would read as two "
                "independent readings agreeing."
            )
    log.append(outcome.to_record(solver_versions))


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prereg", default="prereg/PREREG-004-encoding-control.md")
    parser.add_argument("--runs-dir", default="runs")
    parser.add_argument(
        "--write", action="store_true",
        help="append the outcome to the chain; without it, nothing is written",
    )
    args = parser.parse_args(argv)

    prereg = load_prereg(args.prereg)
    prereg.assert_committed()
    outcome = evaluate_prereg_004(args.runs_dir, prereg)
    print(outcome.render())
    if args.write:
        from solvers import msolve_version, singular_version

        versions = (f"msolve/{msolve_version()}", f"singular/{singular_version()}")
        record_outcome(outcome, Path(args.runs_dir) / "log.jsonl", versions)
        print("\nappended to the chain")
    else:
        print("\nnot written; pass --write to append it to the chain")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
