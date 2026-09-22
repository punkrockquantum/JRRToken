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
import os
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
        '        if other.tier is not self.tier:\n            raise TierViolation(\n                f"Refusing to {op} a Tier {self.tier.value} result with a Tier "',
        '        if False:\n            raise TierViolation(\n                f"Refusing to {op} a Tier {self.tier.value} result with a Tier "',
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
    Mutant(
        "TIER-07",
        "tiers",
        "tiers/result.py",
        '        if other.tier is not self.tier:\n            raise TierViolation(\n                f"Refusing to compare a Tier {self.tier.value} result with a Tier "',
        '        if False:\n            raise TierViolation(\n                f"Refusing to compare a Tier {self.tier.value} result with a Tier "',
        ("tests/test_integrity_regressions.py",),
        "cross-tier equality answers False instead of refusing the comparison",
    ),
    Mutant(
        "TIER-08",
        "tiers",
        "tiers/result.py",
        "        payload=MappingProxyType(copy.deepcopy(dict(payload or {}))),",
        "        payload=dict(payload or {}),",
        ("tests/test_integrity_regressions.py",),
        "a frozen result's payload becomes editable in place",
    ),
    Mutant(
        "TIER-09",
        "tiers",
        "tiers/distribution.py",
        "            if not math.isfinite(value):",
        "            if False:",
        ("tests/test_integrity_regressions.py",),
        "a NaN seed value is folded into the median and the IQR",
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
    Mutant(
        "PROV-07",
        "provenance",
        "provenance/store.py",
        "            if declared is not None and declared != len(records):",
        "            if False:",
        ("tests/test_integrity_regressions.py",),
        "a closed log can lose records from the middle without detection",
    ),
    Mutant(
        "PROV-08",
        "provenance",
        "provenance/store.py",
        '        if entry["n_records"] != len(self._records):',
        "        if False:",
        ("tests/test_integrity_regressions.py",),
        "a sealed log can be truncated from the end without detection",
    ),
    Mutant(
        "PROV-09",
        "provenance",
        "provenance/store.py",
        '        if any(r.payload.get("kind") == "run_end" for r in on_disk):',
        "        if False:",
        ("tests/test_integrity_regressions.py",),
        "a closed run is reopened and appended to",
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
    Mutant(
        "HARN-08",
        "harness",
        "harness/sweep.py",
        "        if require_complete and len(rows) != planned:",
        "        if False:",
        ("tests/test_integrity_regressions.py",),
        "a partly finished sweep cell is returned as though it were complete",
    ),
    Mutant(
        "HARN-09",
        "harness",
        "harness/readiness.py",
        "        return Decision.NO_GO if self.blocking_failures else Decision.GO",
        "        return Decision.GO if self.blocking_failures else Decision.NO_GO",
        ("tests/test_readiness.py",),
        "the go/no-go decision is inverted",
    ),
    Mutant(
        "HARN-10",
        "harness",
        "harness/readiness.py",
        "        return Decision.GO if clear == len(self.targets) else Decision.PARTIAL",
        "        return Decision.GO",
        ("tests/test_readiness.py",),
        "a module with some blocked targets is reported as fully GO",
    ),
    Mutant(
        "HARN-11",
        "harness",
        "harness/readiness.py",
        "            passed, detail = False, f\"check raised {type(exc).__name__}: {exc}\"",
        '            passed, detail = True, f"check raised {type(exc).__name__}: {exc}"',
        ("tests/test_readiness.py",),
        "a gate whose check crashes is counted as passed",
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
        "            result ^= a",
        "            result |= a",
        ("tests/test_core_gf2.py",),
        "carry-less multiplication accumulates by OR instead of XOR",
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
        "                rc ^= 1 << ((1 << j) - 1)",
        "                rc ^= 1 << j",
        ("tests/test_core_keccak_mimc.py",),
        "the iota constants are placed at the wrong bit positions",
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
    Mutant(
        "CORE-07",
        "core",
        "core/targets.py",
        "    if not 0 <= x < (1 << n_in):",
        "    if False:",
        ("tests/test_integrity_regressions.py",),
        "targets silently truncate an out-of-range input instead of refusing it",
    ),
    Mutant(
        "CORE-08",
        "core",
        "core/targets.py",
        "        if exponent <= 0:",
        "        if False:",
        ("tests/test_integrity_regressions.py",),
        "the zero-exponent power map is admitted with a wrong stated degree",
    ),
    Mutant(
        "MEAS-01",
        "measure",
        "modules/degree/measure.py",
        "                bits.append(max(a, b))",
        "                bits.append(min(a, b))",
        ("tests/test_measure.py",),
        "XOR takes the minimum degree, so the bound falls below the truth",
    ),
    Mutant(
        "MEAS-02",
        "measure",
        "modules/degree/measure.py",
        "            None if (a is None or b is None) else a + b\n            for a, b in zip(self.bits, other.bits)",
        "            None if (a is None or b is None) else max(a, b)\n            for a, b in zip(self.bits, other.bits)",
        ("tests/test_measure.py",),
        "AND does not add its operands' degrees, understating every product",
    ),
    Mutant(
        "MEAS-03",
        "measure",
        "modules/degree/measure.py",
        "    if bound > n - 1:\n        return n - 1, True",
        "    if bound > n:\n        return n, True",
        ("tests/test_measure.py",),
        "the permutation cap is applied one bit too high",
    ),
    Mutant(
        "MEAS-04",
        "measure",
        "modules/degree/measure.py",
        "            if accumulator:\n                return weight",
        "            if not accumulator:\n                return weight",
        ("tests/test_measure.py",),
        "the exact degree reads the wrong branch of the coefficient test",
    ),
    Mutant(
        "MEAS-05",
        "measure",
        "modules/degree/measure.py",
        "        if total:\n            return WitnessOutcome(",
        "        if not total:\n            return WitnessOutcome(",
        ("tests/test_measure.py",),
        "a vanishing derivative is reported as a witness",
    ),
    Mutant(
        "MEAS-06",
        "measure",
        "modules/degree/measure.py",
        "    d = a.degree\n    return SymbolicWord([d] * a.width, a.width)",
        "    d = 0\n    return SymbolicWord([d] * a.width, a.width)",
        ("tests/test_measure.py",),
        "Frobenius squaring resets the degree instead of carrying it",
    ),
    Mutant(
        "MEAS-07",
        "measure",
        "modules/degree/measure.py",
        "    k = m.bit_length()\n    return k if (1 << k) - 1 <= m else k - 1",
        "    k = m.bit_length()\n    return k",
        ("tests/test_stage_a.py",),
        "the derived bound overstates the reachable Hamming weight by one",
    ),
    Mutant(
        "MEAS-08",
        "measure",
        "modules/degree/measure.py",
        "    reach = min(3**target.n_rounds, modulus_order)",
        "    reach = min(2**target.n_rounds, modulus_order)",
        ("tests/test_stage_a.py",),
        "the exponent support is computed for squaring rather than cubing, making the derived bound unsound",
    ),
    Mutant(
        "MEAS-09",
        "measure",
        "modules/degree/blindness/saturated_power.py",
        "    return observed_degree == n - 1",
        "    return True",
        ("tests/test_stage_a.py",),
        "the saturation blindness test passes for any measurement",
    ),
    Mutant(
        "MEAS-12",
        "measure",
        "modules/degree/measure.py",
        "    k = m.bit_length()",
        "    k = m.bit_length() + 1",
        ("tests/test_stage_a.py",),
        "the derived bound overstates the reachable Hamming weight",
    ),
    Mutant(
        "MEAS-10",
        "measure",
        "modules/degree/measure.py",
        "    raw_iterated = per_application**target.rounds",
        "    raw_iterated = per_application",
        ("tests/test_stage_b.py",),
        "the iterated bound ignores the round count, becoming unsound under composition",
    ),
    Mutant(
        "MEAS-11",
        "measure",
        "modules/degree/measure.py",
        "    raw_block = per_block_application**target.rounds",
        "    raw_block = per_block_application",
        ("tests/test_stage_b.py",),
        "the block-restricted bound ignores the round count",
    ),
    Mutant(
        "CORE-09",
        "core",
        "core/targets.py",
        "        return bin(self.effective_exponent).count(\"1\")",
        "        return bin(self.exponent).count(\"1\") * self.rounds",
        ("tests/test_stage_b.py",),
        "the iterated control's stated degree ignores exponent reduction mod 2^n-1",
    ),
    Mutant(
        "CORE-10",
        "core",
        "core/targets.py",
        "        return self.active - 1",
        "        return self.n - 1",
        ("tests/test_stage_b.py",),
        "the block control's ceiling becomes the state size, so no breach is detectable",
    ),
    Mutant(
        "RPRT-07",
        "reports",
        "scripts/render_reports.py",
        "    out_dir = Path(args.out_dir) if args.out_dir else OUT_DIR",
        "    out_dir = OUT_DIR",
        ("tests/test_documented_commands.py",),
        "the renderer ignores --out-dir and writes into the tracked directory, dirtying the tree",
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
    Mutant(
        "VRFY-06",
        "verify",
        "verify/packed.py",
        "        coefficients ^= (coefficients & low_mask(n, index)) << step",
        "        coefficients ^= (coefficients & low_mask(n, index)) >> step",
        ("tests/test_verify_packed.py",),
        "the packed Moebius transform shifts the wrong way, so coefficients land "
        "on the wrong monomials",
    ),
    Mutant(
        "VRFY-07",
        "verify",
        "verify/packed.py",
        "            nxt[weight + 1] |= mask << half",
        "            nxt[weight] |= mask << half",
        ("tests/test_verify_packed.py",),
        "the weight masks stop distinguishing Hamming weights, so every degree "
        "reads as the same value",
    ),
    Mutant(
        "VRFY-08",
        "verify",
        "verify/packed.py",
        "    if coefficients == 0:\n        return -1",
        "    if coefficients == 0:\n        return 0",
        ("tests/test_verify_packed.py",),
        "the zero function is given degree 0 in the packed path, indistinguishable "
        "from a non-zero constant. Note: replacing the guard with `if False` is an "
        "equivalent mutant, because the loop then falls through to the same -1; "
        "the value is what carries the behaviour, so the value is what is mutated",
    ),
    Mutant(
        "VRFY-09",
        "verify",
        "verify/packed.py",
        "    return [universe ^ low_mask(n, i) for i in range(n)]",
        "    return [low_mask(n, i) for i in range(n)]",
        ("tests/test_verify_packed.py", "tests/test_verify_keccak_columns.py"),
        "the input columns are complemented, so every target is evaluated on the "
        "bitwise complement of its input",
    ),
    Mutant(
        "VRFY-10",
        "verify",
        "verify/keccak_columns.py",
        "        d = [c[(x - 1) % 5] ^ c[(x + 1) % 5] for x in range(5)]",
        "        d = [c[(x - 1) % 5] for x in range(5)]",
        ("tests/test_verify_keccak_columns.py",),
        "theta loses one of its two mixing terms, so the bitsliced permutation is "
        "no longer Keccak",
    ),
    Mutant(
        "VRFY-11",
        "verify",
        "verify/keccak_columns.py",
        "                a[x + 5 * y] = b[x + 5 * y] ^ (\n                    (universe ^ b[(x + 1) % 5 + 5 * y]) & b[(x + 2) % 5 + 5 * y]\n                )",
        "                a[x + 5 * y] = b[x + 5 * y] ^ (\n                    b[(x + 1) % 5 + 5 * y] & b[(x + 2) % 5 + 5 * y]\n                )",
        ("tests/test_verify_keccak_columns.py",),
        "chi drops its complement, which changes the permutation while leaving its "
        "algebraic degree at 2 -- caught only by comparison against permute",
    ),
    Mutant(
        "VRFY-12",
        "verify",
        "verify/keccak_columns.py",
        "        if constants[rnd] & 1:\n            a[0] ^= universe",
        "        if False:\n            a[0] ^= universe",
        ("tests/test_verify_keccak_columns.py",),
        "iota is skipped, so the round constants never enter the state",
    ),
    Mutant(
        "EXHT-01",
        "exhaustive",
        "harness/calibration.py",
        "        cases = tuple(c for c in self.cases if c.kind is not CaseKind.PUBLISHED_GROUND_TRUTH)",
        "        cases = tuple(c for c in self.cases if c.kind is CaseKind.EXHAUSTIVE_GROUND_TRUTH)",
        ("tests/test_exhaustive_truth.py", "tests/test_measure.py"),
        "run_controls silently narrows to the exhaustive cases, so the controls "
        "stop being run while the report still says satisfied",
    ),
    Mutant(
        "EXHT-02",
        "exhaustive",
        "harness/calibration.py",
        "        if not self.allow_missing_ground_truth:\n            required_kinds.insert(0, CaseKind.PUBLISHED_GROUND_TRUTH)",
        "        if not self.allow_missing_ground_truth:\n            required_kinds.insert(0, CaseKind.EXHAUSTIVE_GROUND_TRUTH)",
        ("tests/test_exhaustive_truth.py", "tests/test_harness_calibration_registry.py"),
        "an exhaustive ground truth is accepted in place of a published anchor -- "
        "the substitution E-09 exists to refuse",
    ),
    Mutant(
        "EXHT-03",
        "exhaustive",
        "scripts/exhaust.py",
        "        if mismatches:",
        "        if False:",
        ("tests/test_exhaustive_truth.py",),
        "the exhaustive runner stops checking its bitsliced evaluation against "
        "core.keccak.permute, so it could exhaust the wrong function",
    ),
    Mutant(
        "EXHT-04",
        "exhaustive",
        "scripts/exhaust.py",
        "        if exact >= KECCAK_WIDTH - 1:\n            break",
        "        if exact >= 2:\n            break",
        ("tests/test_exhaustive_truth.py",),
        "the Keccak table stops at the first round instead of at saturation, so "
        "later rounds are silently absent",
    ),
    Mutant(
        "EXHT-05",
        "exhaustive",
        "scripts/exhaust.py",
        '                "sound": bound.value >= exact,',
        '                "sound": True,',
        ("tests/test_exhaustive_truth.py",),
        "soundness is recorded as true rather than computed, so an unsound bound "
        "would be reported as sound",
    ),
    Mutant(
        "WTNS-01",
        "witness",
        "scripts/witness_calibration.py",
        "    vanishes_deductively = k > exact",
        "    vanishes_deductively = k > exact + 1",
        ("tests/test_witness_calibration.py",),
        "the deductive vanishing boundary moves up by one, so a cell where the "
        "probe legitimately witnesses is classified as a soundness violation and "
        "one where it must not is classified as permitted",
    ),
    Mutant(
        "WTNS-02",
        "witness",
        "scripts/witness_calibration.py",
        '        "soundness_violated": bool(vanishes_deductively and witnessed > 0),',
        '        "soundness_violated": False,',
        ("tests/test_witness_calibration.py",),
        "the soundness flag becomes a constant, so a probe witnessing above the "
        "exact degree is recorded as clean",
    ),
    Mutant(
        "WTNS-03",
        "witness",
        "scripts/witness_calibration.py",
        "        if outcome.witnessed:\n            witnessed += 1",
        "        if outcome.witnessed:\n            witnessed += 0",
        ("tests/test_witness_calibration.py",),
        "witnesses are never counted, so every rate reads zero and the deductive "
        "arm passes vacuously",
    ),
    Mutant(
        "WTNS-04",
        "witness",
        "scripts/witness_calibration.py",
        "    return 1 if violations else 0",
        "    return 0",
        ("tests/test_witness_calibration.py",),
        "a soundness violation no longer fails the command",
    ),
    Mutant(
        "WTNS-05",
        "witness",
        "scripts/witness_calibration.py",
        "        if k > MAX_PROBE_DIM:\n            skipped.append({\"k\": k, \"cost_evaluations_per_seed\": 2**k})\n            continue",
        "        if k > MAX_PROBE_DIM:\n            continue",
        ("tests/test_witness_calibration.py",),
        "cells too costly to run disappear silently instead of being reported "
        "with their cost",
    ),
    Mutant(
        "STAT-CP-01",
        "witness",
        "stats/power.py",
        "    tail = (1.0 - confidence) / 2.0",
        "    tail = 1.0 - confidence",
        ("tests/test_stats_clopper_pearson.py",),
        "the two-sided interval puts the whole tail mass in each side, so every "
        "interval is too narrow",
    ),
    Mutant(
        "STAT-CP-02",
        "witness",
        "stats/power.py",
        "        lower = bisect(lambda p: 1.0 - binomial_tail_at_most(successes - 1, n_draws, p) <= tail)",
        "        lower = bisect(lambda p: 1.0 - binomial_tail_at_most(successes, n_draws, p) <= tail)",
        ("tests/test_stats_clopper_pearson.py",),
        "the lower bound is solved with an off-by-one success count",
    ),
    Mutant(
        "STAT-CP-03",
        "witness",
        "stats/power.py",
        "        math.comb(n_draws, k) * p**k * (1.0 - p) ** (n_draws - k)\n        for k in range(successes + 1)",
        "        math.comb(n_draws, k) * p**k * (1.0 - p) ** (n_draws - k)\n        for k in range(successes)",
        ("tests/test_stats_clopper_pearson.py",),
        "the binomial tail omits its last term, so it is no longer a CDF",
    ),
    # -- reach (module 2) ----------------------------------------------------
    Mutant(
        "RCH-01",
        "reach",
        "modules/reach/measure.py",
        "SCHEDULE_OFFSETS = (16, 15, 7, 2)",
        "SCHEDULE_OFFSETS = (16, 15, 7, 3)",
        ("tests/test_module_reach.py", "tests/test_prereg_m2.py"),
        "the schedule recurrence's back-references are wrong, so the transitive "
        "closure describes a different message schedule",
    ),
    Mutant(
        "RCH-02",
        "reach",
        "modules/reach/measure.py",
        "            running = self._join(self._join(running, x), y)",
        "            running = self._join(x, y)",
        ("tests/test_module_reach.py",),
        "addition stops accumulating the carry, so reachability no longer grows "
        "upward along the word and the bound is unsound",
    ),
    Mutant(
        "RCH-03",
        "reach",
        "modules/reach/measure.py",
        "    free = min(n_rounds, BLOCK_WORDS)",
        "    free = n_rounds",
        ("tests/test_module_reach.py",),
        "the freedom budget keeps accumulating past round 16, overstating what an "
        "attacker controls -- wrong in the direction that flatters an attack",
    ),
    Mutant(
        "RCH-04",
        "reach",
        "modules/reach/measure.py",
        "            return ReachWord(\n                [b if (coerced >> i) & 1 else None for i, b in enumerate(self.bits)],\n                self.width,\n            )",
        "            return self",
        ("tests/test_module_reach.py",),
        "masking with a literal stops clearing bits, so bits that are provably "
        "constant are reported as reachable",
    ),
    Mutant(
        "RCH-05",
        "reach",
        "modules/reach/measure.py",
        "    state = [ReachWord.constant(WORD_BITS) for _ in SHA256_IV]",
        "    state = [ReachWord.inputs(WORD_BITS) for _ in SHA256_IV]",
        ("tests/test_module_reach.py",),
        "the chaining value is treated as free input, so the reachable set counts "
        "bits the attacker does not control",
    ),
    Mutant(
        "RCH-06",
        "reach",
        "modules/reach/blindness/cancellation.py",
        "    return reachable_bits == n",
        "    return True",
        ("tests/test_blindness_cancellation.py",),
        "the blindness class stops checking that reachability actually reports its "
        "null, becoming a tautology",
    ),
    Mutant(
        "RCH-07",
        "reach",
        "modules/reach/blindness/cancellation.py",
        "    return len(constant_bits) > 0",
        "    return True",
        ("tests/test_blindness_cancellation.py",),
        "the blindness class stops checking that the counterexample has constant "
        "output bits, so it would pass against a function with none",
    ),
    Mutant(
        "RCH-08",
        "reach",
        "verify/dependence.py",
        "            differing |= f(x) ^ f(x | direction)",
        "            differing = f(x) ^ f(x | direction)",
        ("tests/test_verify_dependence.py",),
        "the difference is assigned rather than accumulated, so only the last "
        "input decides and dependence visible at any earlier input is lost. "
        "Note: skipping the unordered-pair guard is an *equivalent* mutant, "
        "because the accumulator is |= and the second visit contributes "
        "f(x) ^ f(x) = 0 -- the accumulation is what carries the behaviour, so "
        "the accumulation is what is mutated",
    ),
    # -- differential (module 3) ---------------------------------------------
    Mutant(
        "DIFF-01",
        "differential",
        "modules/differential/measure.py",
        "    hits = sum(1 for x in range(1 << n) if target(x) ^ target(x ^ din) == dout)",
        "    hits = sum(1 for x in range(1 << n) if target(x) ^ target(din) == dout)",
        ("tests/test_module_differential.py",),
        "the second evaluation is at the difference rather than at the shifted "
        "input, so the quantity counted is not a differential at all",
    ),
    Mutant(
        "DIFF-02",
        "differential",
        "modules/differential/measure.py",
        "        if probability <= floor:",
        "        if probability < floor:",
        ("tests/test_module_differential.py",),
        "a characteristic sitting exactly at the random level is counted as a "
        "step, so the step count claims an advantage the probability does not "
        "carry -- wrong in the direction that flatters an attack",
    ),
    Mutant(
        "DIFF-03",
        "differential",
        "modules/differential/measure.py",
        "            break\n        steps += 1",
        "            continue\n        steps += 1",
        ("tests/test_module_differential.py",),
        "step counting skips a decayed round and resumes, so rounds beyond the "
        "point where the characteristic died are counted as covered",
    ),
    Mutant(
        "DIFF-04",
        "differential",
        "modules/differential/measure.py",
        "        return self.ci_low > self.random_level",
        "        return self.rate > self.random_level",
        ("tests/test_module_differential.py",),
        "the Tier S claim is made by the point estimate instead of the interval, "
        "so a cell with one hit in fifty on a 6-bit output reports an elevated "
        "differential that fifty draws cannot distinguish from chance",
    ),
    Mutant(
        "DIFF-05",
        "differential",
        "modules/differential/measure.py",
        "    if len(seeds) < SEEDS_PER_CELL:",
        "    if False:",
        ("tests/test_module_differential.py",),
        "a Tier S cell accepts fewer draws than the pre-registered count, so its "
        "interval is computed over a sample size nothing declared",
    ),
    Mutant(
        "DIFF-06",
        "differential",
        "modules/differential/measure.py",
        "    if len(set(seeds)) != len(seeds):",
        "    if False:",
        ("tests/test_module_differential.py",),
        "repeated seeds pass as independent draws, so the interval is narrower "
        "than the evidence supports",
    ),
    Mutant(
        "DIFF-07",
        "differential",
        "verify/differential.py",
        "        row[dout] = row.get(dout, 0) + 1",
        "        row[dout] = 1",
        ("tests/test_module_differential.py", "tests/test_blindness_impossible.py"),
        "the independent table records presence rather than counts, so every "
        "differential looks like probability 2^-n and the cross-check against "
        "the module's per-pair count is no longer a check on counts",
    ),
    Mutant(
        "DIFF-08",
        "differential",
        "verify/differential.py",
        "    return (1 << m) - len(ddt_row(f, n, din))",
        "    return (1 << m) - sum(ddt_row(f, n, din).values())",
        ("tests/test_module_differential.py", "tests/test_blindness_impossible.py"),
        "impossible differences are counted by total weight rather than by how "
        "many distinct output differences occur, so the impossible half of an "
        "APN table is reported as empty",
    ),
    Mutant(
        "DIFF-09",
        "differential",
        "modules/differential/blindness/impossible.py",
        "    return max_count <= 2",
        "    return True",
        ("tests/test_blindness_impossible.py",),
        "the blindness class stops checking that the search actually returns its "
        "null on the counterexample, becoming a tautology",
    ),
    Mutant(
        "DIFF-10",
        "differential",
        "modules/differential/blindness/impossible.py",
        "    return abs(impossible_fraction - EXPECTED_IMPOSSIBLE_FRACTION) <= tolerance",
        "    return True",
        ("tests/test_blindness_impossible.py",),
        "the blindness class stops checking that the impossible structure is "
        "present, so it would pass against a target with nothing to be blind to",
    ),
    Mutant(
        "DIFF-11",
        "differential",
        "verify/differential.py",
        "    if exponent > budget_bits:",
        "    if False:",
        ("tests/test_blindness_impossible.py",),
        "the sweep budget stops refusing, so a whole-table sweep at 18 variables "
        "is permitted at 2^36 evaluations -- a computation that does not finish, "
        "let through by a guard whose job is to refuse rather than estimate",
    ),
    Mutant(
        "DIFF-12",
        "differential",
        "verify/differential.py",
        "    _check_sweep(2 * n, budget_bits, f\"differential uniformity over {n} variables\")",
        "    _check_sweep(n, budget_bits, f\"differential uniformity over {n} variables\")",
        ("tests/test_blindness_impossible.py",),
        "the uniformity sweep is checked against a single exponent rather than "
        "the doubled one, which is the original defect: the cost has two "
        "exponents and the guard bounded one",
    ),
    # -- arx (sha-256) -------------------------------------------------------
    Mutant(
        "ARX-01",
        "arx",
        "modules/degree/measure.py",
        "        return min(degree, support.bit_count()), support",
        "        return degree, support",
        ("tests/test_sha256_degree.py",),
        "the support cap is removed, so modular addition's carry rule multiplies "
        "the bound again and the SHA-256 bound goes back to being vacuous",
    ),
    Mutant(
        "ARX-02",
        "arx",
        "modules/degree/measure.py",
        "        return cls._cap(a[0] + b[0], a[1] | b[1])",
        "        return cls._cap(max(a[0], b[0]), a[1] | b[1])",
        ("tests/test_sha256_degree.py",),
        "AND takes a maximum instead of a sum, which makes the bound unsound "
        "because a product of two degree-1 bits has degree 2",
    ),
    Mutant(
        "ARX-03",
        "arx",
        "modules/degree/measure.py",
        "        return cls._cap(max(d for d, _ in live), _union(live))",
        "        return cls._cap(max(d for d, _ in live), live[0][1])",
        ("tests/test_sha256_degree.py",),
        "XOR keeps only the first operand's support, so the cap is computed "
        "against too few variables and the bound is unsound",
    ),
    Mutant(
        "ARX-04",
        "arx",
        "modules/degree/measure.py",
        "            carry = self._xor(\n                self._and(x, y), self._and(x, carry), self._and(y, carry)\n            )",
        "            carry = self._and(x, y)",
        ("tests/test_sha256_degree.py",),
        "the carry drops its two propagate terms, so the chain no longer "
        "accumulates and the addition bound is unsound",
    ),
    Mutant(
        "ARX-05",
        "arx",
        "core/sha256.py",
        "    return scaled & MASK32",
        "    return scaled >> WORD_BITS & MASK32",
        ("tests/test_core_sha256.py",),
        "the constants take the wrong 32 bits of the scaled root, so every "
        "digest is wrong",
    ),
    Mutant(
        "ARX-06",
        "arx",
        "core/sha256.py",
        "    return (x & y) ^ ((~x & MASK32) & z)",
        "    return (x & y) ^ (x & z)",
        ("tests/test_core_sha256.py",),
        "Ch loses its complement, so the compression function is not SHA-256",
    ),
    Mutant(
        "ARX-07",
        "arx",
        "core/sha256.py",
        "        h, g, f, e = g, f, e, (d + t1) & MASK32",
        "        h, g, f, e = g, f, e, (d ^ t1) & MASK32",
        ("tests/test_core_sha256.py",),
        "a modular addition in the round function becomes an XOR, removing the "
        "carry chain that makes the target ARX at all",
    ),
    Mutant(
        "ARX-08",
        "arx",
        "core/sha256.py",
        "        return (self.fixed_block & keep) | (x << self.free_offset)",
        "        return (self.fixed_block & keep) | x",
        ("tests/test_core_sha256.py", "tests/test_sha256_degree.py"),
        "the free window ignores its offset, so every restricted target varies "
        "W[15] and a reduced-round measurement reads a constant",
    ),
    # -- landscape -----------------------------------------------------------
    Mutant(
        "LAND-01",
        "landscape",
        "verify/landscape.py",
        "    return (1 << n) / (n + 1)",
        "    return (1 << n) / n",
        ("tests/test_verify_landscape.py",),
        "the i.i.d. local-minimum prediction loses its +1, so the falsifiable "
        "anchor of the whole landscape arm is wrong",
    ),
    Mutant(
        "LAND-02",
        "landscape",
        "verify/landscape.py",
        "            if values[x ^ (1 << bit)] <= here:",
        "            if values[x ^ (1 << bit)] < here:",
        ("tests/test_verify_landscape.py",),
        "ties stop disqualifying a state, so a plateau counts as a basin of local "
        "minima and the count no longer matches the continuous prediction",
    ),
    Mutant(
        "LAND-03",
        "landscape",
        "verify/landscape.py",
        "    return 1.0 - 2.0 * (x ^ y).bit_count() / n",
        "    return 1.0 - (x ^ y).bit_count() / n",
        ("tests/test_verify_landscape.py",),
        "the overlap drops its factor of two, so complementary states read as "
        "q = 0 instead of q = -1 and the scale is wrong everywhere",
    ),
    Mutant(
        "LAND-04",
        "landscape",
        "verify/landscape.py",
        "    return sorted(range(len(values)), key=lambda x: values[x])[:count]",
        "    return sorted(range(len(values)), key=lambda x: -values[x])[:count]",
        ("tests/test_verify_landscape.py",),
        "the overlap distribution is computed over the highest-energy states "
        "instead of the lowest",
    ),
    Mutant(
        "LAND-05",
        "landscape",
        "core/landscape.py",
        "        a = self.outer_weight\n        return math.sqrt(a) * outer + math.sqrt(1.0 - a) * inner",
        "        a = self.outer_weight\n        return math.sqrt(1.0 - a) * inner",
        ("tests/test_blindness_landscape.py",),
        "the hierarchy is dropped from the energy, so the counterexample silently "
        "becomes the control and the blindness class is vacuous",
    ),
    Mutant(
        "LAND-06",
        "landscape",
        "core/landscape.py",
        "        return math.sqrt(self.outer_weight / self.n_clusters)",
        "        return math.sqrt(self.outer_weight * self.n_clusters)",
        ("tests/test_blindness_landscape.py",),
        "the predicted density-of-states fluctuation grows with cluster count "
        "instead of shrinking, inverting the explanation it exists to give",
    ),
    Mutant(
        "LAND-07",
        "landscape",
        "modules/degree/blindness/landscape_geometry.py",
        "    return degree_hierarchical == degree_control",
        "    return True",
        ("tests/test_blindness_landscape.py",),
        "the blindness class stops checking that the degree measure is actually "
        "blind, becoming a tautology",
    ),
    Mutant(
        "LAND-08",
        "landscape",
        "modules/degree/blindness/landscape_geometry.py",
        "    return mean_overlap_hierarchical > mean_overlap_control + margin",
        "    return True",
        ("tests/test_blindness_landscape.py",),
        "the blindness class stops checking that the counterexample carries any "
        "structure, so it would pass against a structureless landscape",
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
        'return re.compile(r"(?<![A-Za-z])" + body + r"(?![A-Za-z])", re.IGNORECASE)',
        "return re.compile(body, re.IGNORECASE)",
        ("tests/test_reports_lint.py",),
        "the lint fires inside longer words",
    ),
    Mutant(
        "RPRT-03",
        "reports",
        "reports/lint.py",
        'return re.compile(r"(?<![A-Za-z])" + body + r"(?![A-Za-z])", re.IGNORECASE)',
        'return re.compile(r"(?<![A-Za-z])" + body + r"(?![A-Za-z])")',
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
    Mutant(
        "RPRT-06",
        "reports",
        "reports/lint.py",
        '    body = r"\\s+".join(re.escape(word) for word in term.split())',
        '    body = " ".join(re.escape(word) for word in term.split())',
        ("tests/test_integrity_regressions.py",),
        "a forbidden phrase wrapped across a line break evades the lint",
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
        "    measure=measure,",
        "    measure=None,",
        ("tests/test_module_degree.py",),
        "the measurement path is unregistered, silently disarming the module",
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


def purge_bytecode() -> None:
    """Remove every __pycache__ under the tree.

    A mutant of the same byte length as the text it replaces restores to a file
    with the same size, and CPython's source-mtime cache validation has
    one-second granularity: without this, a stale .pyc compiled from the mutated
    source survives the restore and poisons every later run. That failure mode
    cost a debugging round here; the purge is not optional tidiness.
    """
    for cache in ROOT.rglob("__pycache__"):
        shutil.rmtree(cache, ignore_errors=True)


def run_pytest(tests: tuple[str, ...]) -> int:
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    return subprocess.run(
        [*PYTEST, "-x", "-q", "--no-header", "-p", "no:cacheprovider", *tests],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        env=env,
    ).returncode


def apply_mutant(mutant: Mutant) -> tuple[bool, str]:
    path = ROOT / mutant.path
    original = path.read_text(encoding="utf-8")
    occurrences = original.count(mutant.old)
    if occurrences != 1:
        return False, f"anchor matched {occurrences} times; the mutant no longer applies"
    try:
        purge_bytecode()
        path.write_text(original.replace(mutant.old, mutant.new), encoding="utf-8")
        code = run_pytest(mutant.tests)
    finally:
        path.write_text(original, encoding="utf-8")
        purge_bytecode()
    return (code != 0), ("killed" if code != 0 else "SURVIVED")


#: Tracked files a mutant's test run can write to as a side effect. Restoring the
#: mutated source is not enough: RPRT-07 exists precisely to make the renderer
#: write into the tracked report directory, so running it leaves those files
#: rewritten with a fresh commit stamp even though the mutant itself is undone.
#: A dirty tree then falsifies the provenance of anything run afterwards (D-033),
#: so the run snapshots them and puts them back.
SIDE_EFFECT_GLOBS = ("reports/out/*.txt",)


def snapshot_side_effects() -> dict[Path, bytes]:
    snapshot: dict[Path, bytes] = {}
    for pattern in SIDE_EFFECT_GLOBS:
        for path in sorted(ROOT.glob(pattern)):
            snapshot[path] = path.read_bytes()
    return snapshot


def restore_side_effects(snapshot: dict[Path, bytes]) -> list[str]:
    """Put back anything a mutant's test run rewrote. Returns what was restored."""
    restored = []
    for path, content in snapshot.items():
        if not path.exists() or path.read_bytes() != content:
            path.write_bytes(content)
            try:
                restored.append(str(path.relative_to(ROOT)))
            except ValueError:
                restored.append(str(path))
    return restored


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

    baseline = snapshot_side_effects()

    survivors: list[str] = []
    try:
        for mutant in catalogue:
            killed, detail = apply_mutant(mutant)
            print(
                f"mutant={mutant.mutant_id} layer={mutant.layer} file={mutant.path} "
                f"killed={killed} detail={detail} defect={mutant.defect}"
            )
            if not killed:
                survivors.append(mutant.mutant_id)
    finally:
        restored = restore_side_effects(baseline)
        print(f"side_effect_files_restored={len(restored)} {restored}")

    for layer, count in sorted(layers.items()):
        print(f"layer={layer} mutants={count} minimum_required=5 meets_minimum={count >= 5}")
    print(f"mutants={len(catalogue)} survivors={len(survivors)} {survivors}")
    below_minimum = [layer for layer, count in layers.items() if count < 5 and args.layer is None]
    if below_minimum:
        print(f"layers_below_minimum={below_minimum}")
    return 1 if survivors or below_minimum else 0


if __name__ == "__main__":
    raise SystemExit(main())
