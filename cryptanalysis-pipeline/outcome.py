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
    NON_VERDICT_OUTCOME_KINDS,
    OUTCOME_KINDS,
    PreRegistration,
    ProvenanceRefused,
    ResultLog,
    file_digest,
    load_prereg,
    mint_record,
    outcome_negatives,
    outcome_vocabulary,
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
    #: The verdict words the document fixed (``outcome_vocabulary``). ``None``
    #: means the caller did not consult the document and the historical
    #: ``OUTCOME_KINDS`` applies; an evaluator always passes the document's.
    vocabulary: tuple[str, ...] | None = None
    #: Which of those words the document declared as claims of absence.
    negatives: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        allowed = (
            OUTCOME_KINDS if self.vocabulary is None
            else tuple(self.vocabulary) + NON_VERDICT_OUTCOME_KINDS
        )
        if self.verdict not in allowed:
            raise OutcomeRefused(
                f"{self.verdict!r} is not one of the verdict words "
                f"{self.prereg_id} defines: {list(allowed)}. A verdict "
                "chosen at writing time is not a pre-registered reading."
            )
        unknown = [n for n in self.negatives if n not in allowed]
        if unknown:
            raise OutcomeRefused(f"negatives {unknown} are not verdict words of {self.prereg_id}")

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
        if self.verdict in self.negatives and not self.blindness.strip():
            raise ProvenanceRefused(
                f"{self.prereg_id} declares {self.verdict} a negative and this "
                "record states no blindness. Say what the run could not have seen."
            )
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


def _split(record: dict) -> tuple[int, int, int]:
    """``(full first, partial, full last)`` as the spec string renders them.

    Read from the rendered split, not rebuilt through ``poseidon_like``: that
    helper divides ``rounds_full`` evenly, and PREREG-005's shapes are not
    even. Rebuilding ``1f+1p+4f`` as ``rounds_full=5`` would put two full
    rounds in front and attribute the wrong kind to every step.
    """
    inner = record["spec"].split("rounds=")[1].split()[0].split("(")[1].rstrip(")")
    first, partial, last = inner.split("+")
    return int(first.rstrip("f")), int(partial.rstrip("p")), int(last.rstrip("f"))


def _round_kinds(record: dict) -> list[str]:
    first, partial, last = _split(record)
    return ["full"] * first + ["partial"] * partial + ["full"] * last


def _shape_spec(record: dict):
    """Rebuild the spec a ladder record came from, with its exact split."""
    import spec as S

    first, partial, last = _split(record)
    width = int(record["spec"].split("width=")[1].split()[0])
    return S.Spec.create(
        name=f"poseidon-like-t{width}",
        prime=int(record["spec"].split("p=")[1].split()[0]),
        width=width,
        rounds_full_first=first,
        rounds_partial=partial,
        rounds_full_last=last,
        capacity=1,
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
        kinds = _round_kinds(record)
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
        vocabulary=outcome_vocabulary(prereg),
        negatives=outcome_negatives(prereg),
    )


#: The cell PREREG-003's model was fitted on, disclosed in that document's own
#: first section. It is excluded from the out-of-sample test because a model
#: tested on the data it was fitted to is not tested.
FITTED_CELL = ("sbox", 2, 4, 3)  # encoding, width, rounds_full, rounds_partial


def _cell_key(record: dict) -> tuple[str, int, int, int]:
    width = int(record["spec"].split("width=")[1].split()[0])
    inner = record["spec"].split("rounds=")[1].split()[0].split("(")[1].rstrip(")")
    first, partial, last = inner.split("+")
    return (
        record.get("encoding", "sbox"),
        width,
        int(first.rstrip("f")) + int(last.rstrip("f")),
        int(partial.rstrip("p")),
    )


def evaluate_prereg_003(runs_dir: str | Path, prereg: PreRegistration) -> Outcome:
    """Apply PREREG-003's registered criteria.

    **PREREG-003 fixed no verdict vocabulary.** It named three criteria and
    said both outcomes of the model test would be recorded, but it never
    defined a word for the result the way PREREG-004 defines survives,
    vanishes and reverses. So the criteria are evaluated mechanically and the
    record's kind is ``outcome-unworded``: choosing a word now would be the
    after-the-fact naming this layer exists to prevent, and the absence is a
    defect in the document that belongs in the chain rather than in a footnote.
    """
    import json
    import os

    runs = Path(runs_dir)
    newest: dict[tuple, Path] = {}
    for path in runs.glob("ladder-*.json"):
        record = json.loads(path.read_text(encoding="utf-8"))
        if "poseidon" not in record["spec"]:
            continue
        if not any(r.get("solving_degree") is not None for r in record["rungs"]):
            continue
        key = _cell_key(record)
        if key not in newest or os.path.getmtime(path) > os.path.getmtime(newest[key]):
            newest[key] = path

    inputs: dict[str, str] = {}
    model_held, model_tested, structure_cells, break_cells = [], [], [], []
    for key, path in sorted(newest.items()):
        encoding, width, rounds_full, rounds_partial = key
        if encoding != "sbox":
            continue  # the model was stated over the S-box encoding
        record = json.loads(path.read_text(encoding="utf-8"))
        inputs[path.name] = file_digest(path)
        rungs = [r for r in record["rungs"] if r["solving_degree"] is not None]
        label = f"t{width} {rounds_full}f+{rounds_partial}p"

        # model_criterion: s(r) = 2r-1, out-of-sample only. Leading-partial
        # shapes carry no prediction by design (rounds_full // 2 == 0).
        if rounds_full // 2 > 0 and key != FITTED_CELL:
            model_tested.append(label)
            if all(r["solving_degree"] == 2 * r["rounds"] - 1 for r in rungs):
                model_held.append(label)

        # structure_criterion: 3+ consecutive equal solving degrees while the
        # ideal degree triples at each step.
        degrees = [r["solving_degree"] for r in rungs]
        vdims = [r["ideal_degree"] for r in rungs]
        run_start = 0
        for i in range(1, len(degrees) + 1):
            if i == len(degrees) or degrees[i] != degrees[run_start]:
                if i - run_start >= 3 and all(
                    vdims[j + 1] == 3 * vdims[j] for j in range(run_start, i - 1)
                ):
                    structure_cells.append(label)
                run_start = i

        # break_criterion clause 2: a measured quantity below its prediction.
        if any(
            r["ideal_degree"] is not None
            and r["ideal_degree"] < r["predicted_degree"]
            for r in record["rungs"]
        ):
            break_cells.append(label)

    conditions = (
        Condition(
            "model_criterion",
            False if model_tested and not model_held else bool(model_held),
            f"s(r) = 2r-1 held on {len(model_held)} of {len(model_tested)} "
            f"out-of-sample predicted cells (the fitted cell and the "
            f"leading-partial cells are excluded by the document)",
        ),
        Condition(
            "structure_criterion",
            bool(structure_cells),
            f"met in {len(structure_cells)} cells: {sorted(set(structure_cells))}",
        ),
        Condition(
            "break_criterion",
            False,
            f"clause 2 (a measured quantity below its prediction) holds in "
            f"{len(break_cells)} cells, so the criterion is met nowhere and no "
            "candidate was put to the L4 gates",
        ),
    )

    return Outcome(
        prereg_id=prereg.prereg_id,
        prereg_sha256=prereg.sha256,
        verdict="outcome-unworded",
        conditions=conditions,
        statistics={
            "model_held": sorted(model_held),
            "model_tested": sorted(model_tested),
            "structure_cells": sorted(set(structure_cells)),
            "break_cells": sorted(set(break_cells)),
        },
        inputs=inputs,
        blindness=(
            "PREREG-003 fixed no verdict vocabulary, so this record states each "
            "criterion's computed value and claims no single word for the "
            "result; the solving degree is measured by msolve alone, block 0, "
            "uncorroborated by a second implementation; the structure criterion "
            "is met over three-rung runs in cells that top out at five rounds, "
            "so constancy beyond that was never observable; and every instance "
            "is planted, at a 30-bit prime, under one monomial ordering"
        ),
        vocabulary=outcome_vocabulary(prereg),
        negatives=outcome_negatives(prereg),
    )


# -- PREREG-005: the constant run ---------------------------------------------


def _registered_cells(prereg: PreRegistration) -> set[tuple[int, int, int, int]]:
    """``(width, first, partial, last)`` for every cell the document names.

    Read through the sweep's own parser so the evaluator and the driver cannot
    disagree about what the document said.
    """
    from sweep import shapes_from_prereg

    return {
        (s.width, s.first, s.rounds_partial, s.last) for s in shapes_from_prereg(prereg)
    }


def trailing_runs(runs_dir: str | Path, prereg: PreRegistration) -> tuple[list[dict], dict[str, str]]:
    """Per registered cell, the solving degrees from the last partial round on.

    Only cells the document names, under the encoding it names, are read; a
    PREREG-002 ladder that happens to be in the same directory is not evidence
    for PREREG-005. The newest ladder per cell is taken. A rung with no solving
    degree (a wall) ends the trailing run, because the question is about
    consecutive closed rungs.
    """
    import os

    registered = _registered_cells(prereg)
    encoding = prereg.fields.get("encoding", "sbox").strip()
    runs = Path(runs_dir)
    newest: dict[tuple[int, int, int, int], Path] = {}
    for path in runs.glob("ladder-*.json"):
        record = json.loads(path.read_text(encoding="utf-8"))
        if "poseidon" not in record["spec"] or record.get("encoding", "sbox") != encoding:
            continue
        width = int(record["spec"].split("width=")[1].split()[0])
        key = (width, *_split(record))
        if key not in registered:
            continue
        if key not in newest or os.path.getmtime(path) > os.path.getmtime(newest[key]):
            newest[key] = path

    cells: list[dict] = []
    inputs: dict[str, str] = {}
    for key, path in sorted(newest.items()):
        width, first, partial, last = key
        record = json.loads(path.read_text(encoding="utf-8"))
        inputs[path.name] = file_digest(path)
        by_round = {r["rounds"]: r for r in record["rungs"]}
        anchor = first + partial  # the rung whose last round is the last partial one
        degrees: list[int] = []
        rounds = anchor
        while rounds in by_round and by_round[rounds].get("solving_degree") is not None:
            degrees.append(by_round[rounds]["solving_degree"])
            rounds += 1
        steps = [b - a for a, b in zip(degrees, degrees[1:])]
        cells.append({
            "cell": f"t{width} {first}f+{partial}p+{last}f",
            "width": width,
            "anchor_round": anchor,
            "trailing_degrees": degrees,
            "trailing_steps": steps,
            "drift": (degrees[-1] - degrees[0]) if degrees else None,
            "below_prediction": any(
                r.get("ideal_degree") is not None
                and r.get("predicted_degree") is not None
                and r["ideal_degree"] < r["predicted_degree"]
                for r in record["rungs"]
            ),
        })
    return cells, inputs


def evaluate_prereg_005(runs_dir: str | Path, prereg: PreRegistration) -> Outcome:
    """Apply PREREG-005's registered conditions and return the verdict.

    Every number the reading turns on is read out of the committed document:
    the coverage gate (``minimum_trailing_steps_per_cell``,
    ``minimum_covered_cells``, ``minimum_pooled_steps``) and the three
    thresholds (``drift_tolerance``, ``constant_mean_tolerance``,
    ``growth_mean_minimum``). The words are the document's too.
    """
    cells, inputs = trailing_runs(runs_dir, prereg)
    if not cells:
        raise OutcomeRefused(
            f"no ladder in {runs_dir} is a cell {prereg.prereg_id} registered, under "
            f"the {prereg.fields.get('encoding', 'sbox')!r} encoding; there is nothing to read"
        )

    min_steps = prereg.field_int("minimum_trailing_steps_per_cell")
    min_cells = prereg.field_int("minimum_covered_cells")
    min_pooled = prereg.field_int("minimum_pooled_steps")
    drift_tol = prereg.field_float("drift_tolerance")
    mean_tol = prereg.field_float("constant_mean_tolerance")
    growth_min = prereg.field_float("growth_mean_minimum")

    covered = [c for c in cells if len(c["trailing_steps"]) >= min_steps]
    widths = sorted({c["width"] for c in covered})
    pooled = [s for c in covered for s in c["trailing_steps"]]
    mean_step = sum(pooled) / len(pooled) if pooled else float("nan")
    max_drift = max((abs(c["drift"]) for c in covered), default=None)

    coverage = Condition(
        "minimum_coverage",
        len(covered) >= min_cells and len(widths) >= 2 and len(pooled) >= min_pooled,
        f"{len(covered)} covered cells of {len(cells)} read (registered minimum "
        f"{min_cells}, both widths required; widths covered {widths}); "
        f"{len(pooled)} pooled trailing steps against a registered minimum of {min_pooled}",
    )
    drift_ok = bool(covered) and all(abs(c["drift"]) <= drift_tol for c in covered)
    constant = Condition(
        "constant_condition",
        drift_ok and bool(pooled) and abs(mean_step) <= mean_tol,
        (f"largest |drift| across covered cells {max_drift} against a tolerance of "
         f"{drift_tol:g}; pooled mean trailing step {mean_step:+.3f} against a tolerance "
         f"of ±{mean_tol:g}") if covered else "no covered cell",
    )
    growth = Condition(
        "growth_condition",
        bool(pooled) and mean_step >= growth_min,
        (f"pooled mean trailing step {mean_step:+.3f} against a registered minimum of "
         f"{growth_min:+g}") if pooled else "no trailing steps",
    )
    breaks = [c["cell"] for c in cells if c["below_prediction"]]
    break_criterion = Condition(
        "break_criterion",
        False,
        f"clause 2 (a measured quantity below its prediction) holds in {len(breaks)} "
        "cells, so the criterion is met nowhere and no candidate was put to the L4 gates"
        + (f": {breaks}" if breaks else ""),
    )

    if not coverage.holds:
        verdict = "outcome-inconclusive"
    elif growth.holds:
        verdict = "outcome-grows"
    elif constant.holds:
        verdict = "outcome-constant"
    else:
        verdict = "outcome-drifts"

    deepest = max((c["anchor_round"] + len(c["trailing_steps"]) for c in covered), default=0)
    blindness = (
        f"the S-box encoding only, so PREREG-004's agreement between encodings is "
        f"assumed to extend and was not measured here; the solving degree is msolve's, "
        f"block 0, degrevlex, uncorroborated by a second implementation; "
        f"{len(cells) - len(covered)} of {len(cells)} registered cells read did not "
        f"reach {min_steps} trailing steps and say nothing; the deepest covered rung is "
        f"round {deepest}, and constancy or growth beyond it was never observable; "
        f"every instance is planted at a 30-bit prime; and a verdict over pooled steps "
        f"says nothing about why"
    )

    return Outcome(
        prereg_id=prereg.prereg_id,
        prereg_sha256=prereg.sha256,
        verdict=verdict,
        conditions=(coverage, constant, growth, break_criterion),
        statistics={
            "cells": cells,
            "covered": [c["cell"] for c in covered],
            "pooled_steps": len(pooled),
            "pooled_mean_step": round(mean_step, 4) if pooled else None,
            "max_abs_drift": max_drift,
            "deepest_covered_round": deepest,
        },
        inputs=inputs,
        blindness=blindness,
        vocabulary=outcome_vocabulary(prereg),
        negatives=outcome_negatives(prereg),
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
            and str(payload.get("kind", "")).startswith("outcome-")
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
    evaluators = {
        "PREREG-003": evaluate_prereg_003,
        "PREREG-004": evaluate_prereg_004,
        "PREREG-005": evaluate_prereg_005,
    }
    if prereg.prereg_id not in evaluators:
        raise OutcomeRefused(
            f"no evaluator for {prereg.prereg_id}; a document is discharged by "
            "code that applies its own registered criteria, never by a generic "
            "one that guesses what they meant"
        )
    outcome = evaluators[prereg.prereg_id](args.runs_dir, prereg)
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
