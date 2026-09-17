"""Module 1's measurement path.

The load-bearing property is soundness: a certified upper bound that ever falls
below the exact degree is a broken instrument, and every result downstream of it
is wrong in the dangerous direction. That property is checked against the
independent exhaustive path in ``verify/`` on every target the module supports.
"""

from __future__ import annotations

import pytest

from core.keccak import KeccakF
from core.mimc import MiMC
from core.targets import InverseMap, LinearMapGF2, PowerMap, RandomFunction
from modules.degree.measure import (
    MAX_EXACT_VARS,
    MeasurementRefused,
    SymbolicWord,
    degree_upper_bound,
    exact_degree,
    exact_degree_profile,
    measure,
    witness_lower_bound,
)
from verify.anf import algebraic_degree, degree_profile

CONTROLS = [
    ("linear n=9", LinearMapGF2.random_invertible(9, 20260824)),
    ("power d=3 n=9", PowerMap.create(9, 3)),
    ("power d=31 n=11", PowerMap.create(11, 31)),
    ("power d=127 n=11", PowerMap.create(11, 127)),
    ("inverse n=9", InverseMap.create(9)),
    ("inverse n=11", InverseMap.create(11)),
    ("mimc r=1 n=9", MiMC.create(n=9, n_rounds=1)),
    ("mimc r=2 n=9", MiMC.create(n=9, n_rounds=2)),
    ("mimc r=3 n=9", MiMC.create(n=9, n_rounds=3)),
]


# -- the symbolic word ------------------------------------------------------


def test_xor_takes_the_maximum_and_and_takes_the_sum() -> None:
    a = SymbolicWord([2, 3], 2)
    b = SymbolicWord([5, 1], 2)
    assert (a ^ b).bits == (5, 3)
    assert (a & b).bits == (7, 4)


def test_structural_zero_is_not_charged_as_a_product() -> None:
    """The rotation idiom ORs two disjoint shifted copies; charging that as a
    product would inflate every bound through a rotation."""
    a = SymbolicWord([3, None], 2)
    b = SymbolicWord([None, 4], 2)
    assert (a | b).bits == (3, 4)
    assert (a & b).bits == (None, None)


def test_xor_with_a_constant_is_affine() -> None:
    a = SymbolicWord([3, None], 2)
    assert (a ^ 0b11).bits == (3, 0)  # a zero bit becomes the constant 1


def test_masking_selects_and_never_raises_a_degree() -> None:
    a = SymbolicWord([3, 4], 2)
    assert (a & 0b01).bits == (3, None)


def test_complement_is_affine() -> None:
    assert (~SymbolicWord([3, None], 2)).bits == (3, 0)


def test_shifts_introduce_structural_zeros() -> None:
    a = SymbolicWord([1, 2, 3], 3)
    assert (a << 1).bits == (None, 1, 2)
    assert (a >> 1).bits == (2, 3, None)


def test_degree_of_an_all_constant_word_is_zero() -> None:
    assert SymbolicWord.zero(4).degree == 0


def test_width_mismatch_is_refused() -> None:
    with pytest.raises(ValueError, match="width mismatch"):
        SymbolicWord.variables(3) ^ SymbolicWord.variables(4)


# -- soundness: the bound never falls below the truth -----------------------


@pytest.mark.parametrize("name,target", CONTROLS, ids=[c[0] for c in CONTROLS])
def test_the_certified_bound_is_never_below_the_exact_degree(name: str, target) -> None:
    bound = degree_upper_bound(target).value
    exact = exact_degree(target)
    assert bound >= exact, f"{name}: bound {bound} is below the true degree {exact}"


@pytest.mark.parametrize("rounds", [1, 2, 3, 4])
def test_the_keccak_bound_is_never_below_the_truth_on_a_declared_subspace(rounds: int) -> None:
    """Measured on a 12-variable coordinate subspace, the rest of the state held
    at zero. Restricting variables cannot raise the degree, so the full-state
    bound must still dominate."""
    target = KeccakF.create(0, rounds)
    bound = degree_upper_bound(target).value
    restricted = algebraic_degree(target, 12, 25)
    assert bound >= restricted


# -- the exact path agrees with the independent exhaustive path -------------


@pytest.mark.parametrize("name,target", CONTROLS, ids=[c[0] for c in CONTROLS])
def test_the_exact_path_agrees_with_verify(name: str, target) -> None:
    """Two implementations, no shared code: subset-sum ANF here, an in-place
    Moebius butterfly in verify/."""
    assert exact_degree(target) == algebraic_degree(target, target.n_in, target.n_out)


def test_the_per_bit_profile_agrees_with_verify() -> None:
    target = LinearMapGF2.random_invertible(9, 20260824)
    assert exact_degree_profile(target) == degree_profile(target, 9, 9)


def test_the_exact_path_recovers_the_hamming_weight_rule() -> None:
    for exponent in range(1, 100):
        assert exact_degree(PowerMap.create(9, exponent)) == bin(exponent).count("1")


# -- the bound is tight where the theory says it should be ------------------


def test_the_bound_is_tight_on_power_maps() -> None:
    """Square-and-multiply with Frobenius charged as linear gives exactly wt(d)."""
    for exponent in (3, 7, 31, 127):
        target = PowerMap.create(11, exponent)
        assert degree_upper_bound(target).value == bin(exponent).count("1")


def test_the_keccak_bound_doubles_per_round_until_the_permutation_cap() -> None:
    values = [degree_upper_bound(KeccakF.create(0, r)).value for r in range(1, 7)]
    assert values == [2, 4, 8, 16, 24, 24]
    assert degree_upper_bound(KeccakF.create(0, 5)).capped_by_permutation


def test_the_mimc_bound_is_loose_against_the_exact_degree() -> None:
    """The gap the arithmetisation-oriented literature is about: naive doubling
    overstates MiMC's degree growth."""
    target = MiMC.create(n=9, n_rounds=3)
    assert degree_upper_bound(target).value == 8
    assert exact_degree(target) == 4


def test_every_bound_carries_its_derivation() -> None:
    for _name, target in CONTROLS:
        assert degree_upper_bound(target).derivation.strip()


# -- witnessed lower bounds -------------------------------------------------


def test_a_witness_at_the_exact_degree_is_found() -> None:
    target = PowerMap.create(11, 31)
    outcome = witness_lower_bound(target, 5, list(range(50)))
    assert outcome.witnessed
    assert outcome.witness_seed is not None
    assert "is a proof, not a sample" in outcome.derivation


def test_no_witness_exists_above_the_degree() -> None:
    """Every derivative of order above the degree vanishes identically, so this
    null is structural rather than a sampling artefact."""
    target = PowerMap.create(11, 3)
    outcome = witness_lower_bound(target, 4, list(range(30)))
    assert not outcome.witnessed
    assert outcome.seeds_drawn == 30
    assert "no promotion path above probe dimension 2" in outcome.derivation


def test_a_probe_wider_than_the_domain_is_refused() -> None:
    with pytest.raises(MeasurementRefused, match="no such subspace exists"):
        witness_lower_bound(PowerMap.create(9, 3), 10, [1])


# -- refusals ---------------------------------------------------------------


def test_a_random_oracle_has_no_bound_path_and_says_so() -> None:
    with pytest.raises(MeasurementRefused, match="no round structure"):
        degree_upper_bound(RandomFunction.create(9, 9, 1))


def test_an_unknown_target_family_is_refused() -> None:
    with pytest.raises(MeasurementRefused, match="no degree-bound propagation path"):
        degree_upper_bound(object())


def test_the_exact_path_refuses_rather_than_approximating() -> None:
    target = KeccakF.create(0, 1)
    with pytest.raises(MeasurementRefused, match="does not approximate"):
        exact_degree(target, n=MAX_EXACT_VARS + 1, m=25)


def test_an_unknown_quantity_is_refused() -> None:
    class Case:
        quantity = "something-else"

    with pytest.raises(MeasurementRefused, match="no measurement path for quantity"):
        measure(PowerMap.create(9, 3), Case())


# -- the calibration entry point -------------------------------------------


def test_measure_dispatches_on_the_quantity() -> None:
    class Exact:
        quantity = "algebraic_degree"

    class Bound:
        quantity = "algebraic_degree_upper_bound"

    target = PowerMap.create(11, 31)
    assert measure(target, Exact()) == 5
    assert measure(target, Bound()) == 5


def test_the_control_calibration_passes_through_the_module_path() -> None:
    from modules.degree.spec import SPEC

    report = SPEC.suite.run_controls(SPEC.measure)
    assert report.satisfied, report.render()
    # Every case except the published ground truth, which has no value to
    # compare against until it is transcribed. Stated as the complement rather
    # than as a count, so adding a control cannot leave this test asserting
    # something weaker than it means.
    from harness.calibration import CaseKind

    expected_ids = {
        case.case_id
        for case in SPEC.suite.cases
        if case.kind is not CaseKind.PUBLISHED_GROUND_TRUTH
    }
    assert {o.case_id for o in report.outcomes} == expected_ids
    assert expected_ids, "run_controls with nothing to run would pass vacuously"


def test_the_published_ground_truth_gate_is_not_lifted_by_running_controls() -> None:
    from tiers.errors import CalibrationBlocked

    from modules.degree.spec import SPEC

    SPEC.suite.run_controls(SPEC.measure)
    assert SPEC.suite.gate().blocked
    with pytest.raises(CalibrationBlocked):
        SPEC.suite.run(SPEC.measure)
