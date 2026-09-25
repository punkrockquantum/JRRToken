"""Tests for L5.

Every one of these asserts a refusal. That is the shape of the layer: it adds
no capability, it removes the ability to record a misleading number, so the
only thing worth testing is that the refusals fire.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from provenance import (  # noqa: E402
    GENESIS,
    MODEL,
    ChainRecord,
    ProvenanceRefused,
    ResultLog,
    Tier,
    TierViolation,
    assert_all_exhausted,
    canonical,
    load_prereg,
    mint_record,
    record_hash,
    regenerate,
    tier_of_rung,
)

PREREG = Path(__file__).resolve().parents[1] / "prereg" / "PREREG-001-mimc-sponge-cico.md"


def a_record(**overrides) -> dict:
    base = dict(
        kind="ladder",
        spec_digest="deadbeefdeadbeef",
        solver_versions=("msolve/0.6.5", "Singular/4.3.2"),
        prereg_sha256="a" * 64,
    )
    base.update(overrides)
    return mint_record(**base)


# -- tiers -------------------------------------------------------------------


def test_tiers_do_not_compare() -> None:
    """A proof is not a bigger number than a sample."""
    with pytest.raises(TierViolation):
        _ = Tier.P > Tier.S
    with pytest.raises(TierViolation):
        _ = sorted([Tier.S, Tier.E])


def test_a_fitted_model_is_not_a_tier() -> None:
    """MODEL is a string, not a Tier member, so it cannot be passed where a
    tier is required. The substitution the prose forbids is refused by types."""
    assert MODEL not in {t.value for t in Tier}
    with pytest.raises(ValueError):
        Tier(MODEL)


def test_a_decisive_status_without_the_observable_is_not_tier_e() -> None:
    """The failure this encodes really happened: rungs 7 and 8 of an early
    ladder reported status=solved with ideal_degree=None and seconds equal to
    the timeout -- a wall reported as a measurement."""
    assert tier_of_rung("solved", None, no_solution="no-solution") is None
    assert tier_of_rung("solved", 27, no_solution="no-solution") is Tier.E


def test_an_empty_variety_is_a_measurement() -> None:
    """Degree zero is the observable, not the absence of one."""
    assert tier_of_rung("no-solution", None, no_solution="no-solution") is Tier.E


def test_a_curve_may_not_be_fitted_through_an_unmeasured_point() -> None:
    assert_all_exhausted([Tier.E, Tier.E, Tier.E], "exponential fit")
    with pytest.raises(TierViolation) as excinfo:
        assert_all_exhausted([Tier.E, None, Tier.E], "exponential fit")
    assert "model of a model" in str(excinfo.value)
    with pytest.raises(TierViolation):
        assert_all_exhausted([Tier.E, Tier.S], "exponential fit")


# -- the chain ---------------------------------------------------------------


def test_the_chain_verifies_and_the_head_advances(tmp_path: Path) -> None:
    log = ResultLog(tmp_path / "results.jsonl")
    assert log.head == GENESIS
    first = log.append(a_record(payload={"rounds": 1}))
    second = log.append(a_record(payload={"rounds": 2}))
    assert second.prev_hash == first.hash
    assert log.head == second.hash
    ok, detail = log.verify()
    assert ok, detail
    assert "2 records" in detail


def test_a_revised_record_breaks_every_record_after_it(tmp_path: Path) -> None:
    """The log cannot stop a line being edited. It stops an edited line being
    usable, which is the property that is actually available."""
    path = tmp_path / "results.jsonl"
    log = ResultLog(path)
    log.append(a_record(payload={"rounds": 1, "ideal_degree": 3}))
    log.append(a_record(payload={"rounds": 2, "ideal_degree": 9}))
    log.append(a_record(payload={"rounds": 3, "ideal_degree": 27}))
    assert log.verify()[0]

    lines = path.read_text(encoding="utf-8").splitlines()
    tampered = json.loads(lines[1])
    tampered["payload"]["ideal_degree"] = 8  # a deviation that never happened
    lines[1] = canonical(tampered)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    ok, detail = log.verify()
    assert not ok
    assert "record 1 fails" in detail
    assert "Every record after this one is unusable too." in detail


def test_a_broken_chain_refuses_to_be_extended(tmp_path: Path) -> None:
    path = tmp_path / "results.jsonl"
    log = ResultLog(path)
    log.append(a_record(payload={"rounds": 1}))
    forged = ChainRecord(seq=1, prev_hash=GENESIS, payload={"kind": "x"}, hash="0" * 64)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(canonical(forged.to_dict()) + "\n")
    with pytest.raises(ProvenanceRefused) as excinfo:
        log.append(a_record(payload={"rounds": 2}))
    assert "will not be extended" in str(excinfo.value)


def test_a_rehashed_record_still_fails_because_the_links_are_checked(tmp_path: Path) -> None:
    """Recomputing the tampered record's own hash is not enough: seq and
    prev_hash are part of what is hashed, so the following record's prev_hash
    no longer matches."""
    path = tmp_path / "results.jsonl"
    log = ResultLog(path)
    log.append(a_record(payload={"rounds": 1}))
    log.append(a_record(payload={"rounds": 2}))
    lines = path.read_text(encoding="utf-8").splitlines()
    tampered = json.loads(lines[0])
    tampered["payload"]["rounds"] = 99
    tampered["hash"] = record_hash(0, GENESIS, tampered["payload"])
    lines[0] = canonical(tampered)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    ok, detail = log.verify()
    assert not ok
    assert "record 1 fails" in detail


def test_a_log_line_that_is_not_json_names_its_line_number(tmp_path: Path) -> None:
    path = tmp_path / "results.jsonl"
    log = ResultLog(path)
    log.append(a_record(payload={"rounds": 1}))
    with path.open("a", encoding="utf-8") as handle:
        handle.write("not json at all\n")
    with pytest.raises(ProvenanceRefused) as excinfo:
        log.records()
    assert ":2 is not valid JSON" in str(excinfo.value)


def test_a_structurally_invalid_record_also_names_its_line(tmp_path: Path) -> None:
    """Valid JSON that is not a record. The first version of the test above
    used this as its line 1 and so never reached line 2 -- the line-number
    error it was asserting was raised by neither line."""
    path = tmp_path / "results.jsonl"
    path.write_text('{"seq": 0}\n', encoding="utf-8")
    with pytest.raises(ProvenanceRefused) as excinfo:
        ResultLog(path).records()
    message = str(excinfo.value)
    assert ":1 " in message
    assert "prev_hash" in message


# -- minting -----------------------------------------------------------------


def test_a_record_without_solver_versions_is_refused() -> None:
    with pytest.raises(ProvenanceRefused) as excinfo:
        a_record(solver_versions=())
    assert "cannot be re-run" in str(excinfo.value)


def test_a_record_without_a_prereg_is_refused() -> None:
    with pytest.raises(ProvenanceRefused) as excinfo:
        a_record(prereg_sha256="")
    assert "before the measurement" in str(excinfo.value)


def test_every_negative_needs_a_blindness_statement() -> None:
    for kind in ("no-deviation", "wall", "no-solution", "structure"):
        with pytest.raises(ProvenanceRefused) as excinfo:
            a_record(kind=kind)
        assert "blindness" in str(excinfo.value)
        minted = a_record(kind=kind, blindness="rounds beyond 7 were never reached")
        assert minted["blindness"] == "rounds beyond 7 were never reached"


def test_a_payload_cannot_overwrite_its_own_provenance() -> None:
    with pytest.raises(ProvenanceRefused) as excinfo:
        a_record(payload={"solver_versions": ["a-solver-that-did-not-run"]})
    assert "overwrite provenance fields" in str(excinfo.value)


# -- pre-registration --------------------------------------------------------


def test_the_prereg_fixes_every_required_field() -> None:
    prereg = load_prereg(PREREG)
    assert prereg.prereg_id == "PREREG-001"
    assert prereg.field_int("max_rounds") == 14
    assert prereg.field_float("timeout_seconds") == 900.0
    assert len(prereg.sha256) == 64


def test_the_prereg_states_the_prediction_it_will_be_measured_against() -> None:
    """The break criterion must be readable before the run, not inferred from
    it. `3^r` is in the document, so a rung below it is a deviation by a rule
    that was fixed in advance."""
    prereg = load_prereg(PREREG)
    assert "3^r" in prereg.fields["prediction"]
    assert "vdim" in prereg.fields["observable"]


def test_a_multi_line_field_is_read_whole() -> None:
    """The four break criteria are indented list items under the field. A
    parser that stops at the first newline reads the criterion as "all four,
    and any one missing means no break is claimed" with the four criteria
    themselves dropped -- a pre-registration that pre-registers nothing."""
    criterion = load_prereg(PREREG).fields["break_criterion"]
    assert "ideal_degree < 3^r" in criterion
    assert "solvers_agree" in criterion
    assert "all three L4 gates" in criterion


def test_a_prereg_missing_a_field_is_refused(tmp_path: Path) -> None:
    partial = tmp_path / "PREREG-bad.md"
    partial.write_text("- `prereg_id`: PREREG-999\n", encoding="utf-8")
    with pytest.raises(ProvenanceRefused) as excinfo:
        load_prereg(partial)
    assert "break_criterion" in str(excinfo.value)


def test_an_uncommitted_prereg_cannot_stamp_a_run(tmp_path: Path) -> None:
    """The failure that invalidated all seven runs of the sibling project: the
    document a run named had been edited after the run referenced it."""
    repo_copy = PREREG.parent / "PREREG-999-uncommitted-scratch.md"
    repo_copy.write_text(PREREG.read_text(encoding="utf-8"), encoding="utf-8")
    try:
        with pytest.raises(ProvenanceRefused) as excinfo:
            load_prereg(repo_copy).assert_committed()
        message = str(excinfo.value)
        assert "uncommitted changes" in message or "not in the history" in message
    finally:
        repo_copy.unlink()


def test_the_committed_prereg_stamps_a_run() -> None:
    """Passes only once PREREG-001 is in the history, which is the ordering
    claim: the document precedes every run that names it."""
    commit = load_prereg(PREREG).assert_committed()
    assert len(commit) == 40


# -- regeneration ------------------------------------------------------------


def test_regeneration_compares_bytes_and_names_the_offset(tmp_path: Path) -> None:
    target = tmp_path / "table.json"
    target.write_text('{"a": 1}', encoding="utf-8")
    ok, detail = regenerate(target, lambda: '{"a": 1}')
    assert ok, detail
    ok, detail = regenerate(target, lambda: '{"a": 2}')
    assert not ok
    assert "at byte 6" in detail


def test_a_truncated_regeneration_is_not_a_match(tmp_path: Path) -> None:
    target = tmp_path / "table.json"
    target.write_text('{"a": 1, "b": 2}', encoding="utf-8")
    ok, detail = regenerate(target, lambda: '{"a": 1')
    assert not ok
    assert "prefix" in detail


def test_a_missing_artefact_is_not_a_silent_pass(tmp_path: Path) -> None:
    ok, detail = regenerate(tmp_path / "absent.json", lambda: "")
    assert not ok
    assert "nothing to regenerate" in detail


# -- L5 wired into L3 --------------------------------------------------------
#
# These build Ladder and Rung objects directly. No solver is invoked, which is
# deliberate: the record-keeping must be checkable without a 900-second run,
# and a test that needs Singular is a test nobody runs before committing.

from ladder import Ladder, Rung  # noqa: E402
from solvers import SOLVED, WALL  # noqa: E402


def rung(rounds: int, ideal: int | None, status: str = SOLVED, seconds: float = 1.0) -> Rung:
    return Rung(
        rounds=rounds,
        n_variables=rounds + 1,
        n_equations=rounds + 1,
        status=status,
        seconds=seconds,
        peak_memory_mb=10.0,
        ideal_degree=ideal,
        max_degree=3,
        basis_size=2,
        matrix_cells=None,
        predicted_degree=3**rounds,
        rational_solutions=None,
        solvers_agree=True,
    )


def ladder_of(*rungs: Rung, planted: bool = True, wall_at: int | None = None,
              contended: tuple[int, ...] = ()) -> Ladder:
    return Ladder(
        spec_render="spec=test digest=abcd1234abcd1234",
        spec_digest="abcd1234abcd1234",
        problem_render="cico test",
        rungs=rungs,
        validation_passed=True,
        roundtrip_passed=True,
        wall_at=wall_at,
        planted=planted,
        contended_rounds=contended,
        solver_versions=("msolve/0.6.5", "Singular/4.3.2"),
    )


def test_the_committed_record_carries_the_facts_that_decide_scope() -> None:
    """Both of these were printed by render() and absent from to_json(), so the
    artefact a reader actually gets omitted the two facts that govern what the
    numbers beside them may be used for."""
    record = json.loads(
        ladder_of(rung(1, 3), rung(2, 9), planted=True, contended=(2,)).to_json()
    )
    assert record["planted"] is True
    assert record["contended_rounds"] == [2]
    assert record["rung_tiers"] == {"1": "E", "2": "E"}
    assert record["growth_model_tier"] == MODEL


def test_a_rung_without_its_observable_is_tier_dash_in_the_record() -> None:
    record = json.loads(ladder_of(rung(1, 3), rung(2, None, status=WALL)).to_json())
    assert record["rung_tiers"] == {"1": "E", "2": "-"}


def test_the_record_kind_follows_the_pre_registered_criteria() -> None:
    reached = ladder_of(rung(1, 3), rung(2, 9), rung(3, 27))
    assert reached.record_kind == "no-deviation"
    walled = ladder_of(rung(1, 3), rung(2, None, status=WALL), wall_at=2)
    assert walled.record_kind == "wall"
    # A deviation is the finding whether or not the ladder later walled.
    deviated = ladder_of(rung(1, 3), rung(2, 8), rung(3, None, status=WALL), wall_at=3)
    assert deviated.deviations[0].rounds == 2
    assert deviated.record_kind == "deviation"


def test_the_blindness_statement_is_written_from_the_run() -> None:
    """Not a template. It names this ladder's highest closed round, and its
    planted and contended facts, so a reader cannot skip it as boilerplate."""
    blindness = ladder_of(
        rung(1, 3), rung(2, 9), rung(3, None, status=WALL),
        wall_at=3, planted=True, contended=(2,),
    ).blindness()
    assert "rounds above 2 were never closed" in blindness
    assert "planted" in blindness
    assert "rounds [2] were measured while another solver was running" in blindness


def test_an_unplanted_uncontended_ladder_says_less_about_its_blindness() -> None:
    blindness = ladder_of(rung(1, 3), rung(2, 9), planted=False).blindness()
    assert "planted" not in blindness
    assert "another solver" not in blindness
    assert "degree collapse" in blindness


def test_the_ladder_record_passes_through_the_l5_mint() -> None:
    prereg = load_prereg(PREREG)
    record = ladder_of(rung(1, 3), rung(2, 9)).to_record(prereg)
    assert record["kind"] == "no-deviation"
    assert record["prereg_sha256"] == prereg.sha256
    assert record["blindness"]
    assert record["ideal_degrees"] == {"1": 3, "2": 9}
    assert record["highest_closed_round"] == 2


def test_a_ladder_with_no_solvers_cannot_be_recorded() -> None:
    """The mint refusal reaches the ladder: a run that recorded no solver
    version cannot be logged, because the version is part of the claim."""
    bare = Ladder(
        spec_render="spec=test", spec_digest="abcd", problem_render="cico",
        rungs=(rung(1, 3),), validation_passed=True, roundtrip_passed=True,
        wall_at=None, planted=False, solver_versions=(),
    )
    with pytest.raises(ProvenanceRefused) as excinfo:
        bare.to_record(load_prereg(PREREG))
    assert "cannot be re-run" in str(excinfo.value)


def test_saving_appends_to_the_chain_and_verifies(tmp_path: Path) -> None:
    from ladder import save

    prereg = load_prereg(PREREG)
    first = save(ladder_of(rung(1, 3), rung(2, 9)), tmp_path, prereg=prereg)
    assert first.exists()
    log = ResultLog(tmp_path / "log.jsonl")
    ok, detail = log.verify()
    assert ok, detail
    assert log.records()[0].payload["kind"] == "no-deviation"


def test_saving_without_a_prereg_leaves_the_chain_untouched(tmp_path: Path) -> None:
    """A record naming no pre-registration is refused at mint time, so the
    chain is not started at all rather than started with a record that could
    never be extended."""
    from ladder import save

    save(ladder_of(rung(1, 3)), tmp_path)
    assert not (tmp_path / "log.jsonl").exists()


PREREG_002 = (
    Path(__file__).resolve().parents[1]
    / "prereg"
    / "PREREG-002-poseidon-shape-partial-rounds.md"
)


def test_the_second_prereg_is_a_new_document_not_an_edit() -> None:
    """PREREG-001 states its prediction as 3^r, which is not the prediction for
    a spec with leading partial rounds. Rewriting a committed pre-registration
    to cover a new target is the move this layer exists to prevent, so the new
    target gets a new document and both remain readable."""
    first, second = load_prereg(PREREG), load_prereg(PREREG_002)
    assert first.prereg_id == "PREREG-001"
    assert second.prereg_id == "PREREG-002"
    assert first.sha256 != second.sha256
    assert "3^r" in first.fields["prediction"]
    assert "predicted_ideal_degree" in second.fields["prediction"]


def test_the_second_prereg_fixes_the_partial_round_hypothesis_in_advance() -> None:
    """Stated before the runs so that finding it is a confirmation rather than
    a story told afterwards."""
    hypothesis = load_prereg(PREREG_002).fields["partial_round_hypothesis"]
    assert "below the propagated bound at a partial round" in hypothesis
    assert "at no full round" in hypothesis


def test_a_field_beginning_with_inline_code_keeps_its_backtick() -> None:
    """strip("`") looks equivalent to unwrapping and is not: a value that
    merely begins with inline code loses its opening backtick and nothing
    closes it."""
    prediction = load_prereg(PREREG_002).fields["prediction"]
    assert prediction.startswith("`reference.predicted_ideal_degree`")
    assert prediction.count("`") % 2 == 0


def test_a_fully_quoted_field_is_unwrapped() -> None:
    from provenance import _unwrap

    assert _unwrap("`PREREG-001`") == "PREREG-001"
    assert _unwrap("`a` and `b`") == "`a` and `b`"
    assert _unwrap("plain") == "plain"
    assert _unwrap("`") == "`"


def test_the_second_prereg_is_committed_before_any_run_stamps_it() -> None:
    assert len(load_prereg(PREREG_002).assert_committed()) == 40
