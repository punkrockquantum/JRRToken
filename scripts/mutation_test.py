"""Mutation testing: deliberate defects, each confirmed caught.

Section 8, VALIDATION: "Mutation testing on every layer: inject a minimum of five
deliberate defects per module and confirm each is caught by the test suite."

The catalogue below is committed source, so a mutant that stops being killed --
because a test was weakened or deleted -- shows up in a diff rather than in
nobody's memory. Each mutant names the tests expected to kill it; running the
whole suite per mutant would make this too slow to run, and a mutant killed by an
unrelated test is a weaker signal anyway.

Run:  python scripts/mutation_test.py [--layer tiers] [--list]
Exit code 0 if every mutant is killed.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True, slots=True)
class Mutant:
    mutant_id: str
    layer: str
    path: str
    old: str
    new: str
    tests: tuple[str, ...]
    defect: str


CATALOGUE: tuple[Mutant, ...] = (
    # -- tiers ---------------------------------------------------------------
    Mutant(
        "TIER-01",
        "tiers",
        "tiers/result.py",
        "        if other.tier is not self.tier:",
        "        if False:",
        ("tests/test_tiers_result.py",),
        "cross-tier operations stop raising",
    ),
    Mutant(
        "TIER-02",
        "tiers",
        "tiers/result.py",
        "        if self._mint is not _MINT:",
        "        if False:",
        ("tests/test_tiers_result.py",),
        "a Result can be constructed by hand with any tier label",
    ),
    Mutant(
        "TIER-03",
        "tiers",
        "tiers/result.py",
        "        if self.tier is Tier.P:\n            raise TierViolation(",
        "        if False:\n            raise TierViolation(",
        ("tests/test_tiers_result.py",),
        "a Tier P result accumulates repetitions",
    ),
    Mutant(
        "TIER-04",
        "tiers",
        "tiers/distribution.py",
        "        if len(self.seeds) < MIN_SEEDS:",
        "        if False:",
        ("tests/test_tiers_space_distribution.py",),
        "Tier S accepts fewer than 30 seeds",
    ),
    Mutant(
        "TIER-05",
        "tiers",
        "tiers/finding.py",
        "    if blindness_test is None:",
        "    if False:",
        ("tests/test_tiers_finding.py",),
        "a negative with no blindness test is labelled NEGATIVE",
    ),
    Mutant(
        "TIER-06",
        "tiers",
        "tiers/space.py",
        "        if self.full_cardinality < self.cardinality:",
        "        if False:",
        ("tests/test_tiers_space_distribution.py",),
        "an enumerated space may exceed its universe",
    ),
    # -- stats ---------------------------------------------------------------
    Mutant(
        "STAT-01",
        "stats",
        "stats/bh.py",
        "    if len(tests) != family_size:",
        "    if False:",
        ("tests/test_stats_bh.py",),
        "BH corrects across whatever happened to finish, not the declared family",
    ),
    Mutant(
        "STAT-02",
        "stats",
        "stats/bh.py",
        "        if test.p_value <= (i / m) * alpha:",
        "        if test.p_value <= alpha:",
        ("tests/test_stats_bh.py",),
        "the step-up uses the uncorrected level",
    ),
    Mutant(
        "STAT-03",
        "stats",
        "stats/pvalue.py",
        "    if p < UNDERFLOW_FLOOR:",
        "    if False:",
        ("tests/test_stats_normal_pvalue.py",),
        "an underflowed p-value prints as 0.00e+00",
    ),
    Mutant(
        "STAT-04",
        "stats",
        "stats/power.py",
        "    return 1.0 - (1.0 - power) ** (1.0 / n_draws)",
        "    return 1.0 - (1.0 - power) ** (1.0 / (n_draws + 1))",
        ("tests/test_stats_power_censored.py", "tests/test_prereg_m1.py"),
        "the minimum detectable effect is computed at the wrong sample size",
    ),
    Mutant(
        "STAT-05",
        "stats",
        "stats/censored.py",
        "                total += _safe_log(normal.cdf((mu - ci) / sigma))",
        "                total += 0.0",
        ("tests/test_stats_power_censored.py",),
        "the Tobit likelihood ignores censored observations, collapsing to OLS",
    ),
    Mutant(
        "STAT-06",
        "stats",
        "stats/normal.py",
        "    return 0.5 * math.erfc(-x / SQRT_2)",
        "    return 0.5 * math.erfc(x / SQRT_2)",
        ("tests/test_stats_normal_pvalue.py",),
        "the normal CDF is reflected",
    ),
    # -- provenance ----------------------------------------------------------
    Mutant(
        "PROV-01",
        "provenance",
        "provenance/store.py",
        "            if not record.is_valid(expected_seq=line_no, expected_prev=prev):",
        "            if False:",
        ("tests/test_provenance_store.py",),
        "an edited run log reopens without complaint",
    ),
    Mutant(
        "PROV-02",
        "provenance",
        "provenance/store.py",
        '            if entry["content_sha256"] == content and entry["path"] != self.path.name:',
        "            if False:",
        ("tests/test_provenance_store.py",),
        "two byte-identical files may both claim to be independent runs",
    ),
    Mutant(
        "PROV-03",
        "provenance",
        "provenance/store.py",
        "        if len(on_disk) != len(self._records) or on_disk[-1].hash != self.head_hash:",
        "        if False:",
        ("tests/test_provenance_store.py",),
        "appending proceeds after an out-of-band edit",
    ),
    Mutant(
        "PROV-04",
        "provenance",
        "provenance/prereg.py",
        "        if not gitinfo.is_ancestor(runner_commit, prereg_commit):",
        "        if not gitinfo.is_ancestor(prereg_commit, runner_commit):",
        ("tests/test_provenance_ordering.py",),
        "the ordering assertion is reversed, so a prereg predating the runner passes",
    ),
    Mutant(
        "PROV-05",
        "provenance",
        "provenance/prereg.py",
        "    missing = [key for key in REQUIRED_FIELDS if key not in fields]",
        "    missing = []",
        ("tests/test_prereg_m1.py",),
        "a pre-registration missing required fields loads",
    ),
    Mutant(
        "PROV-06",
        "provenance",
        "provenance/store.py",
        "        if path.exists():\n            raise AppendOnlyViolation(",
        "        if False:\n            raise AppendOnlyViolation(",
        ("tests/test_provenance_store.py",),
        "an existing run log is reopened for rewriting",
    ),
    # -- harness -------------------------------------------------------------
    Mutant(
        "HARN-01",
        "harness",
        "harness/calibration.py",
        "            if citation.verification is Verification.UNVERIFIED:",
        "            if False:",
        ("tests/test_harness_calibration_registry.py", "tests/test_module_degree.py"),
        "an unverified citation stops blocking its module",
    ),
    Mutant(
        "HARN-02",
        "harness",
        "harness/calibration.py",
        "            if case.expected is PENDING_PRIMARY_SOURCE:",
        "            if False:",
        ("tests/test_harness_calibration_registry.py", "tests/test_module_degree.py"),
        "a case with no transcribed expected value stops blocking",
    ),
    Mutant(
        "HARN-03",
        "harness",
        "harness/registry.py",
        "        if regime is not expected:",
        "        if False:",
        ("tests/test_harness_calibration_registry.py", "tests/test_module_degree.py"),
        "a module runs under the wrong execution regime",
    ),
    Mutant(
        "HARN-04",
        "harness",
        "harness/promotion.py",
        "        return all(passed for _, passed in self.criteria)",
        "        return any(passed for _, passed in self.criteria)",
        ("tests/test_harness_promotion.py",),
        "one criterion out of four promotes a candidate",
    ),
    Mutant(
        "HARN-05",
        "harness",
        "harness/promotion.py",
        '        if not any("brute" in n for n in names):',
        "        if False:",
        ("tests/test_harness_promotion.py",),
        "a cost comparison omits brute force",
    ),
    Mutant(
        "HARN-06",
        "harness",
        "harness/sweep.py",
        '        if existing[0] in ("done", "censored"):',
        "        if False:",
        ("tests/test_harness_sweep.py",),
        "a completed sweep cell is overwritten",
    ),
    Mutant(
        "HARN-07",
        "harness",
        "harness/calibration.py",
        "        if measure is None:",
        "        if measure is not None and False:",
        ("tests/test_harness_calibration_registry.py",),
        "a suite with no measurement path fails silently instead of raising",
    ),
    # -- core ----------------------------------------------------------------
    Mutant(
        "CORE-01",
        "core",
        "core/gf2.py",
        "    return x_to_2_to_k(n) == 2",
        "    return True",
        ("tests/test_core_gf2.py",),
        "the irreducibility test accepts reducible polynomials",
    ),
    Mutant(
        "CORE-02",
        "core",
        "core/gf2.py",
        "    for tail in range(1, 1 << n, 2):  # constant term must be 1",
        "    for tail in range(0, 1 << n, 1):  # constant term must be 1",
        ("tests/test_core_gf2.py",),
        "the field modulus search admits polynomials divisible by x",
    ),
    Mutant(
        "CORE-03",
        "core",
        "core/keccak.py",
        "        offsets[x + 5 * y] = (t + 1) * (t + 2) // 2",
        "        offsets[x + 5 * y] = (t + 1) * (t + 3) // 2",
        ("tests/test_core_keccak_mimc.py",),
        "the rho offsets are derived from the wrong triangular number",
    ),
    Mutant(
        "CORE-04",
        "core",
        "core/keccak.py",
        "            register ^= 0x171",
        "            register ^= 0x71",
        ("tests/test_core_keccak_mimc.py",),
        "the iota LFSR uses a truncated feedback polynomial",
    ),
    Mutant(
        "CORE-05",
        "core",
        "core/targets.py",
        "            out |= (_parity(row & x)) << i",
        "            out |= (_parity(row & x)) << 0",
        ("tests/test_core_targets.py",),
        "the positive control collapses every output bit onto bit 0",
    ),
    Mutant(
        "CORE-06",
        "core",
        "core/mimc.py",
        "        if n % 2 == 0:",
        "        if False:",
        ("tests/test_core_keccak_mimc.py",),
        "MiMC is built over a field where the cube map is not a permutation",
    ),
    # -- verify --------------------------------------------------------------
    Mutant(
        "VRFY-01",
        "verify",
        "verify/anf.py",
        "                coeffs[i + step] ^= coeffs[i]",
        "                coeffs[i] ^= coeffs[i + step]",
        ("tests/test_verify_anf.py", "tests/test_core_targets.py"),
        "the Moebius transform runs in the wrong direction",
    ),
    Mutant(
        "VRFY-02",
        "verify",
        "verify/anf.py",
        "            weight = index.bit_count()",
        "            weight = index",
        ("tests/test_verify_anf.py",),
        "degree is read off the monomial index rather than its Hamming weight",
    ),
    Mutant(
        "VRFY-03",
        "verify",
        "verify/anf.py",
        "    best = -1",
        "    best = 0",
        ("tests/test_verify_anf.py",),
        "the zero function is given degree 0, indistinguishable from a constant",
    ),
    Mutant(
        "VRFY-04",
        "verify",
        "verify/anf.py",
        "        total ^= f(point)",
        "        total += f(point)",
        ("tests/test_verify_anf.py",),
        "the higher-order derivative sums over the integers, not GF(2)",
    ),
    Mutant(
        "VRFY-05",
        "verify",
        "verify/anf.py",
        "    return [(f(x) >> out_bit) & 1 for x in range(1 << n)]",
        "    return [(f(x) >> out_bit) & 3 for x in range(1 << n)]",
        ("tests/test_verify_anf.py",),
        "the truth table extracts two bits instead of one",
    ),
    # -- reports -------------------------------------------------------------
    Mutant(
        "RPRT-01",
        "reports",
        "reports/lint.py",
        "FORBIDDEN_TERMS = BRIEF_FORBIDDEN + EXTENDED_FORBIDDEN",
        "FORBIDDEN_TERMS = EXTENDED_FORBIDDEN",
        ("tests/test_reports_lint.py",),
        "the terms named in the brief drop out of the lint",
    ),
    Mutant(
        "RPRT-02",
        "reports",
        "reports/lint.py",
        'return re.compile(r"(?<![A-Za-z])" + re.escape(term) + r"(?![A-Za-z])", re.IGNORECASE)',
        'return re.compile(re.escape(term), re.IGNORECASE)',
        ("tests/test_reports_lint.py",),
        "the lint fires inside longer words",
    ),
    Mutant(
        "RPRT-03",
        "reports",
        "reports/lint.py",
        'return re.compile(r"(?<![A-Za-z])" + re.escape(term) + r"(?![A-Za-z])", re.IGNORECASE)',
        'return re.compile(r"(?<![A-Za-z])" + re.escape(term) + r"(?![A-Za-z])")',
        ("tests/test_reports_lint.py",),
        "the lint becomes case sensitive",
    ),
    Mutant(
        "RPRT-04",
        "reports",
        "reports/lint.py",
        "            if pattern.search(line):",
        "            if False:",
        ("tests/test_reports_lint.py",),
        "the lint never reports a hit",
    ),
    Mutant(
        "RPRT-05",
        "reports",
        "reports/lint.py",
        "_PATTERNS = {term: _pattern(term) for term in FORBIDDEN_TERMS}",
        "_PATTERNS = {term: _pattern(term) for term in FORBIDDEN_TERMS[:1]}",
        ("tests/test_reports_lint.py",),
        "only the first forbidden term is checked",
    ),
    # -- modules -------------------------------------------------------------
    Mutant(
        "MDEG-01",
        "modules",
        "modules/degree/citations.py",
        '    claim=(\n        "upper bounds on the algebraic degree of r rounds of Keccak-f and of its "\n        "inverse, per round; and a bound on the degree of iterated permutations whose "\n        "non-linear layer is parallel applications of smaller balanced S-boxes"\n    ),\n    verification=Verification.UNVERIFIED,',
        '    claim=(\n        "upper bounds on the algebraic degree of r rounds of Keccak-f and of its "\n        "inverse, per round; and a bound on the degree of iterated permutations whose "\n        "non-linear layer is parallel applications of smaller balanced S-boxes"\n    ),\n    verification=Verification.PRIMARY_SOURCE,',
        ("tests/test_module_degree.py",),
        "an unchecked citation is marked as read from the primary source",
    ),
    Mutant(
        "MDEG-02",
        "modules",
        "modules/degree/calibration/suite.py",
        '                expected=PENDING_PRIMARY_SOURCE,\n                expectation_provenance=Provenance(citation_key="CITE-BCD11"),',
        '                expected=2**rounds,\n                expectation_provenance=Provenance(citation_key="CITE-BCD11"),',
        ("tests/test_module_degree.py",),
        "a derived bound is substituted for the published value it must reproduce",
    ),
    Mutant(
        "MDEG-03",
        "modules",
        "modules/degree/calibration/suite.py",
        "POWER_EXPONENT_MID = 31",
        "POWER_EXPONENT_MID = 3",
        ("tests/test_module_degree.py",),
        "the intermediate control stops being intermediate",
    ),
    Mutant(
        "MDEG-04",
        "modules",
        "modules/degree/spec.py",
        "    measure=None,",
        "    measure=lambda target, case: 0,",
        ("tests/test_module_degree.py",),
        "a measurement path is registered before one exists",
    ),
    Mutant(
        "MDEG-05",
        "modules",
        "modules/degree/spec.py",
        "    declared_tiers=frozenset({Tier.P, Tier.E, Tier.S}),",
        "    declared_tiers=frozenset({Tier.P}),",
        ("tests/test_module_degree.py",),
        "the module's declared tiers no longer match its pre-registration",
    ),
    Mutant(
        "MDEG-06",
        "modules",
        "modules/degree/prereg/derive_thresholds.py",
        "SEEDS_PER_CELL = 50",
        "SEEDS_PER_CELL = 40",
        ("tests/test_prereg_m1.py",),
        "the pre-registration document drifts from its derivation",
    ),
    Mutant(
        "MDEG-07",
        "modules",
        "modules/degree/blindness/inverse_map.py",
        "    return observed_degree == n - 1",
        "    return True",
        ("tests/test_blindness_inverse.py",),
        "the blindness test passes for any measurement, becoming a tautology",
    ),
)


def pytest_command() -> list[str]:
    """Prefer the interpreter running this script; fall back to a pytest on PATH
    (this repository's build host installs pytest in its own virtual environment)."""
    probe = subprocess.run(
        [sys.executable, "-c", "import pytest"], capture_output=True, text=True
    )
    if probe.returncode == 0:
        return [sys.executable, "-m", "pytest"]
    found = shutil.which("pytest")
    if found is None:
        raise SystemExit("pytest is not importable and not on PATH")
    return [found]


PYTEST = pytest_command()


def run_pytest(tests: tuple[str, ...]) -> int:
    return subprocess.run(
        [*PYTEST, "-x", "-q", "--no-header", *tests],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    ).returncode


def apply_mutant(mutant: Mutant) -> tuple[bool, str]:
    path = ROOT / mutant.path
    original = path.read_text(encoding="utf-8")
    occurrences = original.count(mutant.old)
    if occurrences != 1:
        return False, f"anchor matched {occurrences} times; the mutant no longer applies"
    try:
        path.write_text(original.replace(mutant.old, mutant.new), encoding="utf-8")
        code = run_pytest(mutant.tests)
    finally:
        path.write_text(original, encoding="utf-8")
    return (code != 0), ("killed" if code != 0 else "SURVIVED")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--layer", default=None)
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()

    catalogue = [m for m in CATALOGUE if args.layer in (None, m.layer)]
    layers: dict[str, int] = {}
    for mutant in catalogue:
        layers[mutant.layer] = layers.get(mutant.layer, 0) + 1

    if args.list:
        for mutant in catalogue:
            print(f"{mutant.mutant_id} layer={mutant.layer} defect={mutant.defect}")
        return 0

    survivors: list[str] = []
    for mutant in catalogue:
        killed, detail = apply_mutant(mutant)
        print(
            f"mutant={mutant.mutant_id} layer={mutant.layer} file={mutant.path} "
            f"killed={killed} detail={detail} defect={mutant.defect}"
        )
        if not killed:
            survivors.append(mutant.mutant_id)

    for layer, count in sorted(layers.items()):
        print(f"layer={layer} mutants={count} minimum_required=5 meets_minimum={count >= 5}")
    print(f"mutants={len(catalogue)} survivors={len(survivors)} {survivors}")
    below_minimum = [layer for layer, count in layers.items() if count < 5 and args.layer is None]
    if below_minimum:
        print(f"layers_below_minimum={below_minimum}")
    return 1 if survivors or below_minimum else 0


if __name__ == "__main__":
    raise SystemExit(main())
