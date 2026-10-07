"""Tests for closing out a pre-registration.

The point of an outcome record is that applying a pre-registered reading is
mechanical. So the tests that matter are the ones showing the machinery can
return a verdict I did not want: vanishes, reverses, inconclusive. A criterion
that can only pass is not a criterion.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from outcome import (  # noqa: E402
    Condition,
    Outcome,
    OutcomeRefused,
    evaluate_prereg_004,
    record_outcome,
    round_kind_changes,
)
from provenance import OUTCOME_KINDS, ProvenanceRefused, ResultLog, load_prereg  # noqa: E402

PREREG_004 = (
    Path(__file__).resolve().parents[1] / "prereg" / "PREREG-004-encoding-control.md"
)
RUNS = Path(__file__).resolve().parents[1] / "runs"


def a_ladder(encoding: str, digest: str, solving: list[int], rounds_full: int = 4,
             rounds_partial: int = 1, width: int = 2) -> dict:
    inner = f"{rounds_full // 2}f+{rounds_partial}p+{rounds_full - rounds_full // 2}f"
    total = rounds_full + rounds_partial
    return {
        "spec": f"spec=poseidon-like-t{width} digest={digest} p=1073741831 "
                f"width={width} d=3 rounds={total}({inner}) capacity=1",
        "spec_digest": digest,
        "encoding": encoding,
        "rungs": [
            {"rounds": i + 1, "solving_degree": s, "ideal_degree": 3 ** (i + 1)}
            for i, s in enumerate(solving)
        ],
    }


def write_runs(tmp_path: Path, ladders: list[dict]) -> Path:
    runs = tmp_path / "runs"
    runs.mkdir()
    for i, ladder in enumerate(ladders):
        (runs / f"ladder-{ladder['spec_digest']}-{1000 + i}.json").write_text(
            json.dumps(ladder), encoding="utf-8"
        )
    return runs


# -- the real grid -----------------------------------------------------------


def test_the_committed_grid_reads_as_survives() -> None:
    """The verdict on the real runs, computed rather than asserted."""
    outcome = evaluate_prereg_004(RUNS, load_prereg(PREREG_004))
    assert outcome.verdict == "outcome-survives"
    assert all(c.holds for c in outcome.conditions)
    assert outcome.prereg_sha256 == load_prereg(PREREG_004).sha256


def test_the_outcome_cites_its_inputs_by_content_hash() -> None:
    """The solving degrees for these runs live in the ladder JSON, not in the
    chained payload, so an outcome over them addresses the files or it
    addresses nothing."""
    outcome = evaluate_prereg_004(RUNS, load_prereg(PREREG_004))
    assert outcome.inputs
    for name, digest in outcome.inputs.items():
        assert name.startswith("ladder-") and name.endswith(".json")
        assert len(digest) == 64


# -- the verdicts I did not want ---------------------------------------------


def test_too_few_steps_is_inconclusive_not_an_outcome(tmp_path: Path) -> None:
    """Below the registered minimum the means are not worth comparing, and the
    document says so before the run rather than after it."""
    runs = write_runs(tmp_path, [
        a_ladder("state", "aaa1", [1, 3, 5, 7]),
        a_ladder("state", "aaa2", [1, 3, 5, 7], rounds_full=2, rounds_partial=2),
    ])
    outcome = evaluate_prereg_004(runs, load_prereg(PREREG_004))
    assert outcome.verdict == "outcome-inconclusive"
    assert not next(c for c in outcome.conditions if c.name == "minimum_steps").holds


def mixed_grid(tag: str, partial_heavy: list[int], full_heavy: list[int]) -> list[dict]:
    """Five ladders of each shape, so both round kinds clear the 15-step minimum.

    Shape A (2f+3p+2f) runs f,p,p,p,f and contributes three partial steps and
    one full; shape B (2f+1p+2f) runs f,f,p,f,f and contributes the reverse.
    Five of each gives 20 steps of each kind.
    """
    out = []
    for i in range(5):
        out.append(a_ladder("state", f"{tag}a{i}", partial_heavy,
                            rounds_full=2, rounds_partial=3))
        out.append(a_ladder("state", f"{tag}b{i}", full_heavy,
                            rounds_full=4, rounds_partial=1))
    return out


def test_a_lost_separation_reads_as_vanishes(tmp_path: Path) -> None:
    """The outcome that would have retracted the lead. Written down first, so
    recording it costs nothing.

    Every step changes the degree by +1 whatever kind of round was added, so
    the means coincide and the separation is gone.
    """
    ladders = mixed_grid("flat", [1, 2, 3, 4, 5], [1, 2, 3, 4, 5])
    outcome = evaluate_prereg_004(write_runs(tmp_path, ladders), load_prereg(PREREG_004))
    assert outcome.verdict == "outcome-vanishes"
    assert next(c for c in outcome.conditions if c.name == "minimum_steps").holds
    assert not next(c for c in outcome.conditions if c.name == "mean_gap").holds


def test_a_reversal_is_its_own_verdict(tmp_path: Path) -> None:
    """Full rounds raising the degree more than partial ones means the two
    encodings disagree about the cipher, and neither measurement may be used.

    Every full round adds +6 here and every partial round subtracts 2, which is
    the observed pattern turned inside out.
    """
    ladders = mixed_grid("rev", [10, 8, 6, 4, 10], [10, 16, 14, 20, 26])
    outcome = evaluate_prereg_004(write_runs(tmp_path, ladders), load_prereg(PREREG_004))
    assert outcome.verdict == "outcome-reverses"
    assert outcome.statistics["state/partial"]["mean"] < 0
    assert outcome.statistics["state/full"]["mean"] > 0


def test_no_steps_of_a_kind_refuses_rather_than_guessing(tmp_path: Path) -> None:
    runs = write_runs(tmp_path, [a_ladder("state", "one", [1])])
    with pytest.raises(OutcomeRefused) as excinfo:
        evaluate_prereg_004(runs, load_prereg(PREREG_004))
    assert "nothing to read" in str(excinfo.value)


# -- the record --------------------------------------------------------------


def test_a_verdict_word_must_be_one_the_document_defines() -> None:
    """A verdict chosen at writing time is not a pre-registered reading."""
    with pytest.raises(OutcomeRefused) as excinfo:
        Outcome(
            prereg_id="PREREG-004", prereg_sha256="a" * 64, verdict="looks-promising",
            conditions=(), statistics={},
        )
    assert "not one of the verdict words" in str(excinfo.value)
    # PREREG-004's three readings, its inconclusive gate, and the kind used for
    # a document that fixed no verdict vocabulary at all.
    assert set(OUTCOME_KINDS) == {
        "outcome-survives", "outcome-vanishes", "outcome-reverses",
        "outcome-inconclusive", "outcome-unworded",
    }


def test_a_negative_verdict_owes_a_blindness_statement() -> None:
    """outcome-vanishes retracts a lead; it is a negative like any other."""
    bare = Outcome(
        prereg_id="PREREG-004", prereg_sha256="a" * 64, verdict="outcome-vanishes",
        conditions=(Condition("mean_gap", False, "gap +0.1"),), statistics={},
    )
    with pytest.raises(ProvenanceRefused) as excinfo:
        bare.to_record(("msolve/0.6.5",))
    assert "blindness" in str(excinfo.value)


def test_the_record_names_its_own_pre_registration(tmp_path: Path) -> None:
    """The gap this closes: every ladder record in the chain names PREREG-002,
    because the sweep stamps the document it reads its grid from. The outcome
    record is the first thing to reference PREREG-004."""
    outcome = evaluate_prereg_004(RUNS, load_prereg(PREREG_004))
    record = outcome.to_record(("msolve/0.6.5-1build2", "singular/1:4.3.2"))
    assert record["prereg_id"] == "PREREG-004"
    assert record["prereg_sha256"] == load_prereg(PREREG_004).sha256
    assert record["kind"] == "outcome-survives"
    assert [c["name"] for c in record["conditions"]] == [
        "minimum_steps", "mean_gap", "minimum_above_full_mean"
    ]


def test_a_pre_registration_is_discharged_once(tmp_path: Path) -> None:
    """Two outcome records over the same inputs would read as two independent
    readings agreeing, when there was one reading recorded twice."""
    log_path = tmp_path / "log.jsonl"
    outcome = evaluate_prereg_004(RUNS, load_prereg(PREREG_004))
    versions = ("msolve/0.6.5-1build2", "singular/1:4.3.2")
    record_outcome(outcome, log_path, versions)
    assert ResultLog(log_path).verify()[0]
    with pytest.raises(ProvenanceRefused) as excinfo:
        record_outcome(outcome, log_path, versions)
    assert "discharged once" in str(excinfo.value)


def test_the_statistics_cover_both_encodings() -> None:
    outcome = evaluate_prereg_004(RUNS, load_prereg(PREREG_004))
    assert "state/partial" in outcome.statistics
    assert "sbox/partial" in outcome.statistics
    assert outcome.statistics["state/partial"]["min"] >= 2


# -- PREREG-003, which fixed no verdict vocabulary ---------------------------

PREREG_003 = (
    Path(__file__).resolve().parents[1] / "prereg" / "PREREG-003-solving-degree.md"
)


def test_a_document_that_fixed_no_verdict_word_gets_none() -> None:
    """PREREG-003 named three criteria and never defined a word for the
    result. Choosing one at discharge time is the after-the-fact naming this
    layer exists to prevent, so the record says so instead."""
    from outcome import evaluate_prereg_003

    outcome = evaluate_prereg_003(RUNS, load_prereg(PREREG_003))
    assert outcome.verdict == "outcome-unworded"
    assert "fixed no verdict vocabulary" in outcome.blindness


def test_prereg_003_criteria_are_evaluated_not_asserted() -> None:
    """Each criterion carries the value that decided it, computed from the run
    files rather than read off a printout."""
    from outcome import evaluate_prereg_003

    outcome = evaluate_prereg_003(RUNS, load_prereg(PREREG_003))
    by_name = {c.name: c for c in outcome.conditions}
    assert not by_name["model_criterion"].holds
    assert "0 of 11" in by_name["model_criterion"].detail
    assert by_name["structure_criterion"].holds
    assert not by_name["break_criterion"].holds
    assert outcome.statistics["break_cells"] == []


def test_the_fitted_cell_is_excluded_from_the_out_of_sample_test() -> None:
    """A model tested on the data it was fitted to is not tested. PREREG-003
    discloses which cell that was; the evaluator honours the exclusion."""
    from outcome import FITTED_CELL, evaluate_prereg_003

    outcome = evaluate_prereg_003(RUNS, load_prereg(PREREG_003))
    assert FITTED_CELL == ("sbox", 2, 4, 3)
    assert "t2 4f+3p" not in outcome.statistics["model_tested"]
    assert len(outcome.statistics["model_tested"]) == 11


def test_the_unworded_kind_still_owes_blindness() -> None:
    from outcome import Outcome

    bare = Outcome(
        prereg_id="PREREG-003", prereg_sha256="a" * 64, verdict="outcome-unworded",
        conditions=(), statistics={},
    )
    with pytest.raises(ProvenanceRefused):
        bare.to_record(("msolve/0.6.5",))
