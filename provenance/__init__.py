"""Commit embedding, pre-registration hashing, hash chaining, audit."""

from .audit import AuditReport, Deviation, audit_run, audit_tree
from .chain import GENESIS, ChainRecord, canonical, digest, record_hash
from .gitinfo import GitStamp, head_commit, introducing_commit, is_ancestor, stamp, working_tree_clean
from .prereg import REQUIRED_FIELDS, PreRegistration, load
from .store import INDEX_NAME, RUNS_DIR, ResultsLog, read_index, run_dir

__all__ = [
    "AuditReport",
    "ChainRecord",
    "Deviation",
    "GENESIS",
    "GitStamp",
    "INDEX_NAME",
    "PreRegistration",
    "REQUIRED_FIELDS",
    "RUNS_DIR",
    "ResultsLog",
    "audit_run",
    "audit_tree",
    "canonical",
    "digest",
    "head_commit",
    "introducing_commit",
    "is_ancestor",
    "load",
    "read_index",
    "record_hash",
    "run_dir",
    "stamp",
    "working_tree_clean",
]
