"""Tests for the second encoding.

Its whole purpose is to decide whether a measured difference between full and
partial rounds is about the cipher or about the model. That only works if the
encoding is (a) a faithful model of the same cipher and (b) genuinely
controlled. Both are tested here; neither is assumed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import spec as S  # noqa: E402
from compile_polysys import CompileRefused, PolynomialSystem, compile_cico  # noqa: E402
from compile_state import compile_cico_state, cubic_equation_count  # noqa: E402
from reference import CicoProblem  # noqa: E402
from roundtrip import RoundTripFailure, round_trip  # noqa: E402

SHAPES = ((4, 1), (2, 3), (4, 3), (2, 1), (1, 2))


def spec_for(width: int, rounds_full: int, rounds_partial: int) -> S.Spec:
    return S.poseidon_like(
        prime=1073741831, width=width, rounds_full=rounds_full,
        rounds_partial=rounds_partial,
    )


# -- faithfulness ------------------------------------------------------------


def test_the_state_encoding_round_trips_in_both_directions() -> None:
    """The load-bearing check, run on the second encoding through the *same*
    code as the first. A second round-trip implementation could be wrong in a
    different way and agree with a wrong compiler."""
    for width in (2, 3):
        for full, partial in SHAPES:
            spec = spec_for(width, full, partial)
            for rounds in range(1, spec.rounds + 1):
                system = compile_cico_state(CicoProblem.planted(spec, rounds=rounds))
                report = round_trip(system)
                assert report.passed, report.render()
                assert report.forward_checked > 0
                assert report.reverse_checked > 0


def test_the_two_encodings_agree_on_the_solution_count() -> None:
    """The cross-model check. vdim is the number of solutions over the closure;
    two faithful models of the same CICO problem must report the same one, and
    if they do not, at least one is not a model of this cipher."""
    from solvers import solve_with_singular

    spec = spec_for(2, 4, 1)
    for rounds in range(1, 4):
        problem = CicoProblem.planted(spec, rounds=rounds)
        first = solve_with_singular(compile_cico(problem), timeout=200)
        second = solve_with_singular(compile_cico_state(problem), timeout=200)
        assert first.solution_count == second.solution_count == 3**rounds


# -- the control -------------------------------------------------------------


def test_every_round_adds_the_same_variables_whatever_its_kind() -> None:
    """The property that makes the comparison valid.

    Under the S-box encoding a full round adds `width` variables and a partial
    round adds one, so the kinds differ in nonlinearity *and* in generator
    count. Here both add exactly 2*width, so only the nonlinearity differs.
    """
    for width in (2, 3):
        full_spec = spec_for(width, 6, 0)
        partial_spec = spec_for(width, 2, 4)
        for rounds in range(1, 4):
            a = compile_cico_state(CicoProblem.planted(full_spec, rounds=rounds))
            b = compile_cico_state(CicoProblem.planted(partial_spec, rounds=rounds))
            assert a.n_variables == b.n_variables == 1 + 2 * width * rounds
            assert a.n_equations == b.n_equations == 2 * width * rounds + 1


def test_the_sbox_encoding_does_not_have_that_property() -> None:
    """Stated explicitly, because it is the confound the second encoding
    exists to remove. If this ever stops being true the comparison loses its
    point and this test says so."""
    width = 3
    full_spec = spec_for(width, 6, 0)
    partial_spec = spec_for(width, 2, 4)
    rounds = 3
    a = compile_cico(CicoProblem.planted(full_spec, rounds=rounds))
    b = compile_cico(CicoProblem.planted(partial_spec, rounds=rounds))
    assert a.n_variables != b.n_variables


def test_only_the_cubic_count_differs_between_the_kinds() -> None:
    """A full round contributes `width` cubics, a partial round one -- and the
    independent count agrees with what the compiler emitted."""
    for width in (2, 3):
        for full, partial in SHAPES:
            spec = spec_for(width, full, partial)
            for rounds in range(1, spec.rounds + 1):
                problem = CicoProblem.planted(spec, rounds=rounds)
                system = compile_cico_state(problem)
                emitted = sum(1 for d in system.degrees if d == 3)
                assert emitted == cubic_equation_count(problem)


def test_an_sbox_on_a_constant_is_not_a_cubic_equation() -> None:
    """The subtlety the first independent count got wrong, and the
    disagreement between the two readings is what found it. At round 1 the
    capacity element is zero, so cubing it gives a constant and the equation is
    linear -- the same effect that makes predicted_ideal_degree lag."""
    spec = spec_for(2, 4, 1)  # round 1 is full, so both elements get an S-box
    problem = CicoProblem.planted(spec, rounds=1)
    system = compile_cico_state(problem)
    assert sum(1 for d in system.degrees if d == 3) == 1, "not 2, despite two S-boxes"
    assert cubic_equation_count(problem) == 1


# -- refusals ----------------------------------------------------------------


def test_a_zero_round_system_is_refused() -> None:
    spec = spec_for(2, 4, 1)
    with pytest.raises(CompileRefused):
        compile_cico_state(CicoProblem.planted(spec, rounds=1).__class__(
            spec=spec, rounds=0))


def test_an_encoding_with_no_trace_cannot_be_round_tripped() -> None:
    """A system the round-trip cannot check must not reach a solver."""
    spec = spec_for(2, 4, 1)
    problem = CicoProblem.planted(spec, rounds=2)
    real = compile_cico_state(problem)
    impostor = PolynomialSystem(
        spec=real.spec, rounds=real.rounds, problem=real.problem,
        variables=real.variables, equations=real.equations,
        rate_variables=real.rate_variables, encoding="something-else",
        degrees=real.degrees, polys=real.polys,
    )
    with pytest.raises(RoundTripFailure) as excinfo:
        round_trip(impostor)
    assert "no trace is defined" in str(excinfo.value)
