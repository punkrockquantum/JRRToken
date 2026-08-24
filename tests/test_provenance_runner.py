"""The provenance runner: commit embedding, prereg hashing, append-only results."""

from __future__ import annotations

from pathlib import Path

import pytest

from harness.promotion import (
    CostComparison,
    CostRow,
    Direction,
    FalsificationCheck,
    PromotionDecision,
    ThresholdCheck,
    VerificationCheck,
)
from harness.runner import ProvenanceRunner
from modules.degree.citations import CITATIONS
from modules.degree.spec import PREREG_PATH
from provenance import gitinfo
from provenance.prereg import load as load_prereg
from provenance.store import ResultsLog
from tiers import Provenance, prove
from tiers.errors import ProbeError, ProvenanceError


def a_runner(tmp_path: Path, **overrides) -> ProvenanceRunner:
    kwargs = dict(
        module_id="modules.degree",
        prereg_path=PREREG_PATH,
        citations=CITATIONS,
        base_dir=tmp_path,
        require_clean_tree=False,
    )
    kwargs.update(overrides)
    return ProvenanceRunner(**kwargs)


def test_the_header_carries_the_commit_and_the_prereg_digest(tmp_path: Path) -> None:
    runner = a_runner(tmp_path)
    receipt = runner.start()
    prereg = load_prereg(PREREG_PATH)
    assert receipt.commit == gitinfo.head_commit()
    assert receipt.prereg_sha256 == prereg.sha256
    log = ResultsLog.open(receipt.path)
    header = log.header
    assert header["prereg_id"] == "PREREG-M1"
    assert header["runner_relpath"] == "harness/runner.py"
    assert header["runner_precedes_prereg"] is True
    assert header["citations_digest"] == CITATIONS.digest()


def test_recorded_results_carry_the_commit_and_prereg_hash(tmp_path: Path) -> None:
    runner = a_runner(tmp_path)
    runner.start()
    provenance = runner.provenance("D-UB-R20")
    result = prove(
        metric="d_ub",
        value=39,
        target="keccak-f",
        provenance=provenance,
        derivation="composition bound",
    )
    runner.record_result(result)
    receipt = runner.finish()
    log = ResultsLog.open(receipt.path)
    payloads = [r.payload for r in log.records]
    recorded = next(p for p in payloads if p.get("kind") == "result")
    assert recorded["provenance"]["commit"] == receipt.commit
    assert recorded["provenance"]["prereg_sha256"] == receipt.prereg_sha256
    assert recorded["provenance"]["computation_id"].endswith(":D-UB-R20")
    assert recorded["tier"] == "P"


def test_the_run_seals_and_is_content_addressed(tmp_path: Path) -> None:
    runner = a_runner(tmp_path)
    runner.start()
    runner.record_result(
        prove(metric="m", value=1, target="t", provenance=runner.provenance("C1"), derivation="d")
    )
    receipt = runner.finish()
    assert len(receipt.content_sha256) == 64
    assert receipt.n_records >= 3


def test_a_sealed_run_refuses_further_records(tmp_path: Path) -> None:
    runner = a_runner(tmp_path)
    runner.start()
    runner.finish()
    with pytest.raises(ProbeError, match="sealed"):
        runner.record_event("note", {"text": "after the fact"})


def test_two_runs_of_the_same_prereg_are_not_byte_identical(tmp_path: Path) -> None:
    first = a_runner(tmp_path)
    first.start()
    first.record_result(
        prove(metric="m", value=1, target="t", provenance=first.provenance("C"), derivation="d")
    )
    receipt_one = first.finish()

    second = a_runner(tmp_path)
    second.start()
    second.record_result(
        prove(metric="m", value=1, target="t", provenance=second.provenance("C"), derivation="d")
    )
    receipt_two = second.finish()

    assert receipt_one.content_sha256 != receipt_two.content_sha256
    assert receipt_one.run_id != receipt_two.run_id


def test_a_dirty_working_tree_is_refused_when_required(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(gitinfo, "working_tree_clean", lambda paths=None: False)
    runner = a_runner(tmp_path, require_clean_tree=True)
    with pytest.raises(ProvenanceError, match="working tree is dirty"):
        runner.start()


def test_the_module_id_must_match_the_prereg(tmp_path: Path) -> None:
    runner = a_runner(tmp_path, module_id="modules.somethingelse")
    with pytest.raises(ProvenanceError, match="declares module"):
        runner.start()


def test_a_reproduction_must_name_exactly_one_varied_factor(tmp_path: Path) -> None:
    with pytest.raises(ProbeError, match="single factor"):
        a_runner(tmp_path, reproduction_of="run-1").start()
    with pytest.raises(ProbeError, match="must be one of"):
        a_runner(tmp_path, reproduction_of="run-1", varied_factor="everything").start()
    with pytest.raises(ProbeError, match="only meaningful for a reproduction"):
        a_runner(tmp_path, varied_factor="seed").start()


def test_a_valid_reproduction_records_its_single_factor(tmp_path: Path) -> None:
    runner = a_runner(tmp_path, reproduction_of="run-1", varied_factor="seed")
    receipt = runner.start()
    header = ResultsLog.open(receipt.path).header
    assert header["reproduction_of"] == "run-1"
    assert header["varied_factor"] == "seed"


def test_an_unknown_citation_key_is_refused_at_stamp_time(tmp_path: Path) -> None:
    runner = a_runner(tmp_path)
    runner.start()
    with pytest.raises(ProvenanceError, match="Unknown citation key"):
        runner.provenance("C", citation_key="CITE-DOES-NOT-EXIST")


def test_reserved_record_kinds_are_refused(tmp_path: Path) -> None:
    runner = a_runner(tmp_path)
    runner.start()
    with pytest.raises(ProbeError, match="reserved record kind"):
        runner.record_event("result", {"value": 1})


def test_a_promotion_must_carry_the_run_commit(tmp_path: Path) -> None:
    runner = a_runner(tmp_path)
    receipt = runner.start()
    decision = PromotionDecision(
        candidate_id="C1",
        result=prove(
            metric="k_HO", value=40, target="t", provenance=runner.provenance("C"), derivation="d"
        ),
        threshold=ThresholdCheck(
            metric="k_HO",
            value=40.0,
            threshold=63.1,
            direction=Direction.LESS_IS_BETTER,
            derivation="CITE-SHATTERED",
        ),
        verification=VerificationCheck(
            verifier_id="verify.anf.algebraic_degree",
            discovering_module="modules.degree",
            observed_by_module="39",
            observed_by_verifier="39",
            shares_no_code_assertion="scripts/ci_checks.py",
        ),
        cost=CostComparison(
            candidate=CostRow("hod", 2.0**40, 1.0, 1.0, "u"),
            baselines=(CostRow("brute force", 2.0**296, 1.0, 1.0, "u"),),
            access_cost_in_ops=1.0,
            access_cost_derivation="measured",
        ),
        falsification=FalsificationCheck(
            test_id="t", artefact_hypotheses=("indexing defect",), ran=True, survived=True, observed="o"
        ),
        scope_statement="scope",
        commit="0" * 40,
    )
    with pytest.raises(ProvenanceError, match="carries commit"):
        runner.record_promotion(decision)
    assert receipt.commit != "0" * 40


def test_provenance_before_start_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ProbeError, match="not been started"):
        a_runner(tmp_path).provenance("C")


def test_starting_twice_is_refused(tmp_path: Path) -> None:
    runner = a_runner(tmp_path)
    runner.start()
    with pytest.raises(ProbeError, match="already started"):
        runner.start()


def test_a_result_without_provenance_cannot_reach_the_log() -> None:
    with pytest.raises(ProvenanceError):
        Provenance(computation_id="", citation_key="")
