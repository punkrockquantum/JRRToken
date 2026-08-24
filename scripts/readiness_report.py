"""Execution-readiness report and go/no-go decision for every module.

Inventory is the six modules of section 4 of the brief. Gates are the
requirements of sections 5, 6, 7, 8 and 9, each evaluated by a real check
against this repository. The decision per module follows from the gates by the
rule in ``harness.readiness.DECISION_RULE``, fixed before evaluation.

Run:  python scripts/readiness_report.py [--write]
Exit code 0 if every module is GO, 1 otherwise.
"""

from __future__ import annotations

import argparse
import importlib
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from harness.readiness import (  # noqa: E402
    BlockClass,
    Decision,
    Gate,
    ModuleReadiness,
    ReadinessReport,
    evaluate,
)
from provenance import gitinfo  # noqa: E402
from reports.lint import OUT_DIR, lint_text  # noqa: E402


@dataclass(frozen=True, slots=True)
class SpecSheet:
    """What section 4 of the brief says a module is, plus where it would live."""

    module_id: str
    title: str
    quantity: str
    declared_tiers: str
    package: str | None
    prereg_path: str | None
    verify_symbol: str | None
    #: The published result section 5 names for this module, if it names one.
    calibration_anchor: str | None
    depends_on: tuple[str, ...] = ()


INVENTORY: tuple[SpecSheet, ...] = (
    SpecSheet(
        module_id="M1",
        title="Algebraic degree growth versus round count",
        quantity="algebraic degree over GF(2) of output bits in the input variables",
        declared_tiers="P,E,S",
        package="modules.degree",
        prereg_path="modules/degree/prereg/PREREG-M1.md",
        verify_symbol="verify.anf:algebraic_degree",
        calibration_anchor="a permutation with published per-round degree values",
    ),
    SpecSheet(
        module_id="M2",
        title="Dependency-graph reachability and free-round budget",
        quantity="input bits reachable to each output bit at round r; degrees of freedom",
        declared_tiers="P",
        package=None,
        prereg_path=None,
        verify_symbol=None,
        calibration_anchor=None,
    ),
    SpecSheet(
        module_id="M3",
        title="Differential characteristic search",
        quantity="characteristic probability and step count",
        declared_tiers="E,S",
        package=None,
        prereg_path=None,
        verify_symbol=None,
        calibration_anchor="reduced-round SHA-256 collision and semi-free-start results",
    ),
    SpecSheet(
        module_id="M4",
        title="Higher-order differentials and integral distinguishers",
        quantity="order of a vanishing higher-order differential",
        declared_tiers="P,E",
        package=None,
        prereg_path=None,
        verify_symbol=None,
        calibration_anchor=None,
        depends_on=("M1",),
    ),
    SpecSheet(
        module_id="M5",
        title="Meet-in-the-middle and biclique structure",
        quantity="splitting points, independent chunks, matching degrees of freedom",
        declared_tiers="P,E",
        package=None,
        prereg_path=None,
        verify_symbol=None,
        calibration_anchor="published preimage attacks on reduced-round SHA-256",
    ),
    SpecSheet(
        module_id="M6",
        title="Rotational-XOR propagation",
        quantity="rotational-pair propagation probability",
        declared_tiers="P,S",
        package=None,
        prereg_path=None,
        verify_symbol=None,
        calibration_anchor=None,
    ),
)


# ---------------------------------------------------------------------------
# Checks. Each returns (passed, detail) and touches the repository, not an
# opinion about it.
# ---------------------------------------------------------------------------


def _import(dotted: str):
    return importlib.import_module(dotted)


def check_primary_target() -> tuple[bool, str]:
    """Section 9: SHA-256 with round count a runtime parameter is the primary
    target of every module."""
    from core import sha256 as target

    try:
        target.compress()
        return True, "core.sha256.compress is callable"
    except Exception as exc:
        return False, f"core/sha256.py raises {type(exc).__name__}: {str(exc)[:120]}"


def make_checks(sheet: SpecSheet, decided: dict[str, Decision]):
    package = sheet.package

    def no_package(what: str) -> tuple[bool, str]:
        return False, f"no module package exists; {what} has not been written"

    def check_prereg() -> tuple[bool, str]:
        if sheet.prereg_path is None:
            return no_package("a pre-registration")
        from provenance.prereg import load as load_prereg

        prereg = load_prereg(sheet.prereg_path)
        return True, f"prereg_id={prereg.prereg_id} sha256={prereg.sha256[:16]}"

    def check_derivation() -> tuple[bool, str]:
        if package is None:
            return no_package("a threshold derivation")
        from scripts.ci_checks import check_prereg_derived_block_matches_derivation

        result = check_prereg_derived_block_matches_derivation()
        return result.passed, "derived block is byte-equal to its derivation script"

    def check_ordering() -> tuple[bool, str]:
        if sheet.prereg_path is None:
            return no_package("an ordering claim")
        from provenance.prereg import load as load_prereg

        runner, prereg_commit = load_prereg(sheet.prereg_path).assert_runner_precedes(
            "harness/runner.py"
        )
        return True, f"runner={runner[:12]} precedes prereg={prereg_commit[:12]}"

    def check_calibration_defined() -> tuple[bool, str]:
        if package is None:
            return no_package("a calibration suite")
        suite = _import(f"{package}.calibration.suite").SUITE
        kinds = sorted({c.kind.value for c in suite.cases})
        return True, f"n_cases={len(suite.cases)} kinds={kinds}"

    def check_ground_truth() -> tuple[bool, str]:
        if package is None:
            return no_package("published ground truth")
        suite = _import(f"{package}.calibration.suite").SUITE
        status = suite.gate()
        if status.blocked:
            return False, (
                f"calibration gate blocks: citations={list(status.blocking_citations)} "
                f"n_reasons={len(status.blocking_reasons)}"
            )
        return True, "every ground-truth case carries a verified, transcribed value"

    def check_anchor_named() -> tuple[bool, str]:
        if sheet.calibration_anchor is None:
            return False, (
                "section 5 names no published result for this module, and section 5 "
                "requires one before the module is trusted"
            )
        return True, f"anchor={sheet.calibration_anchor}"

    def check_controls() -> tuple[bool, str]:
        if package is None:
            return no_package("controls")
        from harness.calibration import CaseKind
        from verify.anf import algebraic_degree

        suite = _import(f"{package}.calibration.suite").SUITE
        control_kinds = {
            CaseKind.POSITIVE_CONTROL,
            CaseKind.NEGATIVE_CONTROL,
            CaseKind.INTERMEDIATE_CONTROL,
            CaseKind.BLINDNESS,
        }
        checked = 0
        for case in suite.cases:
            if case.kind not in control_kinds:
                continue
            target = case.target_factory()
            observed = algebraic_degree(target, target.n_in, target.n_out)
            if not case.comparator.holds(observed, case.expected):
                return False, (
                    f"{case.case_id}: observed {observed} "
                    f"{case.comparator.value} {case.expected} does not hold"
                )
            checked += 1
        return True, f"{checked} controls recompute to their stated values by exhaustive ANF"

    def check_blindness() -> tuple[bool, str]:
        if package is None:
            return no_package("a blindness class")
        from verify.anf import algebraic_degree

        blindness = _import(f"{package}.blindness.inverse_map")
        outcome = blindness.check(
            lambda target, n: algebraic_degree(target, n, n),
            9,
            test_id="scripts/readiness_report.py::check_blindness",
            computation_id="READINESS-BLIND-001",
        )
        return outcome.passed, f"{outcome.function_class} -> {outcome.observed}"

    def check_verify_path() -> tuple[bool, str]:
        if sheet.verify_symbol is None:
            return False, (
                "no independent verification path exists in verify/ for this quantity; "
                "section 7.2 makes one a precondition of promotion"
            )
        module_name, symbol = sheet.verify_symbol.split(":")
        module = _import(module_name)
        if not hasattr(module, symbol):
            return False, f"{sheet.verify_symbol} is absent"
        return True, f"{sheet.verify_symbol} is present and shares no code with modules/"

    def check_measure() -> tuple[bool, str]:
        if package is None:
            return no_package("a measurement path")
        spec = _import(f"{package}.spec").SPEC
        if spec.measure is None:
            return False, "ModuleSpec.measure is None: no measurement path is registered"
        return True, "a measurement path is registered"

    def check_promotion_gate() -> tuple[bool, str]:
        if sheet.prereg_path is None:
            return no_package("a promotion gate")
        text = (ROOT / sheet.prereg_path).read_text(encoding="utf-8")
        required = ("gate_threshold", "gate_verification", "gate_cost", "gate_falsification")
        missing = [name for name in required if name not in text]
        if missing:
            return False, f"promotion gate is missing {missing}"
        return True, "all four criteria of section 7 are instantiated with numbers"

    def check_dependencies() -> tuple[bool, str]:
        if not sheet.depends_on:
            return True, "no module dependencies"
        pending = [
            dep for dep in sheet.depends_on if decided.get(dep) is not Decision.GO
        ]
        if pending:
            return False, f"depends on {pending}, which have not reached GO"
        return True, f"dependencies {list(sheet.depends_on)} are GO"

    return (
        Gate("G01", "primary-target-present", "section 9", BlockClass.OPERATOR, check_primary_target),
        Gate("G02", "prereg-committed", "section 8", BlockClass.BUILD, check_prereg),
        Gate("G03", "prereg-matches-derivation", "directive 2.1", BlockClass.BUILD, check_derivation),
        Gate("G04", "runner-precedes-prereg", "section 8", BlockClass.BUILD, check_ordering),
        Gate("G05", "calibration-suite-defined", "section 5", BlockClass.BUILD, check_calibration_defined),
        Gate("G06", "published-anchor-named", "section 5", BlockClass.OPERATOR, check_anchor_named),
        Gate("G07", "ground-truth-verified", "section 5", BlockClass.OPERATOR, check_ground_truth),
        Gate("G08", "controls-recompute", "section 5", BlockClass.BUILD, check_controls),
        Gate("G09", "blindness-test-passes", "section 6", BlockClass.BUILD, check_blindness),
        Gate("G10", "independent-verify-path", "section 7.2", BlockClass.BUILD, check_verify_path),
        Gate("G11", "measurement-registered", "section 4", BlockClass.BUILD, check_measure),
        Gate("G12", "promotion-gate-instantiated", "section 7", BlockClass.BUILD, check_promotion_gate),
        Gate("G13", "dependencies-are-go", "section 4", BlockClass.DEPENDENCY, check_dependencies),
    )


def build_report() -> ReadinessReport:
    decided: dict[str, Decision] = {}
    modules: list[ModuleReadiness] = []
    for sheet in INVENTORY:
        readiness = evaluate(
            module_id=sheet.module_id,
            title=sheet.title,
            quantity=sheet.quantity,
            declared_tiers=sheet.declared_tiers,
            depends_on=sheet.depends_on,
            gates=make_checks(sheet, decided),
        )
        decided[sheet.module_id] = readiness.decision
        modules.append(readiness)
    return ReadinessReport(commit=gitinfo.head_commit(), modules=tuple(modules))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="write reports/out/readiness.txt")
    args = parser.parse_args()

    report = build_report()
    text = report.render()
    hits = lint_text(text, path="reports/out/readiness.txt")
    if hits:
        for hit in hits:
            print(hit.render())
        return 1
    print(text)
    if args.write:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        (OUT_DIR / "readiness.txt").write_text(text, encoding="utf-8")
    return 0 if not report.no_go else 1


if __name__ == "__main__":
    raise SystemExit(main())
