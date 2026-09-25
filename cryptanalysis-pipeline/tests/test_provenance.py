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
