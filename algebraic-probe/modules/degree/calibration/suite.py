"""Module 1 calibration suite.

Section 5. Nothing in this file measures anything: it declares what will be
measured, on which target, against which expected value, and where that expected
value comes from. ``python -m modules.degree.calibration`` prints the
manifest -- exactly what the suite will assert -- without running it.

Case kinds:

  published-ground-truth  the module must recover a value stated in the
                          literature before it is trusted on anything new
  exhaustive-ground-truth the exact degree over the target's whole input space,
                          computed here. Checks the certified bound for
                          soundness -- a bound below the exact degree is wrong --
                          and measures its tightness. Not a published anchor and
                          not accepted as one (ESCALATIONS.md E-09).
  positive-control        g(x) = Ax over GF(2), A random invertible: degree 1,
                          fully reachable, trivially invertible. The
                          counterexample that exposed the prior instrument's
                          blindness. Mandatory, and the single most important
                          case here.
  intermediate-control    a known, non-trivial, non-extreme value: x -> x^d over
                          GF(2^n), degree wt(d), strictly inside (1, n-1)
  negative-control        an i.i.d. random-oracle stand-in: establishes the floor
  blindness               a function with the property being searched for that
                          produces the same null under this measurement
"""

from __future__ import annotations

from core.keccak import KeccakF
from core.mimc import MiMC
from core.targets import InverseMap, LinearMapGF2, PowerMap, RandomFunction
from harness.calibration import (
    PENDING_PRIMARY_SOURCE,
    CalibrationCase,
    CalibrationSuite,
    CaseKind,
    Comparator,
)
from tiers.provenance import Provenance

from ..citations import CITATIONS
from .exhaustive_truth import (
    COMPUTATION_ID_KECCAK,
    COMPUTATION_ID_MIMC,
    KECCAK_EXACT,
    MIMC_EXACT,
    MIMC_N,
    MIMC_SEED,
)

MODULE_ID = "modules.degree"

# Fixed seeds, declared here so a control is the same object on every run.
LINEAR_SEED = 20260824
RANDOM_SEED = 20260825

# Control sizes: small enough that verify.anf can exhaust the truth table
# (2^n entries, guard at 2^24), large enough that an intermediate degree is
# genuinely intermediate.
LINEAR_N = 12
POWER_N = 11
RANDOM_N = 12
INVERSE_N = 11

# wt(31) = 5, strictly inside (1, POWER_N - 1) = (1, 10).
POWER_EXPONENT_MID = 31
# wt(3) = 2: the MiMC round function, on the path to the section 9 secondary
# targets.
POWER_EXPONENT_CUBE = 3


def _cases() -> tuple[CalibrationCase, ...]:
    cases: list[CalibrationCase] = []

    # -- published ground truth ------------------------------------------

    for rounds in (1, 2, 3):
        cases.append(
            CalibrationCase(
                case_id=f"CAL-M1-GT-KECCAK-R{rounds}",
                kind=CaseKind.PUBLISHED_GROUND_TRUTH,
                target_id=f"keccak-f[25] rounds={rounds}",
                target_factory=lambda r=rounds: KeccakF.create(lane_log2=0, n_rounds=r),
                quantity="algebraic_degree_upper_bound",
                comparator=Comparator.EQUAL,
                expected=PENDING_PRIMARY_SOURCE,
                expectation_provenance=Provenance(citation_key="CITE-BCD11"),
                assertion=(
                    f"the module's certified upper bound on the algebraic degree of "
                    f"{rounds}-round Keccak-f[25] equals the per-round bound stated for "
                    "that round in CITE-BCD11"
                ),
                rationale=(
                    "an iterated permutation whose only non-linear step is chi, of "
                    "degree 2, so the trivial bound is 2^r; the published bound is "
                    "tighter for larger r and a module that reproduces only the trivial "
                    "bound is measurably weaker than the literature"
                ),
                parameters={"rounds": rounds, "width": 25, "variables": 25},
            )
        )

    for rounds in (1, 2, 3):
        cases.append(
            CalibrationCase(
                case_id=f"CAL-M1-GT-MIMC-R{rounds}",
                kind=CaseKind.PUBLISHED_GROUND_TRUTH,
                target_id=f"mimc-gf2n n=9 rounds={rounds}",
                target_factory=lambda r=rounds: MiMC.create(n=9, n_rounds=r, seed=0),
                quantity="algebraic_degree",
                comparator=Comparator.EQUAL,
                expected=PENDING_PRIMARY_SOURCE,
                expectation_provenance=Provenance(citation_key="CITE-EGLORSW20"),
                assertion=(
                    f"the module's algebraic degree for {rounds}-round MiMC over GF(2^9) "
                    "equals the value given by the degree-growth statement of "
                    "CITE-EGLORSW20 at that round"
                ),
                rationale=(
                    "the arithmetisation-oriented case, where degree-growth methodology "
                    "is contested; n = 9 is small enough for the value to also be "
                    "checked by exhaustive ANF once the published value is transcribed, "
                    "so this case tests the module and the literature against each other"
                ),
                parameters={
                    "rounds": rounds,
                    "field": "GF(2^9)",
                    "variables": 9,
                    "constants": "c_0 = 0; c_i = SHA-256(domain || seed || n || i) mod 2^9",
                },
            )
        )

    # -- exhaustive ground truth ------------------------------------------
    #
    # The bound is compared against the exact degree with AT_MOST reversed into
    # the module's favour: the case asserts the *exact degree* is at most the
    # bound, which is soundness. An unsound propagation rule -- one that charges
    # a non-linear step as linear, or loses a product term -- produces a bound
    # below the truth and fails here. Tightness is reported by scripts/exhaust.py
    # as the gap; it is not asserted, because a sound bound is permitted to be
    # loose and a case that demanded gap = 0 would be asserting a result rather
    # than checking one.

    for row in KECCAK_EXACT:
        rounds = int(row["rounds"])  # type: ignore[arg-type]
        exact = int(row["exact_degree"])  # type: ignore[arg-type]
        cases.append(
            CalibrationCase(
                case_id=f"CAL-M1-EXH-KECCAK-R{rounds}",
                kind=CaseKind.EXHAUSTIVE_GROUND_TRUTH,
                target_id=f"keccak-f[25] rounds={rounds}",
                target_factory=lambda r=rounds: KeccakF.create(lane_log2=0, n_rounds=r),
                quantity="algebraic_degree_upper_bound",
                comparator=Comparator.AT_LEAST,
                expected=exact,
                expectation_provenance=Provenance(
                    computation_id=COMPUTATION_ID_KECCAK,
                    notes=(
                        f"exact degree {exact} of {rounds}-round Keccak-f[25], by "
                        "full-domain Moebius transform over all 2^25 inputs "
                        "(verify/packed.py, evaluated through verify/keccak_columns.py "
                        "and cross-checked against core.keccak.permute). Regenerated and "
                        "asserted byte-equal by tests/test_exhaustive_truth.py"
                    ),
                ),
                assertion=(
                    f"the module's certified upper bound for {rounds}-round Keccak-f[25] "
                    f"is at least the exact degree {exact} measured over the complete "
                    "input space -- that is, the bound is sound"
                ),
                rationale=(
                    "the only falsifiable check on the symbolic propagation rules that "
                    "does not depend on a citation: the exact degree is computed without "
                    "reusing any part of the bounding argument, so a propagation rule "
                    "that undercharges a non-linear step is caught here. It is not a "
                    "published anchor and does not substitute for one"
                ),
                parameters={
                    "rounds": rounds,
                    "width": 25,
                    "variables": 25,
                    "exact_degree": exact,
                    "space_exhausted": "2^25",
                },
            )
        )

    for row in MIMC_EXACT:
        rounds = int(row["rounds"])  # type: ignore[arg-type]
        exact = int(row["exact_degree"])  # type: ignore[arg-type]
        cases.append(
            CalibrationCase(
                case_id=f"CAL-M1-EXH-MIMC-R{rounds}",
                kind=CaseKind.EXHAUSTIVE_GROUND_TRUTH,
                target_id=f"mimc-gf2n n={MIMC_N} rounds={rounds}",
                target_factory=lambda r=rounds: MiMC.create(
                    n=MIMC_N, n_rounds=r, seed=MIMC_SEED
                ),
                quantity="algebraic_degree_upper_bound_derived",
                comparator=Comparator.AT_LEAST,
                expected=exact,
                expectation_provenance=Provenance(
                    computation_id=COMPUTATION_ID_MIMC,
                    notes=(
                        f"exact degree {exact} of {rounds}-round MiMC over GF(2^{MIMC_N}), "
                        f"by exhaustive ANF over all 2^{MIMC_N} inputs. Also computed by "
                        "the independent path in verify/anf.py"
                    ),
                ),
                assertion=(
                    f"the derived exponent-support bound for {rounds}-round MiMC over "
                    f"GF(2^{MIMC_N}) is at least the exact degree {exact} measured over "
                    "the complete input space"
                ),
                rationale=(
                    "the derived bound of Stage A is tighter than doubling, and a bound "
                    "that has been tightened is a bound that can have been tightened too "
                    "far. This case is where that is testable rather than argued: the "
                    "exact degree is computed without the derivation"
                ),
                parameters={
                    "rounds": rounds,
                    "field": f"GF(2^{MIMC_N})",
                    "variables": MIMC_N,
                    "seed": MIMC_SEED,
                    "exact_degree": exact,
                    "space_exhausted": f"2^{MIMC_N}",
                },
            )
        )

    # -- positive control -------------------------------------------------

    cases.append(
        CalibrationCase(
            case_id="CAL-M1-POS-LINEAR",
            kind=CaseKind.POSITIVE_CONTROL,
            target_id=f"linear-map-gf2 n={LINEAR_N} seed={LINEAR_SEED}",
            target_factory=lambda: LinearMapGF2.random_invertible(LINEAR_N, LINEAR_SEED),
            quantity="algebraic_degree",
            comparator=Comparator.EQUAL,
            expected=1,
            expectation_provenance=Provenance(
                computation_id="M1-CTRL-LIN-001",
                notes=(
                    "every output bit is a non-empty GF(2) sum of input bits, so its ANF "
                    "holds only degree-1 monomials; non-emptiness follows from A being "
                    "invertible. Checked in-repo by exhaustive ANF in "
                    "tests/test_core_targets.py"
                ),
            ),
            assertion=(
                f"the module reports algebraic degree exactly 1 for every one of the "
                f"{LINEAR_N} output bits of g(x) = Ax"
            ),
            rationale=(
                "g(x) = Ax produces the same flat single-bit-flip correlation curve as a "
                "strong hash function while being invertible by Gaussian elimination; a "
                "module that cannot see structure here is blind in the maximal case"
            ),
            parameters={"n": LINEAR_N, "seed": LINEAR_SEED, "invertible": True},
        )
    )

    # -- intermediate controls --------------------------------------------

    for exponent in (POWER_EXPONENT_MID, POWER_EXPONENT_CUBE):
        weight = bin(exponent).count("1")
        cases.append(
            CalibrationCase(
                case_id=f"CAL-M1-INT-POW-D{exponent}",
                kind=CaseKind.INTERMEDIATE_CONTROL,
                target_id=f"power-map-gf2n n={POWER_N} d={exponent}",
                target_factory=lambda d=exponent: PowerMap.create(POWER_N, d),
                quantity="algebraic_degree",
                comparator=Comparator.EQUAL,
                expected=weight,
                expectation_provenance=Provenance(
                    computation_id="M1-CTRL-POW-001",
                    notes=(
                        "deg(x^d) = wt(d) over GF(2^n); established in-repo by exhaustive "
                        "ANF for every d at n = 11 in tests/test_core_targets.py"
                    ),
                ),
                assertion=(
                    f"the module reports algebraic degree exactly {weight} for "
                    f"x -> x^{exponent} over GF(2^{POWER_N})"
                ),
                rationale=(
                    "a middle-of-range answer, not an endpoint: an instrument that only "
                    "recovers degree 1 and degree n-1 has not been shown to measure "
                    "anything in between"
                ),
                parameters={"n": POWER_N, "exponent": exponent, "weight": weight},
            )
        )

    # -- negative control --------------------------------------------------

    cases.append(
        CalibrationCase(
            case_id="CAL-M1-NEG-RANDOM",
            kind=CaseKind.NEGATIVE_CONTROL,
            target_id=f"random-function-sha256-prf n={RANDOM_N} seed={RANDOM_SEED}",
            target_factory=lambda: RandomFunction.create(RANDOM_N, RANDOM_N, RANDOM_SEED),
            quantity="algebraic_degree",
            comparator=Comparator.AT_LEAST,
            expected=RANDOM_N - 1,
            expectation_provenance=Provenance(
                computation_id="M1-CTRL-RND-001",
                notes=(
                    "ANF coefficients of a uniform Boolean function are i.i.d. uniform, "
                    f"so degree < n-1 has probability 2^-(n+1) = 2^-{RANDOM_N + 1} per "
                    "output bit; the assertion's false-failure rate is bounded by "
                    f"{RANDOM_N} * 2^-{RANDOM_N + 1}"
                ),
            ),
            assertion=(
                f"the module reports algebraic degree at least {RANDOM_N - 1} for an "
                "i.i.d. random-oracle stand-in"
            ),
            rationale=(
                "establishes the module's floor: the value it returns when there is no "
                "structure to find. A module that reports a degree deficiency here is "
                "reporting an artefact of its own bounding argument"
            ),
            parameters={
                "n": RANDOM_N,
                "m": RANDOM_N,
                "seed": RANDOM_SEED,
                "false_failure_probability": RANDOM_N * 2.0 ** (-(RANDOM_N + 1)),
            },
        )
    )

    # -- blindness ---------------------------------------------------------

    cases.append(
        CalibrationCase(
            case_id="CAL-M1-BLIND-INVERSE",
            kind=CaseKind.BLINDNESS,
            target_id=f"inverse-map-gf2n n={INVERSE_N}",
            target_factory=lambda: InverseMap.create(INVERSE_N),
            quantity="algebraic_degree",
            comparator=Comparator.EQUAL,
            expected=INVERSE_N - 1,
            expectation_provenance=Provenance(
                computation_id="M1-CTRL-INV-001",
                notes=(
                    "x^(2^n - 2) has exponent of Hamming weight n-1, so degree n-1, the "
                    "maximum for a permutation of GF(2^n); checked in-repo by exhaustive "
                    "ANF in tests/test_core_targets.py"
                ),
            ),
            assertion=(
                f"the module reports algebraic degree exactly {INVERSE_N - 1} -- the "
                "maximum for a permutation, i.e. the same null a degree-saturated round "
                "function produces -- for x -> x^(-1) over GF(2^"
                f"{INVERSE_N}), which is described exactly by the single quadratic "
                "relation x*y = 1"
            ),
            rationale=(
                "section 6(b) and 6(c): a concrete function class that has the property "
                "being searched for -- complete algebraic tractability -- and still "
                "returns the null under this measurement. The measurement's blindness is "
                "a property of the measurement, and this case is where it is exhibited "
                "rather than asserted"
            ),
            parameters={
                "n": INVERSE_N,
                "implicit_system": "x*y = 1 for x != 0",
                "solving_cost": "one field inversion",
            },
        )
    )

    return tuple(cases)


SUITE = CalibrationSuite(module_id=MODULE_ID, cases=_cases(), citations=CITATIONS)


if __name__ == "__main__":
    print(SUITE.manifest())
