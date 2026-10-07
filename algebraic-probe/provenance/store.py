"""Append-only, hash-chained, content-addressed results storage.

Section 8, RESULTS INTEGRITY:
  * results are append-only
  * run logs are committed, not gitignored
  * results files are content-addressed; two files claiming to be independent
    runs must not be byte-identical, and a test asserts this
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from tiers.errors import AppendOnlyViolation, ProvenanceError

from .chain import GENESIS, ChainRecord, digest

RUNS_DIR = Path(__file__).resolve().parents[1] / "runs"
INDEX_NAME = "index.jsonl"


def _content_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@dataclass
class ResultsLog:
    """One run's append-only log. Records may be appended; nothing else."""

    path: Path
    header: dict
    _records: list[ChainRecord]

    # -- construction -------------------------------------------------------

    @staticmethod
    def create(path: Path, header: dict) -> "ResultsLog":
        if path.exists():
            raise AppendOnlyViolation(
                f"{path} already exists; a run log is never reopened for rewriting"
            )
        path.parent.mkdir(parents=True, exist_ok=True)
        genesis = ChainRecord.create(0, GENESIS, {"kind": "header", **header})
        with path.open("w", encoding="utf-8") as handle:
            handle.write(json.dumps(genesis.to_dict(), sort_keys=True) + "\n")
        return ResultsLog(path=path, header=header, _records=[genesis])

    @staticmethod
    def open(path: Path) -> "ResultsLog":
        records = ResultsLog._read_verified(path)
        ResultsLog._check_not_truncated(path, records)
        header = {k: v for k, v in records[0].payload.items() if k != "kind"}
        return ResultsLog(path=path, header=header, _records=records)

    # -- reading and verification ------------------------------------------

    @staticmethod
    def _read_verified(path: Path) -> list[ChainRecord]:
        if not path.exists():
            raise ProvenanceError(f"no such run log: {path}")
        records: list[ChainRecord] = []
        prev = GENESIS
        for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
            if not line.strip():
                continue
            record = ChainRecord.from_dict(json.loads(line))
            if not record.is_valid(expected_seq=line_no, expected_prev=prev):
                raise AppendOnlyViolation(
                    f"{path}: hash chain broken at record {line_no}; the log has been "
                    "edited after the fact"
                )
            records.append(record)
            prev = record.hash
        if not records:
            raise ProvenanceError(f"{path}: empty run log has no header record")
        return records

    def verify(self) -> bool:
        records = ResultsLog._read_verified(self.path)
        ResultsLog._check_not_truncated(self.path, records)
        return True

    @staticmethod
    def _check_not_truncated(path: Path, records: list[ChainRecord]) -> None:
        """A hash chain detects edits and insertions but not truncation.

        Every record commits to its predecessor, so dropping records from the
        *end* of the log leaves a shorter chain that still verifies -- an
        inconvenient result and the run_end marker can both be deleted silently.
        Two independent closures against that:

          1. a run_end record declares the total length of the run, and must be
             the last record in the log;
          2. a sealed log's length and head hash are registered in the run index
             (see ``seal``), which ``verify_against_index`` cross-checks.
        """
        for position, record in enumerate(records):
            if record.payload.get("kind") != "run_end":
                continue
            if position != len(records) - 1:
                raise AppendOnlyViolation(
                    f"{path}: records follow the run_end marker at {position}; the log "
                    "was appended to after the run was closed"
                )
            declared = record.payload.get("n_records")
            if declared is not None and declared != len(records):
                raise AppendOnlyViolation(
                    f"{path}: run_end declares {declared} records but the log holds "
                    f"{len(records)}; records have been removed from the end"
                )

    def verify_against_index(self) -> bool:
        """Cross-check a sealed log against what the run index recorded for it.

        Catches truncation of a log that never got a run_end marker, and any
        rewrite that produced a self-consistent but different chain.
        """
        entries = read_index(self.path.parent / INDEX_NAME)
        entry = next((e for e in entries if e["path"] == self.path.name), None)
        if entry is None:
            return False  # never sealed: nothing to cross-check against
        if entry["n_records"] != len(self._records):
            raise AppendOnlyViolation(
                f"{self.path}: index recorded {entry['n_records']} records, the log "
                f"holds {len(self._records)}; the log has been truncated or extended "
                "since it was sealed"
            )
        if entry["head_hash"] != self.head_hash:
            raise AppendOnlyViolation(
                f"{self.path}: index recorded head {entry['head_hash'][:16]}, the log "
                f"heads at {self.head_hash[:16]}; the log has been rewritten since it "
                "was sealed"
            )
        return True

    @property
    def records(self) -> tuple[ChainRecord, ...]:
        return tuple(self._records)

    @property
    def head_hash(self) -> str:
        return self._records[-1].hash

    # -- appending ----------------------------------------------------------

    def append(self, payload: dict) -> ChainRecord:
        # Re-verify from disk before every append: catches out-of-band edits.
        on_disk = ResultsLog._read_verified(self.path)
        if len(on_disk) != len(self._records) or on_disk[-1].hash != self.head_hash:
            raise AppendOnlyViolation(
                f"{self.path} changed underneath this handle; refusing to append"
            )
        if any(r.payload.get("kind") == "run_end" for r in on_disk):
            raise AppendOnlyViolation(
                f"{self.path} carries a run_end marker; a closed run is not reopened"
            )
        record = ChainRecord.create(len(self._records), self.head_hash, payload)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record.to_dict(), sort_keys=True) + "\n")
        self._records.append(record)
        return record

    # -- content addressing -------------------------------------------------

    def content_digest(self) -> str:
        return _content_digest(self.path)

    def seal(self) -> str:
        """Register this log's content digest in the run index.

        Raises if a different run log already has byte-identical content: two
        files claiming to be independent runs must not be byte-identical.
        """
        index_path = self.path.parent / INDEX_NAME
        content = self.content_digest()
        entries = read_index(index_path)
        for entry in entries:
            if entry["content_sha256"] == content and entry["path"] != self.path.name:
                raise AppendOnlyViolation(
                    f"{self.path.name} is byte-identical to {entry['path']}: two files "
                    "claiming to be independent runs must not be byte-identical"
                )
            if entry["path"] == self.path.name and entry["content_sha256"] != content:
                raise AppendOnlyViolation(
                    f"{self.path.name} is already sealed with a different digest; "
                    "results are append-only"
                )
        if not any(entry["path"] == self.path.name for entry in entries):
            line = json.dumps(
                {
                    "path": self.path.name,
                    "content_sha256": content,
                    "head_hash": self.head_hash,
                    "n_records": len(self._records),
                    "payload_digest": digest([r.payload for r in self._records]),
                },
                sort_keys=True,
            )
            with index_path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
        return content


def read_index(index_path: Path) -> list[dict]:
    if not index_path.exists():
        return []
    return [
        json.loads(line)
        for line in index_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def run_dir(prereg_id: str, base: Path | None = None) -> Path:
    return (base or RUNS_DIR) / prereg_id
