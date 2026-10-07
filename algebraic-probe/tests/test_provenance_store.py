"""Append-only, hash-chained, content-addressed results storage."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from provenance.chain import GENESIS, ChainRecord, record_hash
from provenance.store import INDEX_NAME, ResultsLog, read_index
from tiers.errors import AppendOnlyViolation, ProvenanceError


def a_log(tmp_path: Path, name: str = "run-a.jsonl") -> ResultsLog:
    return ResultsLog.create(tmp_path / name, {"run_id": name, "commit": "deadbeef"})


def test_header_is_the_genesis_record(tmp_path: Path) -> None:
    log = a_log(tmp_path)
    assert len(log.records) == 1
    assert log.records[0].seq == 0
    assert log.records[0].prev_hash == GENESIS
    assert log.records[0].payload["kind"] == "header"


def test_records_chain_to_their_predecessor(tmp_path: Path) -> None:
    log = a_log(tmp_path)
    first = log.append({"kind": "result", "value": 1})
    second = log.append({"kind": "result", "value": 2})
    assert first.prev_hash == log.records[0].hash
    assert second.prev_hash == first.hash
    assert log.verify()


def test_reopening_an_existing_log_is_refused(tmp_path: Path) -> None:
    a_log(tmp_path)
    with pytest.raises(AppendOnlyViolation, match="never reopened"):
        a_log(tmp_path)


def test_editing_a_record_after_the_fact_breaks_the_chain(tmp_path: Path) -> None:
    log = a_log(tmp_path)
    log.append({"kind": "result", "value": 1})
    lines = log.path.read_text(encoding="utf-8").splitlines()
    tampered = json.loads(lines[1])
    tampered["payload"]["value"] = 99
    lines[1] = json.dumps(tampered, sort_keys=True)
    log.path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    with pytest.raises(AppendOnlyViolation, match="hash chain broken"):
        ResultsLog.open(log.path)


def test_rewriting_a_record_and_its_hash_still_breaks_the_chain(tmp_path: Path) -> None:
    """A forger who recomputes the record's own hash still has to fix every
    later prev_hash; with one appended record the head hash changes."""
    log = a_log(tmp_path)
    log.append({"kind": "result", "value": 1})
    original_head = log.head_hash
    lines = log.path.read_text(encoding="utf-8").splitlines()
    tampered = json.loads(lines[1])
    tampered["payload"]["value"] = 99
    tampered["hash"] = record_hash(tampered["seq"], tampered["prev_hash"], tampered["payload"])
    lines[1] = json.dumps(tampered, sort_keys=True)
    log.path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    reopened = ResultsLog.open(log.path)
    assert reopened.head_hash != original_head


def test_appending_after_an_out_of_band_edit_is_refused(tmp_path: Path) -> None:
    log = a_log(tmp_path)
    log.append({"kind": "result", "value": 1})
    with log.path.open("a", encoding="utf-8") as handle:
        forged = ChainRecord.create(2, log.head_hash, {"kind": "result", "value": 7})
        handle.write(json.dumps(forged.to_dict(), sort_keys=True) + "\n")
    with pytest.raises(AppendOnlyViolation, match="changed underneath"):
        log.append({"kind": "result", "value": 3})


def test_sealing_registers_the_content_digest(tmp_path: Path) -> None:
    log = a_log(tmp_path)
    log.append({"kind": "result", "value": 1})
    digest = log.seal()
    entries = read_index(tmp_path / INDEX_NAME)
    assert len(entries) == 1
    assert entries[0]["content_sha256"] == digest
    assert entries[0]["head_hash"] == log.head_hash


def test_two_byte_identical_runs_are_refused(tmp_path: Path) -> None:
    first = ResultsLog.create(tmp_path / "run-1.jsonl", {"run_id": "same", "commit": "c"})
    first.append({"kind": "result", "value": 1})
    first.seal()
    second = ResultsLog.create(tmp_path / "run-2.jsonl", {"run_id": "same", "commit": "c"})
    second.append({"kind": "result", "value": 1})
    with pytest.raises(AppendOnlyViolation, match="byte-identical"):
        second.seal()


def test_distinct_runs_with_distinct_headers_seal_cleanly(tmp_path: Path) -> None:
    first = ResultsLog.create(tmp_path / "run-1.jsonl", {"run_id": "one", "commit": "c"})
    first.append({"kind": "result", "value": 1})
    first.seal()
    second = ResultsLog.create(tmp_path / "run-2.jsonl", {"run_id": "two", "commit": "c"})
    second.append({"kind": "result", "value": 1})
    assert second.seal() != first.content_digest()
    assert len(read_index(tmp_path / INDEX_NAME)) == 2


def test_sealing_twice_is_idempotent(tmp_path: Path) -> None:
    log = a_log(tmp_path)
    log.append({"kind": "result", "value": 1})
    assert log.seal() == log.seal()
    assert len(read_index(tmp_path / INDEX_NAME)) == 1


def test_opening_a_missing_log_raises(tmp_path: Path) -> None:
    with pytest.raises(ProvenanceError, match="no such run log"):
        ResultsLog.open(tmp_path / "absent.jsonl")


def test_an_empty_log_has_no_header(tmp_path: Path) -> None:
    path = tmp_path / "empty.jsonl"
    path.write_text("", encoding="utf-8")
    with pytest.raises(ProvenanceError, match="no header record"):
        ResultsLog.open(path)
