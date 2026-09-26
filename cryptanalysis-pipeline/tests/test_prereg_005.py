"""PREREG-005, the constant run: the reading is mechanical and can go against me.

No solver is invoked. Ladders are synthetic, shaped exactly as the sweep would
write them for the document's own cells, so each verdict word the document
fixed is shown to be reachable -- including the two I would not want.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import sweep as W  # noqa: E402
from outcome import (  # noqa: E402
    Outcome,
    OutcomeRefused,
    evaluate_prereg_005,
    record_outcome,
    trailing_runs,
)
from provenance import (  # noqa: E402
    ProvenanceRefused,
    ResultLog,
    load_prereg,
    outcome_negatives,
    outcome_vocabulary,
)

HERE = Path(__file__).resolve().parents[1]
PREREG_005 = HERE / "prereg" / "PREREG-005-constant-run.md"
PREREG_004 = HERE / "prereg" / "PREREG-004-encoding-control.md"
PREREG_003 = HERE / "prereg" / "PREREG-003-solving-degree.md"


def a_cell(width: int, first: int, partial: int, last: int, solving: list[int | None],
           encoding: str = "sbox", digest: str | None = None) -> dict:
    """A ladder as the sweep writes it for an explicit split. ``None`` in
    ``solving`` is a walled rung: present, but with no solving degree."""
    total = first + partial + last
    digest = digest or f"{width}{first}{partial}{last}".ljust(16, "0")
    return {
        "spec": f"spec=poseidon-like-t{width} digest={digest} p=1073741831 "
                f"width={width} d=3 rounds={total}({first}f+{partial}p+{last}f) capacity=1",
        "spec_digest": digest,
        "encoding": encoding,
        "rungs": [
            {"rounds": i + 1, "solving_degree": s, "ideal_degree": 3 ** (i + 1),
             "predicted_degree": 3 ** (i + 1), "status": "solved" if s is not None else "wall"}
            for i, s in enumerate(solving)
        ],
    }


def write_runs(tmp_path: Path, ladders: list[dict]) -> Path:
    runs = tmp_path / "runs"
    runs.mkdir(exist_ok=True)
    for i, ladder in enumerate(ladders):
        (runs / f"ladder-{ladder['spec_digest']}-{1000 + i}.json").write_text(
            json.dumps(ladder), encoding="utf-8"
        )
    return runs


def full_grid(profile) -> list[dict]:
    """All eighteen registered cells, each rung's solving degree given by
    ``profile(first, partial, last, round)``."""
    out = []
    for shape in W.shapes_from_prereg(load_prereg(PREREG_005)):
        total = shape.rounds_full + shape.rounds_partial
        solving = [profile(shape.first, shape.rounds_partial, shape.last, r)
                   for r in range(1, total + 1)]
        out.append(a_cell(shape.width, shape.first, shape.rounds_partial, shape.last, solving))
    return out


def constant_profile(first, partial, last, r):
    """Full rounds before the partial core raise the degree by 2; each partial
    round by 2; trailing full rounds add nothing. The shape PREREG-003 saw."""
    return 1 + 2 * (min(r, first + partial) - 1)


def growing_profile(first, partial, last, r):
    return 2 * r - 1


# -- the document ------------------------------------------------------------


def test_the_document_fixes_its_own_words_and_its_negative() -> None:
    doc = load_prereg(PREREG_005)
    assert outcome_vocabulary(doc) == ("outcome-constant", "outcome-grows", "outcome-drifts")
    assert outcome_negatives(doc) == ("outcome-constant",)


def test_the_grid_is_eighteen_explicit_splits() -> None:
    grid = W.shapes_from_prereg(load_prereg(PREREG_005))
    assert len(grid) == 18
    assert {s.width for s in grid} == {2, 3}
    assert all(s.rounds_full_first is not None for s in grid)
    assert W.Shape(2, 5, 1, rounds_full_first=1) in grid  # 1f+1p+4f
    assert min(s.last for s in grid) == 3
    assert max(s.rounds_full + s.rounds_partial for s in grid) == 8


def test_an_explicit_split_builds_the_spec_it_names() -> None:
    spec = W.spec_for(W.Shape(2, 5, 1, rounds_full_first=1), prime=1073741831)
    assert list(spec.round_kinds()) == ["full", "partial", "full", "full", "full", "full"]
    assert "rounds=6(1f+1p+4f)" in spec.render()


def test_the_even_split_grammar_is_unchanged() -> None:
    """PREREG-002's grid and labels are what the chain records were made under."""
    grid = W.shapes_from_prereg(load_prereg(W.PREREG_PATH))
    assert len(grid) == 14
    assert all(s.rounds_full_first is None for s in grid)
    assert grid[0].label() == "t2-f2-p1"


def test_the_preview_takes_a_document(capsys) -> None:
    assert W.main(["--preview", "--prereg", str(PREREG_005)]) == 0
    out = capsys.readouterr().out
    assert "prereg=PREREG-005" in out
    assert "t3-1f1p6f rounds=8 split=1f+1p+6f" in out


# -- the four readings -------------------------------------------------------


def test_a_flat_trailing_run_reads_as_constant(tmp_path: Path) -> None:
    runs = write_runs(tmp_path, full_grid(constant_profile))
    outcome = evaluate_prereg_005(runs, load_prereg(PREREG_005))
    assert outcome.verdict == "outcome-constant"
    by_name = {c.name: c for c in outcome.conditions}
    assert by_name["minimum_coverage"].holds
    assert by_name["constant_condition"].holds
    assert not by_name["growth_condition"].holds
    assert not by_name["break_criterion"].holds
    assert outcome.statistics["pooled_mean_step"] == 0.0
    assert outcome.statistics["max_abs_drift"] == 0
    assert len(outcome.statistics["covered"]) == 18
    assert "outcome-constant" in outcome.negatives


def test_a_growing_trailing_run_reads_as_grows(tmp_path: Path) -> None:
    """The outcome that would say PREREG-003's structure was short-range."""
    runs = write_runs(tmp_path, full_grid(growing_profile))
    outcome = evaluate_prereg_005(runs, load_prereg(PREREG_005))
    assert outcome.verdict == "outcome-grows"
    assert outcome.statistics["pooled_mean_step"] == 2.0


def test_a_slow_uneven_drift_licenses_nothing(tmp_path: Path) -> None:
    """Degree creeps by one every other trailing round: neither flat within
    tolerance nor a round's worth per step. Recorded as drifts, and the
    document says that word licenses nothing."""
    def creeping(first, partial, last, r):
        anchor = first + partial
        return constant_profile(first, partial, last, r) + (max(0, r - anchor) // 2)

    runs = write_runs(tmp_path, full_grid(creeping))
    outcome = evaluate_prereg_005(runs, load_prereg(PREREG_005))
    assert outcome.verdict == "outcome-drifts"
    by_name = {c.name: c for c in outcome.conditions}
    assert by_name["minimum_coverage"].holds
    assert not by_name["constant_condition"].holds
    assert not by_name["growth_condition"].holds


def test_walls_before_coverage_make_the_run_inconclusive(tmp_path: Path) -> None:
    """Every cell walls after two trailing rungs. The question was not
    answered, and the record says so rather than reading the two steps."""
    def walled(first, partial, last, r):
        anchor = first + partial
        return None if r > anchor + 2 else constant_profile(first, partial, last, r)

    runs = write_runs(tmp_path, full_grid(walled))
    outcome = evaluate_prereg_005(runs, load_prereg(PREREG_005))
    assert outcome.verdict == "outcome-inconclusive"
    assert not next(c for c in outcome.conditions if c.name == "minimum_coverage").holds
    assert outcome.statistics["covered"] == []
    assert "did not reach 3 trailing steps" in outcome.blindness


def test_one_width_alone_is_not_coverage(tmp_path: Path) -> None:
    """Both widths must be represented. Nine covered cells at width 2 and
    walls at width 3 do not read."""
    def width3_walls(shape):
        return shape.width == 3

    ladders = []
    for shape in W.shapes_from_prereg(load_prereg(PREREG_005)):
        total = shape.rounds_full + shape.rounds_partial
        anchor = shape.first + shape.rounds_partial
        solving = [
            None if width3_walls(shape) and r > anchor else
            constant_profile(shape.first, shape.rounds_partial, shape.last, r)
            for r in range(1, total + 1)
        ]
        ladders.append(a_cell(shape.width, shape.first, shape.rounds_partial, shape.last, solving))
    outcome = evaluate_prereg_005(write_runs(tmp_path, ladders), load_prereg(PREREG_005))
    assert outcome.verdict == "outcome-inconclusive"
    assert "widths covered [2]" in outcome.conditions[0].detail


def test_a_single_drifting_cell_denies_constant(tmp_path: Path) -> None:
    """``outcome_constant`` is over every covered cell. One cell whose degree
    climbs by two across its run is enough to withhold the word, even though
    the pooled mean stays inside tolerance."""
    ladders = full_grid(constant_profile)
    victim = ladders[3]  # t2 1f+1p+6f: the longest run at width 2
    for rung in victim["rungs"]:
        if rung["rounds"] >= 7:
            rung["solving_degree"] += 2
    outcome = evaluate_prereg_005(write_runs(tmp_path, ladders), load_prereg(PREREG_005))
    assert outcome.verdict == "outcome-drifts"
    assert outcome.statistics["max_abs_drift"] == 2
    assert abs(outcome.statistics["pooled_mean_step"]) < 0.25


# -- what the evaluator refuses to read --------------------------------------


def test_only_registered_cells_are_read(tmp_path: Path) -> None:
    """A PREREG-002 ladder in the same directory is not PREREG-005 evidence,
    and neither is a registered shape under the other encoding."""
    ladders = full_grid(constant_profile)
    ladders.append(a_cell(2, 1, 1, 1, [1, 3, 3], digest="prereg002cell000"))      # 2f+1p, even split
    ladders.append(a_cell(2, 1, 1, 4, [1, 3, 9, 9, 9, 9], encoding="state",
                          digest="statecell0000000"))
    runs = write_runs(tmp_path, ladders)
    cells, inputs = trailing_runs(runs, load_prereg(PREREG_005))
    assert len(cells) == 18
    assert not any("prereg002cell000" in name or "statecell" in name for name in inputs)


def test_nothing_registered_refuses_rather_than_guessing(tmp_path: Path) -> None:
    runs = write_runs(tmp_path, [a_cell(2, 1, 1, 1, [1, 3, 3], digest="prereg002cell000")])
    with pytest.raises(OutcomeRefused) as excinfo:
        evaluate_prereg_005(runs, load_prereg(PREREG_005))
    assert "nothing to read" in str(excinfo.value)


def test_the_thresholds_come_from_the_document(tmp_path: Path) -> None:
    """Tighten the document's mean tolerance to zero and a run with one +1
    step stops being constant. The number is the document's, not the code's."""
    doc = load_prereg(PREREG_005)
    ladders = full_grid(constant_profile)
    ladders[0]["rungs"][-1]["solving_degree"] += 1
    runs = write_runs(tmp_path, ladders)
    assert evaluate_prereg_005(runs, doc).verdict == "outcome-constant"

    from provenance import PreRegistration
    strict = PreRegistration(
        path=doc.path, text=doc.text,
        fields={**doc.fields, "constant_mean_tolerance": "0"},
    )
    assert evaluate_prereg_005(runs, strict).verdict == "outcome-drifts"


# -- the vocabulary belongs to the document ----------------------------------


def test_a_word_from_another_document_is_refused() -> None:
    """PREREG-004's ``outcome-survives`` is not a PREREG-005 word."""
    doc = load_prereg(PREREG_005)
    with pytest.raises(OutcomeRefused) as excinfo:
        Outcome(
            prereg_id=doc.prereg_id, prereg_sha256=doc.sha256, verdict="outcome-survives",
            conditions=(), statistics={}, vocabulary=outcome_vocabulary(doc),
        )
    assert "PREREG-005 defines" in str(excinfo.value)


def test_prereg_004_words_are_read_from_its_own_fields() -> None:
    assert outcome_vocabulary(load_prereg(PREREG_004)) == (
        "outcome-survives", "outcome-vanishes", "outcome-reverses",
    )
    assert outcome_negatives(load_prereg(PREREG_004)) == ()


def test_prereg_003_has_no_words() -> None:
    assert outcome_vocabulary(load_prereg(PREREG_003)) == ()


def test_the_declared_negative_owes_blindness(tmp_path: Path) -> None:
    doc = load_prereg(PREREG_005)
    bare = Outcome(
        prereg_id=doc.prereg_id, prereg_sha256=doc.sha256, verdict="outcome-constant",
        conditions=(), statistics={}, vocabulary=outcome_vocabulary(doc),
        negatives=outcome_negatives(doc),
    )
    with pytest.raises(ProvenanceRefused) as excinfo:
        bare.to_record(("msolve/0.6.5",))
    assert "negative" in str(excinfo.value) and "blindness" in str(excinfo.value)


def test_the_record_names_prereg_005_and_is_discharged_once(tmp_path: Path) -> None:
    runs = write_runs(tmp_path, full_grid(constant_profile))
    doc = load_prereg(PREREG_005)
    outcome = evaluate_prereg_005(runs, doc)
    record = outcome.to_record(("msolve/0.6.5-1build2", "singular/1:4.3.2"))
    assert record["kind"] == "outcome-constant"
    assert record["prereg_id"] == "PREREG-005"
    assert record["prereg_sha256"] == doc.sha256
    assert [c["name"] for c in record["conditions"]] == [
        "minimum_coverage", "constant_condition", "growth_condition", "break_criterion",
    ]
    assert len(record["inputs"]) == 18

    log_path = tmp_path / "log.jsonl"
    versions = ("msolve/0.6.5-1build2", "singular/1:4.3.2")
    record_outcome(outcome, log_path, versions)
    assert ResultLog(log_path).verify()[0]
    with pytest.raises(ProvenanceRefused, match="discharged once"):
        record_outcome(outcome, log_path, versions)


def test_the_committed_runs_hold_no_prereg_005_cell() -> None:
    """Nothing in runs/ is a PREREG-005 cell yet: the document precedes every
    run it governs, which is the whole ordering claim."""
    cells, inputs = trailing_runs(HERE / "runs", load_prereg(PREREG_005))
    assert cells == [] and inputs == {}
