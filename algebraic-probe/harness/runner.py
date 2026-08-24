"""The provenance runner.

Everything this instrument records passes through here. At run start it:

  * reads ``git rev-parse HEAD`` and embeds the full commit id
  * hashes the pre-registration document and embeds the digest
  * asserts that this file -- the runner performing the embedding -- was itself
    committed strictly before the pre-registration it is stamping, by git
    ancestry rather than by timestamp
  * opens an append-only, hash-chained results log

and at run end it seals the log with a content digest registered in a run index,
so two files claiming to be independent runs cannot be byte-identical.

A reproduction run must name exactly one varied factor (section 8, VALIDATION:
"Reproduction runs vary ONE factor at a time ... never several at once").
"""

from __future__ import annotations

import platform
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from provenance import gitinfo
from provenance.prereg import PreRegistration
from provenance.prereg import load as load_prereg
from provenance.store import RUNS_DIR, ResultsLog, run_dir
from tiers.errors import ProbeError, ProvenanceError
from tiers.finding import Finding
from tiers.provenance import CitationIndex, Provenance
from tiers.result import Result

from .promotion import PromotionDecision

#: This file, relative to the repository root. The ordering assertion below and
#: the test in tests/test_provenance_ordering.py both key off it.
RUNNER_RELPATH = "harness/runner.py"

#: The factors a reproduction run is allowed to vary. Exactly one per run.
REPRODUCIBLE_FACTORS = ("seed", "sampling_scheme", "compiler_flags", "implementation", "platform")


@dataclass(frozen=True, slots=True)
class RunReceipt:
    run_id: str
    path: Path
    commit: str
    prereg_id: str
    prereg_sha256: str
    content_sha256: str
    head_hash: str
    n_records: int

    def render(self) -> str:
        return (
            f"run_id={self.run_id} path={self.path.name} commit={self.commit} "
            f"prereg={self.prereg_id} prereg_sha256={self.prereg_sha256} "
            f"content_sha256={self.content_sha256} head_hash={self.head_hash} "
            f"n_records={self.n_records}"
        )


@dataclass
class ProvenanceRunner:
    module_id: str
    prereg_path: str
    citations: CitationIndex | None = None
    base_dir: Path = RUNS_DIR
    require_clean_tree: bool = True
    reproduction_of: str | None = None
    varied_factor: str | None = None
    run_id: str = field(default_factory=lambda: uuid.uuid4().hex)

    _prereg: PreRegistration | None = field(default=None, init=False, repr=False)
    _log: ResultsLog | None = field(default=None, init=False, repr=False)
    _commit: str | None = field(default=None, init=False, repr=False)
    _sealed: bool = field(default=False, init=False, repr=False)

    # -- lifecycle ----------------------------------------------------------

    def start(self) -> RunReceipt:
        if self._log is not None:
            raise ProbeError("runner already started")
        if self.reproduction_of is not None:
            if self.varied_factor is None:
                raise ProbeError(
                    "a reproduction run must name the single factor it varies "
                    "(section 8, VALIDATION)"
                )
            if self.varied_factor not in REPRODUCIBLE_FACTORS:
                raise ProbeError(
                    f"varied_factor must be one of {list(REPRODUCIBLE_FACTORS)}; "
                    f"got {self.varied_factor!r}"
                )
        elif self.varied_factor is not None:
            raise ProbeError("varied_factor is only meaningful for a reproduction run")

        prereg = load_prereg(self.prereg_path)
        if prereg.fields.get("module") != self.module_id:
            raise ProvenanceError(
                f"pre-registration {prereg.relative_path} declares module "
                f"{prereg.fields.get('module')!r}, runner declares {self.module_id!r}"
            )
        runner_commit, prereg_commit = prereg.assert_runner_precedes(RUNNER_RELPATH)

        commit = gitinfo.head_commit()
        clean = gitinfo.working_tree_clean()
        if self.require_clean_tree and not clean:
            raise ProvenanceError(
                "the working tree is dirty: the embedded commit id would not describe "
                "the code that produced these results"
            )

        header = {
            "run_id": self.run_id,
            "module_id": self.module_id,
            "commit": commit,
            "working_tree_clean": clean,
            "prereg_id": prereg.prereg_id,
            "prereg_path": prereg.relative_path,
            "prereg_sha256": prereg.sha256,
            "prereg_introducing_commit": prereg_commit,
            "runner_relpath": RUNNER_RELPATH,
            "runner_introducing_commit": runner_commit,
            "runner_precedes_prereg": True,
            "citations_digest": None if self.citations is None else self.citations.digest(),
            "reproduction_of": self.reproduction_of,
            "varied_factor": self.varied_factor,
            "python": sys.version.split()[0],
            "platform": platform.platform(),
        }

        directory = run_dir(prereg.prereg_id, self.base_dir)
        path = directory / f"{prereg.prereg_id}.{self.run_id}.jsonl"
        self._prereg = prereg
        self._commit = commit
        self._log = ResultsLog.create(path, header)
        return self._receipt()

    def _receipt(self) -> RunReceipt:
        log = self._require_log()
        assert self._prereg is not None and self._commit is not None
        return RunReceipt(
            run_id=self.run_id,
            path=log.path,
            commit=self._commit,
            prereg_id=self._prereg.prereg_id,
            prereg_sha256=self._prereg.sha256,
            content_sha256=log.content_digest(),
            head_hash=log.head_hash,
            n_records=len(log.records),
        )

    def _require_log(self) -> ResultsLog:
        if self._log is None:
            raise ProbeError("runner has not been started")
        if self._sealed:
            raise ProbeError("run is sealed; results are append-only within a run")
        return self._log

    # -- provenance stamps for results produced under this run --------------

    def provenance(
        self, computation_id: str, *, citation_key: str | None = None, notes: str = ""
    ) -> Provenance:
        if self._prereg is None or self._commit is None:
            raise ProbeError("runner has not been started")
        if citation_key is not None and self.citations is not None:
            self.citations.get(citation_key)  # raises on an unknown key
        return Provenance(
            computation_id=f"{self.run_id}:{computation_id}",
            citation_key=citation_key,
            commit=self._commit,
            prereg_sha256=self._prereg.sha256,
            notes=notes,
        )

    # -- recording ----------------------------------------------------------

    def record_result(self, result: Result) -> str:
        record = self._require_log().append({"kind": "result", **result.to_dict()})
        return record.hash

    def record_finding(self, finding: Finding) -> str:
        record = self._require_log().append({"kind": "finding", **finding.to_dict()})
        return record.hash

    def record_promotion(self, decision: PromotionDecision) -> str:
        if decision.commit != self._commit:
            raise ProvenanceError(
                f"promotion candidate {decision.candidate_id} carries commit "
                f"{decision.commit}, run is at {self._commit}"
            )
        record = self._require_log().append(
            {
                "kind": "promotion",
                "candidate_id": decision.candidate_id,
                "promoted": decision.promoted,
                "failed_criteria": list(decision.failed_criteria),
                "rendered": decision.render(),
            }
        )
        return record.hash

    def record_event(self, kind: str, payload: dict[str, Any]) -> str:
        if kind in {"result", "finding", "promotion", "header"}:
            raise ProbeError(f"{kind!r} is a reserved record kind")
        record = self._require_log().append({"kind": kind, **payload})
        return record.hash

    # -- sealing ------------------------------------------------------------

    def finish(self) -> RunReceipt:
        log = self._require_log()
        log.append({"kind": "run_end", "n_records": len(log.records)})
        receipt = self._receipt()
        log.seal()
        self._sealed = True
        return RunReceipt(
            run_id=receipt.run_id,
            path=receipt.path,
            commit=receipt.commit,
            prereg_id=receipt.prereg_id,
            prereg_sha256=receipt.prereg_sha256,
            content_sha256=log.content_digest(),
            head_hash=log.head_hash,
            n_records=len(log.records),
        )
