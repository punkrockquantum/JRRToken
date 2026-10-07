"""The structural checks of section 10, asserted here as well as in CI."""

from __future__ import annotations

import ast
from pathlib import Path

from scripts.ci_checks import (
    ROOT,
    check_modules_do_not_import_verify,
    check_prereg_derived_block_matches_derivation,
    check_reports_have_no_prose,
    check_runner_precedes_prereg,
    check_verify_does_not_import_modules,
    run_all,
)


def test_verify_does_not_import_modules() -> None:
    result = check_verify_does_not_import_modules()
    assert result.passed, result.detail


def test_modules_do_not_import_verify() -> None:
    """The other direction, so a module cannot verify itself (DECISIONS D-006)."""
    result = check_modules_do_not_import_verify()
    assert result.passed, result.detail


def test_reports_contain_no_prose_conclusions() -> None:
    result = check_reports_have_no_prose()
    assert result.passed, result.detail


def test_the_prereg_matches_its_derivation() -> None:
    result = check_prereg_derived_block_matches_derivation()
    assert result.passed, result.detail


def test_the_runner_precedes_the_prereg() -> None:
    result = check_runner_precedes_prereg()
    assert result.passed, result.detail


def test_every_check_passes() -> None:
    failures = [r.render() for r in run_all() if not r.passed]
    assert failures == []


def test_the_import_checker_actually_detects_an_import(tmp_path: Path) -> None:
    """The check must be able to fail, or it asserts nothing."""
    from scripts.ci_checks import _imported_roots

    offender = tmp_path / "offender.py"
    offender.write_text("import modules.degree\nfrom verify import anf\n", encoding="utf-8")
    roots = _imported_roots(offender)
    assert "modules" in roots
    assert "verify" in roots


def test_relative_imports_are_not_counted_as_cross_package(tmp_path: Path) -> None:
    inner = tmp_path / "inner.py"
    inner.write_text("from . import sibling\n", encoding="utf-8")
    from scripts.ci_checks import _imported_roots

    assert _imported_roots(inner) == set()


def test_every_python_file_in_the_tree_parses() -> None:
    for path in sorted(ROOT.rglob("*.py")):
        if ".pytest_cache" in path.parts:
            continue
        ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


# -- the pre-registration must have a run behind it --------------------------


def _write_log(directory: Path, name: str, digest: str) -> None:
    """A minimal run log: the check reads only the first record's digest."""
    import json

    directory.mkdir(parents=True, exist_ok=True)
    (directory / name).write_text(
        json.dumps({"kind": "run_start", "payload": {"prereg_sha256": digest}}) + "\n",
        encoding="utf-8",
    )


def test_the_check_passes_when_a_run_references_the_current_text(tmp_path: Path) -> None:
    from scripts.ci_checks import _prereg_run_coverage

    _write_log(tmp_path, "a.jsonl", "aaaa")
    _write_log(tmp_path, "b.jsonl", "bbbb")
    result = _prereg_run_coverage("bbbb", tmp_path)
    assert result.passed
    assert "runs_referencing_current_text=1/2" in result.detail


def test_the_check_fails_when_the_prereg_was_edited_and_not_re_run(tmp_path: Path) -> None:
    """The failing branch, executed.

    This is the state commit 2df6785 left the repository in: the
    pre-registration was edited while every committed run referenced the older
    text, so no run stood behind the document as it then read. Nothing in CI
    reported it, which is why this check exists (D-054).
    """
    from scripts.ci_checks import _prereg_run_coverage

    _write_log(tmp_path, "a.jsonl", "old-digest")
    _write_log(tmp_path, "b.jsonl", "old-digest")
    result = _prereg_run_coverage("new-digest", tmp_path)
    assert not result.passed
    assert "none of 2" in result.detail
    assert "execute.py" in result.detail, "a failure must say how to clear it"


def test_a_missing_run_directory_fails_rather_than_passing_vacuously(tmp_path: Path) -> None:
    from scripts.ci_checks import _prereg_run_coverage

    result = _prereg_run_coverage("any", tmp_path / "absent")
    assert not result.passed


def test_the_index_is_not_counted_as_a_run(tmp_path: Path) -> None:
    """runs/<prereg>/index.jsonl sits beside the logs and is not one."""
    from scripts.ci_checks import _prereg_run_coverage

    _write_log(tmp_path, "index.jsonl", "current")
    _write_log(tmp_path, "a.jsonl", "current")
    result = _prereg_run_coverage("current", tmp_path)
    assert "runs_referencing_current_text=1/1" in result.detail
