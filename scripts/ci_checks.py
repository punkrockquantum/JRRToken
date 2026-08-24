"""Structural checks run in CI.

Section 10: "A CI check asserts that verify/ does not import modules/, and that
reports/ contains no natural-language conclusion strings."

Two further checks are here because they guard claims the rest of the repository
makes: that the pre-registration's derived numbers still match their derivation,
and that the provenance runner was committed before the pre-registration it
stamps.

Run:  python scripts/ci_checks.py
Exit code 0 if every check passes, 1 otherwise.
"""

from __future__ import annotations

import ast
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


@dataclass(frozen=True, slots=True)
class CheckResult:
    name: str
    passed: bool
    detail: str = ""

    def render(self) -> str:
        return f"check={self.name} passed={self.passed}" + (
            f" detail={self.detail}" if self.detail else ""
        )


def _imported_roots(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                roots.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level:  # relative import: stays inside the package
                continue
            if node.module:
                roots.add(node.module.split(".")[0])
    return roots


def _check_no_import(source_dir: str, forbidden: str, name: str) -> CheckResult:
    offenders = []
    for path in sorted((ROOT / source_dir).rglob("*.py")):
        if forbidden in _imported_roots(path):
            offenders.append(str(path.relative_to(ROOT)))
    return CheckResult(
        name=name,
        passed=not offenders,
        detail="" if not offenders else f"{source_dir} imports {forbidden}: {offenders}",
    )


def check_verify_does_not_import_modules() -> CheckResult:
    return _check_no_import("verify", "modules", "verify_does_not_import_modules")


def check_modules_do_not_import_verify() -> CheckResult:
    return _check_no_import("modules", "verify", "modules_do_not_import_verify")


def check_reports_have_no_prose() -> CheckResult:
    from reports.lint import lint_out_dir

    hits = lint_out_dir()
    return CheckResult(
        name="reports_contain_no_prose_conclusions",
        passed=not hits,
        detail="" if not hits else "; ".join(h.render() for h in hits[:10]),
    )


def check_prereg_derived_block_matches_derivation() -> CheckResult:
    from modules.degree.prereg.derive_thresholds import render_block

    text = (ROOT / "modules/degree/prereg/PREREG-M1.md").read_text(encoding="utf-8")
    block = render_block()
    return CheckResult(
        name="prereg_derived_block_matches_derivation",
        passed=block in text,
        detail="" if block in text else "PREREG-M1.md does not contain the derived block verbatim",
    )


def check_runner_precedes_prereg() -> CheckResult:
    from provenance.prereg import load as load_prereg
    from tiers.errors import ProvenanceError

    try:
        prereg = load_prereg("modules/degree/prereg/PREREG-M1.md")
        runner_commit, prereg_commit = prereg.assert_runner_precedes("harness/runner.py")
    except ProvenanceError as exc:
        return CheckResult(name="runner_precedes_prereg", passed=False, detail=str(exc))
    return CheckResult(
        name="runner_precedes_prereg",
        passed=True,
        detail=f"runner={runner_commit[:12]} prereg={prereg_commit[:12]}",
    )


CHECKS = (
    check_verify_does_not_import_modules,
    check_modules_do_not_import_verify,
    check_reports_have_no_prose,
    check_prereg_derived_block_matches_derivation,
    check_runner_precedes_prereg,
)


def run_all() -> list[CheckResult]:
    return [check() for check in CHECKS]


def main() -> int:
    results = run_all()
    for result in results:
        print(result.render())
    failed = [r for r in results if not r.passed]
    print(f"checks={len(results)} failed={len(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
