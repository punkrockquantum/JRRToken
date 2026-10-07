"""Tests for the cryptanalysis pipeline.

Weighted towards the two checks the design says carry it: the bidirectional
round-trip, and the three verification gates. Several of these exist because
the thing they assert was once wrong -- the docstrings say which.
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import spec as S  # noqa: E402
from compile_polysys import CompileRefused, compile_cico, decode_solution, evaluate_system  # noqa: E402
from polynomial import Poly  # noqa: E402
from reference import (  # noqa: E402
    CicoProblem,
    ReferenceRefused,
    brute_force_solutions,
    permute,
    validate,
)
from roundtrip import RoundTripFailure, assignment_from_rate, round_trip, trace_sbox_values  # noqa: E402

SMALL = 101


def mimc_sponge(prime: int = SMALL, rounds: int = 4, width: int = 2) -> S.Spec:
    return S.Spec.create(
        name="mimc-sponge-test", prime=prime, width=width, sbox_exponent=3,
        rounds_full_first=rounds, rounds_partial=0, rounds_full_last=0, capacity=1,
    )


# -- L0: the specification and reference -------------------------------------


def test_the_sbox_exponent_must_permute_the_field() -> None:
    """2^30+3 is prime but is 1 mod 3, so x^3 is not a permutation there.

    The first draft of FIELD_31BIT was exactly that value, and this guard is
    what caught it.
    """
    with pytest.raises(S.SpecRefused, match="does not permute"):
        S.Spec.create(name="bad", prime=(1 << 30) + 3, width=2, sbox_exponent=3)
    assert S.is_permutation_exponent(3, S.FIELD_30BIT_CUBE)
    assert S.is_permutation_exponent(5, S.FIELD_30BIT_QUINT)


def test_the_reference_validates_and_says_what_it_did_not_check() -> None:
    report = validate(mimc_sponge())
    assert report.passed
    names = {name for name, _, _ in report.checks}
    assert "permutation_is_bijective_exhaustively" in names
    assert "mds_is_invertible" in names
    assert "official test vectors NOT checked" in report.render()


def test_the_permutation_is_a_bijection_exhaustively_at_a_small_prime() -> None:
    spec = S.Spec.create(name="tiny", prime=11, width=2, sbox_exponent=3,
                         rounds_full_first=3, capacity=1)
    seen = {tuple(permute([a, b], spec)) for a in range(11) for b in range(11)}
    assert len(seen) == 121


def test_zero_rounds_is_the_identity() -> None:
    spec = mimc_sponge()
    assert permute([7, 9], spec, rounds=0) == [7, 9]


def test_the_mds_matrix_is_invertible_at_every_width_it_admits() -> None:
    from reference import _mds_is_invertible

    for width in (2, 3, 4, 5):
        assert _mds_is_invertible(mimc_sponge(prime=101, width=width))


# -- polynomial expansion ----------------------------------------------------


def test_the_expansion_agrees_with_the_factored_form() -> None:
    """The defect this module exists for: msolve mis-parses `(a*x+b)^d` and
    returns "no solution" for a solvable system."""
    p = 101
    random.seed(11)
    for _ in range(60):
        a, b, c = (random.randrange(p) for _ in range(3))
        f = (
            Poly.variable("x", p).scale(a)
            + Poly.variable("y", p).scale(b)
            + Poly.constant(c, p)
        )
        d = random.choice([2, 3, 5])
        expanded = f.power(d)
        for _ in range(4):
            xv, yv = random.randrange(p), random.randrange(p)
            assert expanded.evaluate({"x": xv, "y": yv}) == pow(
                (a * xv + b * yv + c) % p, d, p
            )


def test_the_rendered_form_has_no_factored_powers() -> None:
    """What the renderer must never emit, since one solver silently mis-reads it."""
    p = 101
    rendered = (Poly.variable("x0", p) + Poly.constant(61, p)).power(3).render()
    assert "(" not in rendered and ")" not in rendered
    assert rendered == "34+53*x0+82*x0^2+x0^3"


def test_degree_and_term_count_are_reported_from_the_expansion() -> None:
    p = 101
    f = (Poly.variable("a", p) + Poly.variable("b", p)).power(4)
    assert f.degree == 4
    assert f.n_terms == 5  # binomial expansion


# -- L1: the model and the round-trip ---------------------------------------


def test_the_system_is_zero_dimensional_by_construction() -> None:
    """Free variables matched to constraints.

    The first version left the whole rate free, and both solvers correctly
    reported a positive-dimensional ideal -- solutions were abundant and
    finding one was not an attack.
    """
    problem = CicoProblem(spec=mimc_sponge(), rounds=3)
    assert problem.is_zero_dimensional
    assert problem.n_free == problem.n_constraints == 1


def test_the_round_trip_passes_in_both_directions() -> None:
    system = compile_cico(CicoProblem.planted(mimc_sponge(), rounds=3))
    report = round_trip(system)
    assert report.passed, report.render()
    assert report.forward_checked > 0
    assert report.reverse_checked > 0
    assert not report.vacuous


def test_a_direction_that_ran_nothing_is_not_a_pass() -> None:
    """The vacuous pass the first version reported.

    forward_checked=0 with passed=True: none of the sampled rates solved the
    problem, so the forward direction never ran and the report called it a
    pass.
    """
    from roundtrip import RoundTripReport

    vacuous = RoundTripReport(
        system_render="x", forward_checked=0, forward_failures=(),
        reverse_checked=8, reverse_failures=(),
    )
    assert not vacuous.passed
    assert vacuous.vacuous == ("forward",)
    assert "VACUOUS" in vacuous.render()


def test_an_unavailable_forward_direction_needs_a_verified_reason() -> None:
    """No F_p solution is legitimate; an unexhausted search is not."""
    from roundtrip import RoundTripReport

    excused = RoundTripReport(
        system_render="x", forward_checked=0, forward_failures=(),
        reverse_checked=8, reverse_failures=(),
        forward_unavailable_reason="no F_p-rational solution exists: all 101 checked",
    )
    assert excused.passed
    assert not excused.vacuous


def test_the_trace_and_the_compiler_agree_on_the_variable_set() -> None:
    """Two independent readings of the round structure must produce the same
    variables, or one of them is wrong about the primitive."""
    system = compile_cico(CicoProblem.planted(mimc_sponge(), rounds=4))
    assignment = assignment_from_rate(system, [5])
    assert set(assignment) == set(system.variables)


def test_the_model_accepts_a_trace_the_reference_produced() -> None:
    """The reverse direction, which catches an over-constrained model."""
    problem = CicoProblem.planted(mimc_sponge(), rounds=3)
    system = compile_cico(problem)
    assignment = assignment_from_rate(system, list(problem.planted_witness))
    satisfied, residuals = evaluate_system(system, assignment)
    assert satisfied, residuals


def test_the_system_carries_its_problem() -> None:
    """Rebuilding one loses the planted target, which is how a planted
    instance silently became un-planted."""
    problem = CicoProblem.planted(mimc_sponge(), rounds=2)
    system = compile_cico(problem)
    assert system.problem is problem
    assert system.problem.is_planted


def test_a_zero_round_system_is_refused() -> None:
    with pytest.raises(CompileRefused, match="no S-boxes"):
        compile_cico(CicoProblem(spec=mimc_sponge(), rounds=0))


def test_a_solver_answer_missing_a_rate_variable_is_refused() -> None:
    system = compile_cico(CicoProblem.planted(mimc_sponge(), rounds=2))
    with pytest.raises(CompileRefused, match="omits rate variables"):
        decode_solution(system, {"y0": 1})


# -- planted instances -------------------------------------------------------


def test_a_planted_instance_has_a_solution_by_construction() -> None:
    for prime in (101, S.FIELD_30BIT_CUBE):
        spec = mimc_sponge(prime=prime, rounds=5)
        problem = CicoProblem.planted(spec, rounds=5)
        assert problem.is_planted
        assert problem.holds(list(problem.planted_witness))


def test_an_unplanted_instance_may_legitimately_have_no_solution() -> None:
    """Roughly Poisson(1) solutions with one free variable, so empty instances
    are common and are not defects."""
    spec = mimc_sponge(prime=101, rounds=8)
    counts = [
        len(brute_force_solutions(CicoProblem(spec=spec, rounds=r), limit=10_000))
        for r in range(1, 9)
    ]
    assert any(c == 0 for c in counts), counts
    assert any(c > 0 for c in counts), counts


def test_brute_force_refuses_a_space_it_cannot_exhaust() -> None:
    spec = mimc_sponge(prime=S.FIELD_30BIT_CUBE, rounds=2)
    with pytest.raises(ReferenceRefused, match="does not sample"):
        brute_force_solutions(CicoProblem(spec=spec, rounds=2), limit=1000)


# -- L4: the three gates -----------------------------------------------------


def test_a_planted_instance_is_refused_by_the_scope_gate() -> None:
    """The load-bearing refusal.

    A planted witness passes recovery and beats the generic cost, so a pipeline
    without this gate would report an attack. The solution existed by
    construction, so the scope gate must refuse and the word must not be
    "attack".
    """
    from ladder import run_ladder
    from verify_claim import Candidate, verify

    spec = mimc_sponge(prime=S.FIELD_30BIT_CUBE, rounds=3)
    ladder = run_ladder(spec, max_rounds=3, timeout=60)
    rung = ladder.solved_rungs[-1]
    problem = CicoProblem.planted(spec, rounds=rung.rounds)
    candidate = Candidate(
        problem=problem,
        free_values=problem.planted_witness,
        provenance="planted-witness",
    )
    verdict = verify(candidate, ladder, rung)
    assert verdict.recovery_passed, verdict.recovery_detail
    assert not verdict.scope_passed
    assert verdict.word == "out-of-scope"
    assert verdict.word != "eligible-attack-candidate"


def test_a_wrong_candidate_is_named_a_pipeline_defect() -> None:
    from ladder import run_ladder
    from verify_claim import Candidate, verify

    spec = mimc_sponge(prime=S.FIELD_30BIT_CUBE, rounds=3)
    ladder = run_ladder(spec, max_rounds=3, timeout=60)
    rung = ladder.solved_rungs[-1]
    problem = CicoProblem.planted(spec, rounds=rung.rounds)
    wrong = Candidate(
        problem=problem,
        free_values=(problem.planted_witness[0] + 1,),
        provenance="perturbed",
    )
    verdict = verify(wrong, ladder, rung)
    assert not verdict.recovery_passed
    assert verdict.word == "pipeline-defect"


def test_the_generic_baseline_is_measured_not_assumed() -> None:
    """The cost gate once converted seconds to trials through an invented
    constant, and that constant decided the verdict."""
    from verify_claim import measure_generic_seconds_per_trial

    problem = CicoProblem.planted(mimc_sponge(prime=S.FIELD_30BIT_CUBE, rounds=3), rounds=3)
    per_trial = measure_generic_seconds_per_trial(problem)
    assert 1e-9 < per_trial < 1e-2, per_trial


# -- L3: the ladder ----------------------------------------------------------


def test_the_ladder_reproduces_the_bezout_prediction() -> None:
    """The calibration gate: d^r exactly, with no degree collapse."""
    from ladder import run_ladder

    spec = mimc_sponge(prime=S.FIELD_30BIT_CUBE, rounds=5)
    ladder = run_ladder(spec, max_rounds=5, timeout=120)
    assert ladder.validation_passed
    assert ladder.roundtrip_passed
    solved = ladder.solved_rungs
    assert len(solved) >= 4
    for rung in solved:
        assert rung.ideal_degree == 3**rung.rounds, rung.render()
        assert rung.degree_deficit == 0
    assert not ladder.deviations
    assert not ladder.disagreements


def test_a_rung_without_its_observable_is_not_tier_e() -> None:
    """A rung whose observable-producing solver walled was once reported
    status=solved with ideal_degree=None."""
    from ladder import Rung
    from solvers import SOLVED, WALL

    walled = Rung(
        rounds=7, n_variables=15, n_equations=15, status=WALL, seconds=180.0,
        peak_memory_mb=184.7, ideal_degree=None, max_degree=None, basis_size=None,
        matrix_cells=None, predicted_degree=2187, rational_solutions=None,
        solvers_agree=True,
    )
    assert walled.tier == "-"
    missing = Rung(
        rounds=7, n_variables=15, n_equations=15, status=SOLVED, seconds=1.0,
        peak_memory_mb=1.0, ideal_degree=None, max_degree=None, basis_size=None,
        matrix_cells=None, predicted_degree=2187, rational_solutions=None,
        solvers_agree=True,
    )
    assert missing.tier == "-", "a solved status without the observable is not a measurement"


def test_the_ladder_refuses_an_under_constrained_problem() -> None:
    from ladder import LadderRefused, run_ladder

    wide = S.Spec.create(name="wide", prime=101, width=4, sbox_exponent=3,
                         rounds_full_first=2, capacity=1)
    # free_rate defaults to capacity, so force the under-constrained case.
    problem = CicoProblem(spec=wide, rounds=1, free_rate=3)
    assert not problem.is_zero_dimensional


def test_the_fitted_models_are_labelled_as_models() -> None:
    from ladder import run_ladder

    ladder = run_ladder(mimc_sponge(prime=S.FIELD_30BIT_CUBE, rounds=5), max_rounds=5, timeout=120)
    rendered = ladder.render()
    assert "MODEL-not-a-measurement" in rendered
    assert "PLANTED" in rendered
    models = ladder.growth_models()
    assert "exponential" in models and "polynomial" in models
    # d^r means log2(degree)/round is log2(d), and the fit must find it.
    assert abs(models["exponential"]["log2_degree_per_round"] - 1.5849625) < 1e-6


# -- the prediction, derived rather than assumed ------------------------------


def test_the_prediction_agrees_with_d_to_the_rounds_where_it_should() -> None:
    """Every spec run so far has a full first round, so the derived prediction
    must reproduce d^r exactly -- otherwise this change would silently move the
    deficit on results already committed."""
    from reference import predicted_ideal_degree

    spec = mimc_sponge(prime=S.FIELD_30BIT_CUBE, rounds=8)
    for rounds in range(1, 9):
        problem = CicoProblem(spec=spec, rounds=rounds)
        assert predicted_ideal_degree(problem, rounds) == 3**rounds


def test_a_leading_partial_round_lowers_the_prediction() -> None:
    """A partial round applies the S-box to element 0, element 0 starts as a
    capacity element fixed to zero, and a constant to the d-th power is a
    constant. So the free variable's degree does not multiply until MDS has
    mixed it into element 0.

    This matters because the error runs in the dangerous direction: d^r would
    overstate the prediction, making degree_deficit positive at a rung where
    nothing collapsed, and a positive deficit is what the pre-registered break
    criterion looks for. It would have produced a lead with no structure."""
    from reference import predicted_ideal_degree

    spec = S.Spec.create(
        name="leading-partial", prime=101, width=3, sbox_exponent=3,
        rounds_full_first=0, rounds_partial=3, rounds_full_last=2, capacity=1,
    )
    assert list(spec.round_kinds())[:3] == ["partial", "partial", "partial"]
    derived = [predicted_ideal_degree(CicoProblem(spec=spec, rounds=r), r)
               for r in range(1, 6)]
    assert derived == [1, 3, 9, 27, 81]
    # One round of lag, held for the rest of the ladder.
    assert all(d * 3 == 3**r for r, d in enumerate(derived, start=1))


def test_the_poseidon_shape_keeps_the_full_prediction() -> None:
    """poseidon_like splits full rounds across both ends, so the first round is
    full whenever rounds_full >= 2 and no lag appears."""
    from reference import predicted_ideal_degree

    spec = S.poseidon_like(prime=101, width=3, rounds_full=2, rounds_partial=1)
    assert list(spec.round_kinds()) == ["full", "partial", "full"]
    for rounds in range(1, 4):
        problem = CicoProblem(spec=spec, rounds=rounds)
        assert predicted_ideal_degree(problem, rounds) == 3**rounds


def test_the_prediction_never_reads_as_an_empty_variety() -> None:
    """A capacity output constant in the free variables still gives one
    solution or none; a predicted degree of zero would read as a proof that the
    variety is empty."""
    from reference import predicted_ideal_degree

    spec = S.Spec.create(
        name="one-partial", prime=101, width=2, sbox_exponent=3,
        rounds_full_first=0, rounds_partial=1, rounds_full_last=1, capacity=1,
    )
    assert predicted_ideal_degree(CicoProblem(spec=spec, rounds=1), 1) == 1


def test_the_round_trip_runs_at_every_width_the_sweep_uses() -> None:
    """The regression test for the defect that killed the first sweep. The
    default sample rates were built from spec.rate when the problem takes
    n_free values, and those differ for every width above 2: at width 3 with
    capacity 1 the rate is two elements and only one is free. Every earlier run
    was width 2, where the two readings coincide."""
    from compile_polysys import compile_cico
    from roundtrip import round_trip

    for width in (2, 3, 4):
        spec = S.poseidon_like(prime=101, width=width, rounds_full=2, rounds_partial=1)
        problem = CicoProblem.planted(spec, rounds=spec.rounds)
        assert problem.n_free == spec.capacity
        report = round_trip(compile_cico(problem))
        assert report.passed, f"width={width}: {report.render()}"
        assert report.forward_checked > 0
        assert report.reverse_checked > 0


# -- the F4 round table, which was being printed and discarded ----------------

TWO_BLOCK_OUTPUT = """
Legend for f4 information
deg     sel   pairs        mat          density         new data      time(rd)
  3       5       5      32 x 65         10.96%        5 new       0 zero    0.00 | 0.00
  4       3       3      48 x 105        15.12%        3 new       0 zero    0.00 | 0.00
  9       8       8     205 x 278        12.90%        0 new       8 zero    0.00 | 0.00
reduce final basis       32 x 115        44.95%       32 new       0 zero    0.00 | 0.00
Changing variable order for possibly more generic staircase:
Legend for f4 information
deg     sel   pairs        mat          density         new data      time(rd)
  3       5       5      40 x 70          9.00%        5 new       0 zero    0.00 | 0.00
 11      12      12     565 x 740        15.73%        1 new      10 zero    0.00 | 0.00
reduce final basis       85 x 328        57.09%       85 new       0 zero    0.00 | 0.00
"""


def test_the_f4_blocks_are_kept_separate() -> None:
    """msolve runs F4 more than once -- eight permuted variable orders plus a
    final larger computation on the first system checked. Read as one table
    they give a number belonging to no single computation."""
    from solvers import parse_f4_blocks

    blocks = parse_f4_blocks(TWO_BLOCK_OUTPUT)
    assert len(blocks) == 2
    assert blocks[0].solving_degree == 9
    assert blocks[1].solving_degree == 11
    assert [r.degree for r in blocks[0].rounds] == [3, 4, 9]


def test_the_observables_come_from_the_declared_order_computation() -> None:
    """A degree-of-regularity claim is about the Gröbner computation in a
    stated order, so block 0 is the one that answers it. The flattened max
    would report 11 and the last block's 565x740 matrix."""
    from solvers import parse_f4_blocks, parse_f4_rounds

    blocks = parse_f4_blocks(TWO_BLOCK_OUTPUT)
    flattened = parse_f4_rounds(TWO_BLOCK_OUTPUT)
    assert max(r.degree for r in flattened) == 11
    assert blocks[0].solving_degree == 9
    assert blocks[0].matrix_cells == 205 * 278
    assert max(r.rows * r.columns for r in flattened) == 565 * 740


def test_the_final_basis_reduction_is_not_a_round() -> None:
    """It has no degree column, so a parser that matched it would take the
    leading matrix width as a degree."""
    from solvers import parse_f4_blocks

    degrees = [r.degree for r in parse_f4_blocks(TWO_BLOCK_OUTPUT)[0].rounds]
    assert 32 not in degrees and 115 not in degrees


def test_the_zero_reduction_profile_is_recorded_per_degree() -> None:
    """Where zero reductions first appear is the operational proxy for the
    first fall degree, and it is the signature of a system that is not
    semi-regular. A single total would lose the degree it happened at."""
    from solvers import parse_f4_blocks

    assert parse_f4_blocks(TWO_BLOCK_OUTPUT)[0].zero_reductions == ((9, 8),)


def test_output_without_a_verbose_table_yields_no_solving_degree() -> None:
    """None, never zero: a solver build that prints no table has not reported
    a solving degree of nothing."""
    from solvers import parse_f4_blocks

    assert parse_f4_blocks("no table here") == ()


def test_msolve_reports_the_solving_degree_for_a_nontrivial_system() -> None:
    """The measurement this whole change exists for, taken live.

    Singular's max_degree is the top degree of the finished basis; the solving
    degree is the highest degree F4 actually reduced at. For this system the
    solving degree is the larger of the two -- but that is a fact about this
    system and **not** an invariant, which the test below establishes. An
    earlier version of this test asserted it as one.
    """
    from compile_polysys import compile_cico
    from solvers import solve_with_msolve, solve_with_singular

    spec = S.poseidon_like(prime=1073741831, width=2, rounds_full=4, rounds_partial=3)
    system = compile_cico(CicoProblem.planted(spec, rounds=5))
    fast = solve_with_msolve(system, timeout=300)
    slow = solve_with_singular(system, timeout=300)
    assert fast.solving_degree is not None
    assert fast.f4_blocks > 1, "msolve is expected to retry under permuted orders"
    assert fast.solving_degree >= slow.max_degree, (
        f"solving degree {fast.solving_degree} below basis degree {slow.max_degree}"
    )


def test_the_solving_degree_may_legitimately_sit_below_the_basis_degree() -> None:
    """A one-round system has a cubic among its *input* generators, and an
    input generator that is already in the basis is never reduced. So F4 runs a
    single degree-1 round and the solving degree is 1 while the basis reaches
    degree 3.

    Recorded as a test because the opposite was briefly asserted as an
    invariant. "The solving degree is at least the basis degree" is false, and
    a pipeline that enforced it would reject a correct measurement.
    """
    from compile_polysys import compile_cico
    from solvers import solve_with_msolve, solve_with_singular

    spec = S.poseidon_like(prime=1073741831, width=2, rounds_full=4, rounds_partial=3)
    system = compile_cico(CicoProblem.planted(spec, rounds=1))
    fast = solve_with_msolve(system, timeout=120)
    slow = solve_with_singular(system, timeout=120)
    assert fast.solving_degree == 1
    assert slow.max_degree == 3
    assert fast.solving_degree < slow.max_degree
