"""Hash chaining over records.

Each record commits to the previous record's hash, so the ordering of a run log
is a hash chain rather than a sequence of timestamp claims (section 8).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

GENESIS = "0" * 64


def canonical(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(payload: Any) -> str:
    return hashlib.sha256(canonical(payload).encode("utf-8")).hexdigest()


def record_hash(seq: int, prev_hash: str, payload: Any) -> str:
    return digest({"seq": seq, "prev_hash": prev_hash, "payload": payload})


@dataclass(frozen=True, slots=True)
class ChainRecord:
    seq: int
    prev_hash: str
    payload: dict
    hash: str

    @staticmethod
    def create(seq: int, prev_hash: str, payload: dict) -> "ChainRecord":
        return ChainRecord(
            seq=seq,
            prev_hash=prev_hash,
            payload=payload,
            hash=record_hash(seq, prev_hash, payload),
        )

    def to_dict(self) -> dict:
        return {
            "seq": self.seq,
            "prev_hash": self.prev_hash,
            "payload": self.payload,
            "hash": self.hash,
        }

    @staticmethod
    def from_dict(data: dict) -> "ChainRecord":
        return ChainRecord(
            seq=int(data["seq"]),
            prev_hash=str(data["prev_hash"]),
            payload=data["payload"],
            hash=str(data["hash"]),
        )

    def is_valid(self, expected_seq: int, expected_prev: str) -> bool:
        return (
            self.seq == expected_seq
            and self.prev_hash == expected_prev
            and self.hash == record_hash(self.seq, self.prev_hash, self.payload)
        )
