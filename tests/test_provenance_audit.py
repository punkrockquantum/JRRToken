"""The compliance auditor recomputes under the pre-registered rule."""

from __future__ import annotations

import json
from pathlib import Path

from harness.runner import ProvenanceRunner
from modules.degree.spec import PREREG_PATH
from provenance.audit import audit_run, audit_tree
from provenance.store import ResultsLog

PREREG_ALPHA = 0.05
PREREG_FAMILY = 64
PREREG_FLOOR = 1.0


def a_run(tmp_path: Path, analysis: dict | None = None) -> Path:
    runner = ProvenanceRunner(
        module_id="modules.degree",
        prereg_path=PREREG_PATH,
        base_dir=tmp_path,
        require_clean_tree=False,
    )
    runner.start()
    if analysis is not None:
        runner.record_event("analysis", analysis)
    return runner.finish().path


def an_analysis(*, alpha: float, family_size: int, effect_floor: float) -> dict:
    tests = [{"label": f"r{r:02d}", "p_value": 0.5} for r in range(1, family_size + 1)]
    effects = {t["label"]: 0.1 for t in tests}
    return {
        "analysis_id": "A1",
        "alpha": alpha,
        "family_size": family_size,
        "effect_floor": effect_floor,
        "tests": tests,
        "effects": effects,
        "n_rejected": 0,
    }


def test_a_compliant_run_reports_no_deviations(tmp_path: Path) -> None:
    path = a_run(
        tmp_path,
        an_analysis(alpha=PREREG_ALPHA, family_size=PREREG_FAMILY, effect_floor=PREREG_FLOOR),
    )
    report = audit_run(path)
    assert report.chain_valid
    assert report.prereg_digest_matches
    assert report.deviations == ()
    assert report.compliant
    assert any("match the pre-registration" in n for n in report.notes)


def test_an_analysis_run_at_the_wrong_alpha_is_reported_and_recomputed(tmp_path: Path) -> None:
    path = a_run(tmp_path, an_analysis(alpha=0.20, family_size=32, effect_floor=0.01))
    report = audit_run(path)
    assert not report.compliant
    deviation = next(d for d in report.deviations if d.field_name.startswith("analysis"))
    assert "alpha=0.05" in deviation.prereg_value
    assert "family_size=64" in deviation.prereg_value
    assert "alpha=0.2" in deviation.as_run_value
    assert deviation.recomputed  # the auditor re-ran the pre-registered rule
    assert "n_rejected=" in deviation.recomputed


def test_a_broken_chain_is_reported_rather_than_raised(tmp_path: Path) -> None:
    path = a_run(tmp_path)
    lines = path.read_text(encoding="utf-8").splitlines()
    tampered = json.loads(lines[-1])
    tampered["payload"]["n_records"] = 999
    lines[-1] = json.dumps(tampered, sort_keys=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    report = audit_run(path)
    assert not report.chain_valid
    assert not report.compliant


def test_a_dirty_working_tree_is_a_recorded_deviation(tmp_path: Path) -> None:
    path = a_run(tmp_path)
    log = ResultsLog.open(path)
    header = dict(log.header)
    header["working_tree_clean"] = False
    # Rebuild a log with the altered header so the chain stays internally valid.
    forged = tmp_path / "forged.jsonl"
    rebuilt = ResultsLog.create(forged, header)
    rebuilt.append({"kind": "run_end", "n_records": 1})
    report = audit_run(forged)
    assert any(d.field_name == "working_tree_clean" for d in report.deviations)


def test_audit_tree_walks_every_log_and_skips_the_index(tmp_path: Path) -> None:
    a_run(tmp_path)
    a_run(tmp_path)
    reports = audit_tree(tmp_path)
    assert len(reports) == 2
    assert all(r.chain_valid for r in reports)


def test_the_audit_render_is_one_line_per_deviation(tmp_path: Path) -> None:
    path = a_run(tmp_path, an_analysis(alpha=0.20, family_size=32, effect_floor=0.01))
    rendered = audit_run(path).render()
    assert rendered.splitlines()[0].startswith("audit run=")
    assert "deviation field=analysis[A1]" in rendered
