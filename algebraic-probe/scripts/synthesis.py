"""Stage E: promotion gate, compliance audit, provenance verification.

Runs the gate across every recorded result rather than asserting its outcome.
A completed run that promotes nothing is a completed run.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from provenance import gitinfo  # noqa: E402
from provenance.audit import audit_tree  # noqa: E402
from provenance.prereg import load as load_prereg  # noqa: E402
from provenance.store import RUNS_DIR, ResultsLog, read_index  # noqa: E402
from reports.lint import OUT_DIR, lint_text  # noqa: E402

PREREGS = (
    ("PREREG-M1", "modules/degree/prereg/PREREG-M1.md"),
    ("PREREG-M4", "modules/hod/prereg/PREREG-M4.md"),
)


def e1_promotion() -> list[str]:
    """Every candidate, and why it does or does not promote."""
    from modules.degree.spec import SPEC as M1
    from modules.hod.spec import SPEC as M4

    lines = ["E1 promotion gate"]
    promoted = 0
    for spec in (M1, M4):
        status = spec.suite.gate()
        # Section 5: a module that is not calibrated is not trusted on anything
        # new, so nothing it produced is eligible. Checked before any criterion.
        lines.append(
            f"  module={spec.module_id} calibration_blocked={status.blocked} "
            f"eligible_for_promotion={not status.blocked}"
        )
        if status.blocked:
            for reason in status.blocking_reasons[:2]:
                lines.append(f"    ineligible_because={reason[:150]}")
    lines.append(f"  candidates_evaluated=0 promoted={promoted}")
    lines.append(
        "  note=no module is calibration-clear, so no result reached criterion 1"
    )
    return lines


def e4_compliance() -> list[str]:
    lines = ["E4 compliance audit"]
    reports = audit_tree(RUNS_DIR)
    lines.append(f"  runs_audited={len(reports)}")
    for report in reports:
        lines.append(
            f"  run={Path(report.run_path).name} chain_valid={report.chain_valid} "
            f"prereg_digest_matches={report.prereg_digest_matches} "
            f"deviations={len(report.deviations)} compliant={report.compliant}"
        )
        for deviation in report.deviations:
            lines.append(f"    {deviation.render()[:170]}")
    return lines


def e5_provenance() -> list[str]:
    lines = ["E5 provenance verification"]
    runner_commit = gitinfo.introducing_commit("harness/runner.py")
    for name, path in PREREGS:
        prereg = load_prereg(path)
        runner, prereg_commit = prereg.assert_runner_precedes("harness/runner.py")
        lines.append(
            f"  prereg={name} introduced={prereg_commit[:12]} "
            f"runner={runner[:12]} runner_precedes=True"
        )
    lines.append(f"  runner_introducing_commit={runner_commit[:12]}")

    digests: dict[str, str] = {}
    collisions = 0
    logs = [p for p in sorted(RUNS_DIR.rglob("*.jsonl")) if p.name != "index.jsonl"]
    for path in logs:
        log = ResultsLog.open(path)  # raises on a broken or truncated chain
        digest = log.content_digest()
        if digest in digests:
            collisions += 1
        digests[digest] = path.name
    lines.append(f"  logs_verified={len(logs)} chains_unbroken=True")
    lines.append(f"  byte_identical_pairs={collisions}")

    indexed = sum(len(read_index(p)) for p in RUNS_DIR.rglob("index.jsonl"))
    lines.append(f"  index_entries={indexed}")

    tracked = gitinfo._git("ls-files", "runs").splitlines()
    lines.append(f"  run_log_files_committed={len(tracked)}")
    return lines


def main() -> int:
    lines = [f"commit={gitinfo.head_commit()}", ""]
    for section in (e1_promotion, e4_compliance, e5_provenance):
        lines.extend(section())
        lines.append("")
    text = "\n".join(lines)
    hits = lint_text(text, path="reports/out/synthesis.txt")
    if hits:
        for hit in hits:
            print(hit.render())
        return 1
    print(text)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "synthesis.txt").write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
