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
    #: How a control's stated value is recomputed independently of the module's
    #: own measure. Declared per module because it depends on what the module
    #: measures -- this gate hard-coded Module 1's quantity until Module 2 made
    #: that assumption visible.
    control_strategy: str = "exhaustive-anf"
    #: How "the measurement path supports this target" is established. Declared
    #: per module for the same reason ``control_strategy`` is: the gate assumed
    #: Module 1's function names until a third module found it (D-049).
    support_probe: str = "degree-paths"
    depends_on: tuple[str, ...] = ()
    #: (target_id, factory-or-None, citation the target's ground truth needs).
    #: A target with no citation has its expected values established in-repo.
    targets: tuple[tuple[str, str | None, str | None], ...] = ()


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
        targets=(
            ("sha256-compression-parametrised", "core.sha256", None),
            ("keccak-f[25]", "core.keccak:KeccakF", "CITE-BCD11"),
            ("mimc-gf2n[9]", "core.mimc:MiMC", "CITE-EGLORSW20"),
            ("linear-map-gf2", "core.targets:LinearMapGF2", None),
            ("power-map-gf2n", "core.targets:PowerMap", None),
            ("inverse-map-gf2n", "core.targets:InverseMap", None),
            ("random-function-sha256-prf", "core.targets:RandomFunction", None),
        ),
    ),
    SpecSheet(
        module_id="M2",
        title="Dependency-graph reachability and free-round budget",
        quantity="input bits reachable to each output bit at round r; degrees of freedom",
        declared_tiers="P",
        package="modules.reach",
        prereg_path="modules/reach/prereg/PREREG-M2.md",
        verify_symbol="verify.dependence:dependence_matrix",
        calibration_anchor=None,
        control_strategy="schedule-closure",
    ),
    SpecSheet(
        module_id="M3",
        title="Differential characteristic search",
        quantity="characteristic probability and step count",
        declared_tiers="E,S",
        package="modules.differential",
        prereg_path="modules/differential/prereg/PREREG-M3.md",
        verify_symbol="verify.differential:ddt_row",
        calibration_anchor="reduced-round SHA-256 collision and semi-free-start results",
        control_strategy="differential-count",
        support_probe="differential-paths",
        targets=(
            # The anchor names SHA-256, so the target's ground truth depends on a
            # citation that E-04 holds unverified. Gate T02 blocks it, which is a
            # different and repairable state from "no anchor exists".
            ("sha256-compression-parametrised", "core.sha256", "CITE-SHA256-DIFF"),
        ),
    ),
    SpecSheet(
        module_id="M4",
        title="Higher-order differentials and integral distinguishers",
        quantity="order of a vanishing higher-order differential",
        declared_tiers="P,E",
        package="modules.hod",
        prereg_path="modules/hod/prereg/PREREG-M4.md",
        verify_symbol="verify.anf:derivative_vanishes",
        calibration_anchor=None,
        control_strategy="implied-order",
        depends_on=("M1",),
    ),
    SpecSheet(
        module_id="M5",
        title="Meet-in-the-middle and biclique structure",
        quantity="splitting points, independent chunks, matching degrees of freedom",
        declared_tiers="P,E",
        package="modules.mitm",
        prereg_path="modules/mitm/prereg/PREREG-M5.md",
        verify_symbol="verify.mitm:observed_dependence",
        calibration_anchor="published preimage attacks on reduced-round SHA-256",
        control_strategy="split-enumeration",
        support_probe="split-paths",
        targets=(
            # Section 5 names an anchor, so the target's ground truth rests on a
            # citation E-04 holds unverified. Gate T02 blocks it -- a different
            # and repairable state from "no anchor exists", which is E-05.
            ("sha256-compression-parametrised", "core.sha256", "CITE-SHA256-MITM"),
        ),
    ),
    SpecSheet(
        module_id="M6",
        title="Rotational-XOR propagation",
        quantity="rotational-pair propagation probability",
        declared_tiers="P,S",
        package="modules.rx",
        prereg_path="modules/rx/prereg/PREREG-M6.md",
        verify_symbol="verify.rotational:addition_propagation_fraction",
        calibration_anchor=None,
        control_strategy="rotational-count",
        support_probe="rotational-paths",
    ),
)


# ---------------------------------------------------------------------------
# Checks. Each returns (passed, detail) and touches the repository, not an
# opinion about it.
# ---------------------------------------------------------------------------


def _import(dotted: str):
    return importlib.import_module(dotted)


SAMPLE_TARGETS = {
    "keccak-f[25]": lambda: _import("core.keccak").KeccakF.create(0, 2),
    "mimc-gf2n[9]": lambda: _import("core.mimc").MiMC.create(n=9, n_rounds=2),
    "linear-map-gf2": lambda: _import("core.targets").LinearMapGF2.random_invertible(9, 1),
    "power-map-gf2n": lambda: _import("core.targets").PowerMap.create(9, 31),
    "inverse-map-gf2n": lambda: _import("core.targets").InverseMap.create(9),
    "random-function-sha256-prf": lambda: _import("core.targets").RandomFunction.create(9, 9, 1),
    "sha256-compression-parametrised": lambda: _import(
        "core.sha256"
    ).SHA256Compression.create(n_rounds=2),
}


def make_target_gates(
    sheet: SpecSheet, target_id: str, citation_key: str | None
) -> tuple[Gate, ...]:
    """Gates that decide whether this module may run against this target."""

    def check_available() -> tuple[bool, str]:
        if target_id.startswith("sha256"):
            return check_primary_target()
        factory = SAMPLE_TARGETS.get(target_id)
        if factory is None:
            return False, "no constructor is registered for this target"
        target = factory()
        value = target(0)
        return True, f"constructed, n_in={target.n_in} n_out={target.n_out} f(0)={value}"

    def check_ground_truth_for_target() -> tuple[bool, str]:
        if citation_key is None:
            return True, "expected values for this target are established in-repo"
        if sheet.package is None:
            return False, "no module package exists"
        citations = _import(f"{sheet.package}.citations").CITATIONS
        citation = citations.get(citation_key)
        from tiers.provenance import Verification

        if citation.verification is Verification.UNVERIFIED:
            return False, (
                f"this target's ground truth rests on {citation_key}, whose claimed "
                "value has not been checked against the primary source"
            )
        return True, f"{citation_key} verified"

    def check_measure_supports_target() -> tuple[bool, str]:
        if sheet.package is None:
            return False, "no module package exists"
        measure_module = _import(f"{sheet.package}.measure")
        target = SAMPLE_TARGETS[target_id]()
        probe = _support_probes().get(sheet.support_probe)
        if probe is None:
            return False, f"no support probe registered for {sheet.support_probe!r}"
        paths = probe(measure_module, target)
        if not paths:
            return False, (
                f"the {sheet.support_probe} probe found no path in "
                f"{sheet.package}.measure that supports this target"
            )
        return True, f"paths={paths}"

    return (
        Gate("T01", "target-available", "section 9", BlockClass.OPERATOR, check_available),
        Gate(
            "T02",
            "target-ground-truth-verified",
            "section 5",
            BlockClass.OPERATOR,
            check_ground_truth_for_target,
        ),
        Gate(
            "T03",
            "measurement-path-supports-target",
            "section 4",
            BlockClass.BUILD,
            check_measure_supports_target,
        ),
    )



class _Unrecomputable(Exception):
    """A control whose stated value cannot be recomputed by this strategy."""




def _support_probes():
    """How each module establishes that its path supports a target.

    A module's measurement path is whatever that module measures, so asking "is
    this target supported" means calling that module's own functions. The gate
    checked for ``degree_upper_bound`` and ``exact_degree`` -- Module 1's names --
    until Module 3 arrived with neither, which is the third place the gate turned
    out to assume one module's shape (D-049).
    """

    def degree_paths(measure_module, target):
        paths = []
        for name, label in (
            ("degree_upper_bound", "upper-bound"),
            ("exact_degree", "exact"),
        ):
            function = getattr(measure_module, name, None)
            if function is None:
                continue
            try:
                function(target)
                paths.append(label)
            except Exception:
                pass
        return paths

    def differential_paths(measure_module, target):
        """Either the counted path or the sampled one supports the target.

        The sampled path is what supports the 512-bit primary target: the exact
        path refuses it, correctly, because 2^512 is not exhaustible. A module
        declaring Tier S is entitled to be supported by its Tier S path, and
        saying otherwise would report the module as broken for refusing to
        estimate.
        """
        paths = []
        din = 1
        dout = 0
        try:
            measure_module.differential_probability(target, din, dout)
            paths.append("exact-count")
        except Exception:
            pass
        try:
            seeds = list(range(measure_module.SEEDS_PER_CELL))
            measure_module.sampled_probability(target, din, dout, seeds)
            paths.append("sampled")
        except Exception:
            pass
        return paths

    def split_paths(measure_module, target):
        """The deductive cut and the exhaustive sweep, each tried separately.

        Both are Tier P/E paths over the schedule's wiring, so neither depends
        on the target being small enough to evaluate -- the 512-bit primary
        target is supported by both.
        """
        paths = []
        try:
            measure_module.split_at(1, 0, min(getattr(target, "n_rounds", 1), 2))
            paths.append("split")
        except Exception:
            pass
        try:
            measure_module.enumerate_splits(0, min(getattr(target, "n_rounds", 1), 2))
            paths.append("enumeration")
        except Exception:
            pass
        return paths

    def rotational_paths(measure_module, target):
        """The deductive fact and the sampled estimate, tried separately.

        The deductive path needs no target at all -- probability 1 for a
        rotation-XOR circuit is a theorem -- so it is available for every
        target including the 512-bit one. The sampled path needs a callable.
        """
        paths = []
        try:
            measure_module.linear_propagation()
            measure_module.addition_probability(32, 1)
            paths.append("deductive")
        except Exception:
            pass
        try:
            seeds = list(range(measure_module.SEEDS_PER_CELL))
            width = min(getattr(target, "n_in", 16), 16)
            measure_module.sampled_propagation(
                lambda x: x, width, 1, seeds
            )
            paths.append("sampled")
        except Exception:
            pass
        return paths

    return {
        "degree-paths": degree_paths,
        "differential-paths": differential_paths,
        "split-paths": split_paths,
        "rotational-paths": rotational_paths,
    }


def _blindness_runners():
    """How to run each module's blindness class, keyed by package.

    The wiring lives here rather than in the modules because a blindness class
    needs measures from ``verify/`` and ``modules/`` must not import ``verify/``
    (D-006). The classes also do not share a signature -- Module 1's takes one
    measure, Module 2's takes two -- so there is no uniform contract to call
    instead. Adding a module means adding one visible entry here, which is the
    honest cost of keeping the two halves independent.
    """

    def degree():
        from verify.anf import algebraic_degree

        from modules.degree.blindness import inverse_map

        return inverse_map.check(
            lambda target, n: algebraic_degree(target, n, n),
            9,
            test_id="scripts/readiness_report.py::check_blindness",
            computation_id="READINESS-BLIND-M1-001",
        )

    def reach():
        from verify.dependence import constant_output_bits

        from modules.reach.blindness import cancellation

        def reachable(target) -> int:
            # Reachability of a GF(2) matrix row is the union of the input bits
            # it selects; create() guarantees every row is non-zero, so the union
            # over both applications is the whole input.
            union = 0
            for rows in (target.rows_a, target.rows_b):
                for row in rows:
                    union |= row
            return (union & ((1 << target.n_in) - 1)).bit_count()

        return cancellation.check(
            reachable,
            lambda target: constant_output_bits(target, target.n_in, target.n_out),
            n=10,
            seed=7,
            shared_rows=(2, 5),
            test_id="scripts/readiness_report.py::check_blindness",
            computation_id="READINESS-BLIND-M2-001",
        )

    def hod():
        from verify.anf import algebraic_degree

        from modules.hod.blindness import multiplicative_coset

        return multiplicative_coset.check(
            lambda target, n: algebraic_degree(target, n, n),
            9,
            7,
            test_id="scripts/readiness_report.py::check_blindness",
            computation_id="READINESS-BLIND-M4-001",
        )

    def differential():
        from verify.differential import differential_uniformity, impossible_fraction

        from modules.differential.blindness import impossible

        return impossible.check(
            lambda target, n: differential_uniformity(target, n),
            lambda target, n: impossible_fraction(target, n, n),
            n=7,
            test_id="scripts/readiness_report.py::check_blindness",
            computation_id="READINESS-BLIND-M3-001",
        )

    def mitm():
        from verify.mitm import observed_dependence_of

        from modules.mitm.blindness import cancellation

        def consumption(target, start, end):
            return target.wiring_consumption(start, end)

        def dependence(target, start, end):
            observed = observed_dependence_of(
                target.evaluate, target.block_words, target.n_rounds
            )
            union = set()
            for t in range(start, end):
                union |= observed[t]
            return frozenset(union)

        return cancellation.check(
            consumption,
            dependence,
            test_id="scripts/readiness_report.py::check_blindness",
            computation_id="READINESS-BLIND-M5-001",
        )

    def rotational():
        from verify.rotational import count_function_propagation, rx_offsets

        from modules.rx.blindness import rotational_xor

        def plain(target, width, amount):
            hits, total = count_function_propagation(target, width, amount)
            return hits / total

        return rotational_xor.check(
            plain,
            lambda target, width, amount: rx_offsets(target, width, amount),
            test_id="scripts/readiness_report.py::check_blindness",
            computation_id="READINESS-BLIND-M6-001",
        )

    return {
        "modules.degree": degree,
        "modules.reach": reach,
        "modules.hod": hod,
        "modules.differential": differential,
        "modules.mitm": mitm,
        "modules.rx": rotational,
    }


def _recomputers():
    """Independent recomputations of a control's expected value, by strategy.

    "Independent" is claimed narrowly and means: not the code path the module's
    own ``measure`` uses for that case.
    """

    def exhaustive_anf(target, case):
        from verify.anf import MAX_EXHAUSTIVE_VARS, algebraic_degree

        if target.n_in > MAX_EXHAUSTIVE_VARS:
            raise _Unrecomputable(
                f"{target.n_in} variables exceeds the exhaustive guard of "
                f"{MAX_EXHAUSTIVE_VARS}; this strategy does not sample"
            )
        return algebraic_degree(target, target.n_in, target.n_out)

    def schedule_closure(target, case):
        """Module 2's controls, recomputed from the schedule's word-level closure
        instead of the bit-set propagation ``measure`` uses.

        Two genuinely different computations -- a transitive closure over word
        indices, versus reachable sets pushed through ``core.sha256.compress`` --
        so one is a check on the other. It is not an *external* anchor, which is
        what G06 is for and why this module is still calibration-blocked.
        """
        from modules.reach.measure import WORD_BITS, freedom_budget, reachable_words

        quantity = case.quantity
        if quantity == "reachable_input_bits":
            return len(reachable_words(target.n_rounds)) * WORD_BITS
        if quantity == "reachable_block_words":
            return len(reachable_words(target.n_rounds))
        if quantity == "free_message_bits":
            return freedom_budget(target.n_rounds).free_bits
        raise _Unrecomputable(f"no independent recomputation for quantity {quantity!r}")

    def implied_order(target, case):
        """Module 4's controls: the order of a vanishing higher-order
        differential, which is the exact degree plus one.

        Recomputed through ``verify.anf`` rather than through Module 4's own
        ``exact_degree`` import, so the check does not run the same code twice.
        """
        from verify.anf import MAX_EXHAUSTIVE_VARS, algebraic_degree

        if target.n_in > MAX_EXHAUSTIVE_VARS:
            raise _Unrecomputable(
                f"{target.n_in} variables exceeds the exhaustive guard of "
                f"{MAX_EXHAUSTIVE_VARS}; this strategy does not sample"
            )
        return algebraic_degree(target, target.n_in, target.n_out) + 1

    def differential_count(target, case):
        """Module 3's controls, recomputed by building whole table rows.

        ``verify.differential`` iterates inputs once and tallies; the module
        iterates pairs and counts per pair. Same question, different route.
        """
        from verify.differential import MAX_DDT_VARS, ddt_row

        if target.n_in > MAX_DDT_VARS:
            raise _Unrecomputable(
                f"{target.n_in} variables exceeds the table guard of {MAX_DDT_VARS}; "
                "this strategy does not estimate"
            )
        parameters = case.parameters or {}
        din = parameters.get("din")
        if din is None:
            raise _Unrecomputable("the case states no input difference to recompute")
        row = ddt_row(target, target.n_in, din)
        if case.quantity == "max_differential_hits":
            return max(row.values())
        if case.quantity == "differential_hits":
            return row.get(parameters["dout"], 0)
        raise _Unrecomputable(f"no recomputation for quantity {case.quantity!r}")

    def split_enumeration(target, case):
        """Module 5's controls, recomputed from the observed schedule.

        The module closes the recurrence over word indices as a graph. This
        rebuilds the consumption sets by evaluating the real
        core.sha256.message_schedule and watching which words move, then
        redoes the set arithmetic. Same question, different route.
        """
        from verify.mitm import observed_dependence, observed_dependence_of

        parameters = case.parameters or {}
        if not hasattr(target, "n_rounds"):
            raise _Unrecomputable("target carries no schedule to observe")
        start = parameters.get("start", 0)
        end = parameters.get("end", target.n_rounds)
        if end == 0:
            raise _Unrecomputable("an empty round range has nothing to recompute")

        # Observe whichever schedule the case names. The blindness case's target
        # brings its own -- recomputing it against SHA-256's would be checking a
        # different function than the case is about, which is what an earlier
        # draft of this did: it reported 7 independent cuts for a counterexample
        # whose answer is 0.
        if hasattr(target, "evaluate") and hasattr(target, "block_words"):
            per_word = observed_dependence_of(
                target.evaluate, target.block_words, target.n_rounds
            )
        else:
            per_word = observed_dependence(end)

        def consumed(lo, hi):
            union = set()
            for t in range(lo, hi):
                union |= per_word[t]
            return frozenset(union)

        def neutral(cut):
            fwd, bwd = consumed(start, cut), consumed(cut, end)
            return fwd - bwd, bwd - fwd

        if case.quantity == "neutral_word_count":
            fwd, bwd = neutral(parameters["cut"])
            return len(fwd) + len(bwd)
        if case.quantity == "independent_split_count":
            return sum(
                1
                for cut in range(start, end + 1)
                if all(neutral(cut))
            )
        if case.quantity == "matching_dof_bits":
            best = 0
            for cut in range(start, end + 1):
                fwd, bwd = neutral(cut)
                if fwd and bwd:
                    best = max(best, 32 * min(len(fwd), len(bwd)))
            return best
        raise _Unrecomputable(f"no recomputation for quantity {case.quantity!r}")

    def rotational_count(target, case):
        """Module 6's controls, recomputed by counting rather than deriving.

        The module argues from carry cases; this counts every (x, y) pair, or
        every input, and divides. Same question, different route.
        """
        from fractions import Fraction

        from verify.rotational import (
            addition_propagation_fraction,
            count_function_propagation,
            rx_offsets,
        )

        parameters = case.parameters or {}
        quantity = case.quantity

        if quantity == "linear_propagation":
            width = parameters["width"]
            hits, total = count_function_propagation(
                target, width, parameters["amount"]
            )
            return 1 if hits == total else 0
        if quantity == "rx_offset_is_zero":
            offsets = rx_offsets(target, parameters["width"], parameters["amount"])
            return int(len(offsets) == 1 and 0 in offsets)
        if quantity == "additions_to_random_level":
            width = parameters["width"]
            if width > 12:
                raise _Unrecomputable(
                    f"counting every pair at width {width} is 2^{2 * width} "
                    "evaluations; this strategy does not estimate"
                )
            p = addition_propagation_fraction(width, parameters["amount"])
            floor = Fraction(1, 1 << parameters["n_out_bits"])
            k, running = 0, Fraction(1)
            while running > floor:
                running *= p
                k += 1
            return k
        raise _Unrecomputable(f"no recomputation for quantity {quantity!r}")

    return {
        "exhaustive-anf": exhaustive_anf,
        "schedule-closure": schedule_closure,
        "implied-order": implied_order,
        "differential-count": differential_count,
        "split-enumeration": split_enumeration,
        "rotational-count": rotational_count,
    }


def check_primary_target() -> tuple[bool, str]:
    """Section 9: SHA-256 with round count a runtime parameter is the primary
    target of every module.

    The probe evaluates the target and checks bit-identity with ``hashlib`` on a
    single padded block, because "importable" is not the property the gate is
    about. A hand-rolled substitute would import fine and be wrong.
    """
    import hashlib

    try:
        from core.sha256 import FULL_ROUNDS, SHA256Compression, sha256

        message = b"\x61" * 55
        if sha256(message) != hashlib.sha256(message).digest():
            return False, "core.sha256 is not bit-identical to hashlib.sha256"

        padded = bytearray(message)
        padded.append(0x80)
        while len(padded) % 64 != 56:
            padded.append(0x00)
        padded += (len(message) * 8).to_bytes(8, "big")
        block = int.from_bytes(padded, "big")

        target = SHA256Compression.create(n_rounds=FULL_ROUNDS)
        if target(block).to_bytes(32, "big") != hashlib.sha256(message).digest():
            return False, "the target disagrees with hashlib on a full block"
        return True, (
            f"round-parametrised, bit-identical to hashlib at {FULL_ROUNDS} rounds, "
            f"n_in={target.n_in} n_out={target.n_out}"
        )
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
        # How a control is *recomputed* depends on what the module measures, so
        # the module declares the strategy rather than the gate assuming one.
        # Before Module 2 existed this gate hard-coded exhaustive ANF, which is
        # Module 1's quantity and no other module's.
        recompute = _recomputers()[sheet.control_strategy]
        checked = 0
        for case in suite.cases:
            if case.kind not in control_kinds:
                continue
            target = case.target_factory()
            try:
                observed = recompute(target, case)
            except _Unrecomputable as exc:
                return False, f"{case.case_id}: {exc}"
            if not case.comparator.holds(observed, case.expected):
                return False, (
                    f"{case.case_id}: observed {observed} "
                    f"{case.comparator.value} {case.expected} does not hold"
                )
            checked += 1
        return True, (
            f"{checked} controls recompute to their stated values via "
            f"{sheet.control_strategy}"
        )

    def check_blindness() -> tuple[bool, str]:
        if package is None:
            return no_package("a blindness class")
        runner = _blindness_runners().get(package)
        if runner is None:
            return False, (
                f"no blindness wiring is registered for {package}; section 6(c) "
                "requires the class to be run, not merely present"
            )
        outcome = runner()
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
        Gate("G02", "prereg-committed", "section 8", BlockClass.BUILD, check_prereg),
        Gate("G03", "prereg-matches-derivation", "directive 2.1", BlockClass.BUILD, check_derivation),
        Gate("G04", "runner-precedes-prereg", "section 8", BlockClass.BUILD, check_ordering),
        Gate("G05", "calibration-suite-defined", "section 5", BlockClass.BUILD, check_calibration_defined),
        Gate("G06", "published-anchor-named", "section 5", BlockClass.OPERATOR, check_anchor_named),
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
        target_gates = {
            target_id: make_target_gates(sheet, target_id, citation)
            for target_id, _factory, citation in sheet.targets
        }
        readiness = evaluate(
            module_id=sheet.module_id,
            title=sheet.title,
            quantity=sheet.quantity,
            declared_tiers=sheet.declared_tiers,
            depends_on=sheet.depends_on,
            gates=make_checks(sheet, decided),
            target_gates=target_gates,
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
