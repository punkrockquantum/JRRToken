"""The commands the README and REPORT tell people to run must actually run.

A documented command that emits a warning, or that only works from one
directory, is a defect in the instrument's interface. These run each one as a
subprocess from the repository root, exactly as documented.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, *args],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )


def test_the_calibration_manifest_command_runs_without_warnings() -> None:
    """``python -m modules.degree.calibration`` is documented in the
    module docstring, the README and REPORT.md."""
    result = run("-W", "error", "-m", "modules.degree.calibration")
    assert result.returncode == 0, result.stderr
    assert result.stderr == "", result.stderr
    assert "calibration_suite module=modules.degree" in result.stdout
    assert "calibration_blocked=True" in result.stdout


def test_the_manifest_is_printed_once_not_twice() -> None:
    """The double-import this guards against ran the suite twice."""
    result = run("-m", "modules.degree.calibration")
    assert result.stdout.count("calibration_suite module=") == 1


def test_the_derivation_command_runs_without_warnings() -> None:
    result = run("-W", "error", "modules/degree/prereg/derive_thresholds.py")
    assert result.returncode == 0, result.stderr
    assert result.stderr == "", result.stderr
    assert "BEGIN DERIVED computation_id=M1-DERIVE-001" in result.stdout


def test_the_structural_checks_command_runs_clean() -> None:
    """The count is asserted rather than derived from ``CHECKS``, which would
    make the test agree with the code by construction and pass through a check
    that was added but never wired in."""
    result = run("scripts/ci_checks.py")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "checks=6 failed=0" in result.stdout
    assert "check=current_prereg_has_a_run passed=True" in result.stdout


@pytest.mark.slow
def test_the_readiness_command_reports_no_go_and_exits_nonzero() -> None:
    """Exit code carries the decision, so a caller can gate on it."""
    result = run("scripts/readiness_report.py")
    assert result.returncode == 1
    assert "partial=['M1']" in result.stdout
    assert "no_go=['M2', 'M3', 'M4', 'M5', 'M6']" in result.stdout


@pytest.mark.slow
def test_the_report_renderer_writes_every_declared_report(tmp_path) -> None:
    """Rendered into a temporary directory, never the tracked one.

    Rendering into reports/out/ rewrites tracked files with a fresh commit
    stamp, so the working tree is dirty afterwards and any provenance run
    executed later records working_tree_clean=False and is reported
    non-compliant. A test must not corrupt the provenance of what runs after it.
    """
    result = run("scripts/render_reports.py", "--out-dir", str(tmp_path))
    assert result.returncode == 0, result.stderr
    for name in ("module-registry.txt", "M1-prereg.txt", "M1-calibration-manifest.txt"):
        assert f"wrote={name}" in result.stdout
        assert (tmp_path / name).exists()


@pytest.mark.slow
def test_the_renderer_leaves_the_tracked_report_directory_untouched(tmp_path) -> None:
    """The guard on the defect above."""
    tracked = ROOT / "reports" / "out"
    before = {q.name: q.read_bytes() for q in tracked.glob("*.txt")}
    assert before, "expected committed reports to compare against"
    result = run("scripts/render_reports.py", "--out-dir", str(tmp_path))
    assert result.returncode == 0, result.stderr
    assert {q.name: q.read_bytes() for q in tracked.glob("*.txt")} == before


@pytest.mark.slow
def test_the_synthesis_script_also_honours_an_output_directory(tmp_path) -> None:
    """Same trap, same switch: synthesis.py writes unconditionally otherwise."""
    tracked = ROOT / "reports" / "out" / "synthesis.txt"
    before = tracked.read_bytes() if tracked.exists() else None
    result = run("scripts/synthesis.py", "--out-dir", str(tmp_path))
    assert result.returncode == 0, result.stderr
    assert (tmp_path / "synthesis.txt").exists()
    after = tracked.read_bytes() if tracked.exists() else None
    assert after == before


@pytest.mark.slow
def test_the_registry_report_lists_every_registered_module(tmp_path) -> None:
    """It listed one module while two were registered, because the renderer
    imported only Module 1's spec.

    Rendered into a temporary directory: an earlier draft of this test wrote
    into reports/out/ and re-introduced the defect it sits beside.
    """
    result = run("scripts/render_reports.py", "--out-dir", str(tmp_path))
    assert result.returncode == 0, result.stderr
    registry = (tmp_path / "module-registry.txt").read_text()

    # Derived from the registry rather than frozen as a literal. The count was
    # pinned at 2 and went stale the moment Module 2 was registered, which is
    # the same class of defect this test was written to catch.
    from harness.registry import REGISTRY

    import modules.degree.spec  # noqa: F401  (registers)
    import modules.differential.spec  # noqa: F401  (registers)
    import modules.hod.spec  # noqa: F401  (registers)
    import modules.reach.spec  # noqa: F401  (registers)

    registered = REGISTRY.ids()
    assert registered, "a registry with nothing in it would pass vacuously"
    assert f"modules={len(registered)}" in registry
    for module_id in registered:
        assert f"module={module_id}" in registry, module_id


@pytest.mark.slow
def test_the_executor_preview_writes_no_run_log() -> None:
    """``--preview`` must be safe to run from a test.

    An ordinary invocation of scripts/execute.py appends a run to the tracked,
    append-only log -- ``--write`` gates only reports/out/execution.txt, which
    is the misreading D-054 records. So this exercises the preview path and
    asserts the run directory is unchanged; a test that called the executor for
    real would write into runs/ and leave the tree dirty for everything after
    it, which is the defect D-033 records.
    """
    runs = ROOT / "runs" / "PREREG-M1"
    before = sorted(p.name for p in runs.glob("*.jsonl"))
    result = run("scripts/execute.py", "--preview")
    assert result.returncode == 0, result.stderr
    assert "mode=preview wrote_run_log=False measured=False" in result.stdout
    assert "would_run module=M1" in result.stdout
    assert sorted(p.name for p in runs.glob("*.jsonl")) == before


@pytest.mark.slow
def test_the_executor_refuses_preview_combined_with_write() -> None:
    result = run("scripts/execute.py", "--preview", "--write")
    assert result.returncode != 0
    assert "writes nothing" in result.stderr


