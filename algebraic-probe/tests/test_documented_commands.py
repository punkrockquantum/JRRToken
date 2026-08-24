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
    result = run("scripts/ci_checks.py")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "checks=5 failed=0" in result.stdout


@pytest.mark.slow
def test_the_readiness_command_reports_no_go_and_exits_nonzero() -> None:
    """Exit code carries the decision, so a caller can gate on it."""
    result = run("scripts/readiness_report.py")
    assert result.returncode == 1
    assert "partial=['M1']" in result.stdout
    assert "no_go=['M2', 'M3', 'M4', 'M5', 'M6']" in result.stdout


@pytest.mark.slow
def test_the_report_renderer_writes_every_declared_report() -> None:
    result = run("scripts/render_reports.py")
    assert result.returncode == 0, result.stderr
    for name in ("module-registry.txt", "M1-prereg.txt", "M1-calibration-manifest.txt"):
        assert f"wrote=reports/out/{name}" in result.stdout
