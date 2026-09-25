"""L1's enforcement — the bidirectional round-trip test.

This is the load-bearing check in the pipeline. Two directions, each catching a
defect that would otherwise run silently for months.

**Forward.** Take any assignment the model satisfies, decode the rate, and run
it through ``reference.py``. The CICO problem must hold. A model that passes
this cannot be describing a different cipher from the one the reference
implements -- which is the failure that makes an attack an attack on nothing.

**Reverse.** Take an input/output pair from ``reference.py``, encode the *whole*
trace into an assignment, and require the model to accept it with every residual
zero. This catches an over-constrained model. That failure is far nastier than
the forward one, because an over-constrained system is simply unsatisfiable: the
solver returns "no solution", the driver records "no attack found", and
everything looks like a clean negative result forever.

The reverse direction needs the intermediate S-box values, so it re-runs the
permutation while recording them. That tracing code is written here rather than
imported, so the model is checked against a second reading of the round
structure rather than against the one that generated it.
"""

from __future__ import annotations

from dataclasses import dataclass

from compile_polysys import PolynomialSystem, decode_solution, evaluate_system
from reference import CicoProblem, apply_mds, sbox
from spec import Spec


class RoundTripFailure(Exception):
    """The model and the reference implementation disagree."""


def trace_sbox_values(state: list[int], spec: Spec, rounds: int) -> list[int]:
    """Every S-box output, in the order the compiler introduces its variables.

    Deliberately a second, independent transcription of the round structure. If
    this disagrees with ``reference.permute``, the reverse test fails and the
    disagreement is the finding -- one of the two readings is wrong about the
    primitive.
    """
    p = spec.prime
    current = [v % p for v in state]
    outputs: list[int] = []
    for index, kind in enumerate(spec.round_kinds()):
        if index >= rounds:
            break
        current = [(current[i] + spec.constants[index][i]) % p for i in range(spec.width)]
        targets = range(spec.width) if kind == "full" else range(1)
        for i in targets:
            current[i] = sbox(current[i], spec)
            outputs.append(current[i])
        current = apply_mds(current, spec)
    return outputs


def assignment_from_rate(
    system: PolynomialSystem, rate: list[int]
) -> dict[str, int]:
    """The full assignment -- rate plus every intermediate -- for a rate input."""
    problem = CicoProblem(spec=system.spec, rounds=system.rounds)
    state = problem.input_from_rate(rate)
    sbox_values = trace_sbox_values(state, system.spec, system.rounds)

    assignment = {name: rate[i] % system.spec.prime
                  for i, name in enumerate(system.rate_variables)}
    for index, value in enumerate(sbox_values):
        assignment[f"y{index}"] = value

    declared = set(system.variables)
    produced = set(assignment)
    if declared != produced:
        raise RoundTripFailure(
            f"the trace produced variables {sorted(produced - declared)} that the "
            f"model does not declare, and omitted {sorted(declared - produced)}. "
            "The two readings of the round structure disagree."
        )
    return assignment


@dataclass(frozen=True, slots=True)
class RoundTripReport:
    system_render: str
    forward_checked: int
    forward_failures: tuple[str, ...]
    reverse_checked: int
    reverse_failures: tuple[str, ...]

    @property
    def passed(self) -> bool:
        """Both directions must have run *and* found nothing wrong.

        A direction that checked zero cases has not passed, it has not run. The
        first draft of this returned True with ``forward_checked=0``, because
        none of the sampled rates happened to solve the CICO problem and the
        forward direction was therefore never exercised -- a vacuous pass, and
        exactly the shape of failure this test exists to prevent elsewhere.
        """
        return (
            self.forward_checked > 0
            and self.reverse_checked > 0
            and not self.forward_failures
            and not self.reverse_failures
        )

    @property
    def vacuous(self) -> tuple[str, ...]:
        """Which directions did not run at all."""
        empty = []
        if not self.forward_checked:
            empty.append("forward")
        if not self.reverse_checked:
            empty.append("reverse")
        return tuple(empty)

    def render(self) -> str:
        lines = [
            f"roundtrip {self.system_render} passed={self.passed}",
            f"  forward checked={self.forward_checked} failures={len(self.forward_failures)}",
            f"  reverse checked={self.reverse_checked} failures={len(self.reverse_failures)}",
        ]
        if self.vacuous:
            lines.append(
                f"  VACUOUS: {list(self.vacuous)} ran zero cases, so nothing was checked"
            )
        for failure in (*self.forward_failures[:3], *self.reverse_failures[:3]):
            lines.append(f"  failure={failure}")
        return "\n".join(lines)


def check_reverse(system: PolynomialSystem, rates: list[list[int]]) -> tuple[int, list[str]]:
    """Every stated rate must be accepted by the model with zero residuals."""
    failures: list[str] = []
    for rate in rates:
        assignment = assignment_from_rate(system, rate)
        # The model's CICO output equations only vanish when the rate actually
        # solves the problem, so those are checked separately from the S-box
        # equations, which must vanish for *every* input.
        problem = CicoProblem(spec=system.spec, rounds=system.rounds)
        satisfied, residuals = evaluate_system(system, assignment)
        sbox_count = len(residuals) - system.spec.capacity
        sbox_ok = all(r == 0 for r in residuals[:sbox_count])
        if not sbox_ok:
            failures.append(
                f"rate={rate} left non-zero S-box residuals {residuals[:sbox_count]}: "
                "the model does not accept a trace the reference produced"
            )
            continue
        cico_ok = all(r == 0 for r in residuals[sbox_count:])
        if cico_ok != problem.holds(rate):
            failures.append(
                f"rate={rate}: model says CICO {'holds' if cico_ok else 'fails'}, "
                f"reference says {'holds' if problem.holds(rate) else 'fails'}"
            )
    return len(rates), failures


def check_forward(
    system: PolynomialSystem, assignments: list[dict[str, int]]
) -> tuple[int, list[str]]:
    """Every model solution must solve the CICO problem per the reference."""
    problem = CicoProblem(spec=system.spec, rounds=system.rounds)
    failures: list[str] = []
    for assignment in assignments:
        satisfied, residuals = evaluate_system(system, assignment)
        if not satisfied:
            failures.append(
                f"assignment does not satisfy the model it came from: residuals {residuals}"
            )
            continue
        rate = decode_solution(system, assignment)
        if not problem.holds(rate):
            failures.append(
                f"model solution rate={rate} does not solve the CICO problem "
                "according to the reference implementation"
            )
    return len(assignments), failures


def round_trip(
    system: PolynomialSystem,
    sample_rates: list[list[int]] | None = None,
    model_solutions: list[dict[str, int]] | None = None,
) -> RoundTripReport:
    """Run both directions.

    ``sample_rates`` defaults to a deterministic spread across the rate space,
    including the all-zero and all-ones corners, so the reverse direction is
    exercised on inputs that do *not* solve the CICO problem as well as any
    that do -- an over-constrained model is caught by the former.
    """
    spec = system.spec
    if sample_rates is None:
        p = spec.prime
        corners = [[0] * spec.rate, [1] * spec.rate, [(p - 1)] * spec.rate]
        spread = [
            [(7 * (i + 1) + 13 * j) % p for j in range(spec.rate)] for i in range(5)
        ]
        sample_rates = corners + spread

    reverse_checked, reverse_failures = check_reverse(system, sample_rates)

    if model_solutions is None:
        # The forward direction needs rates that genuinely solve the problem,
        # and a sampled spread almost never contains one -- p^capacity of the
        # rate space solves it, which at p=101 is one in 101. So search for
        # them, exhaustively where the space allows.
        problem = CicoProblem(spec=spec, rounds=system.rounds)
        solving_rates = [rate for rate in sample_rates if problem.holds(rate)]
        if not solving_rates:
            solving_rates = _find_solving_rates(problem, wanted=3)
        model_solutions = [
            assignment_from_rate(system, rate) for rate in solving_rates
        ]

    forward_checked, forward_failures = check_forward(system, model_solutions)

    return RoundTripReport(
        system_render=system.render(),
        forward_checked=forward_checked,
        forward_failures=tuple(forward_failures),
        reverse_checked=reverse_checked,
        reverse_failures=tuple(reverse_failures),
    )


def _find_solving_rates(
    problem: CicoProblem, wanted: int = 3, budget: int = 2_000_000
) -> list[list[int]]:
    """Rates that solve the CICO problem, found by direct search.

    Used only to *supply the forward round-trip test with material*, never as
    an attack: the search is over the whole rate space and costs exactly what
    generic costs. Raises rather than returning an empty list, because an empty
    list would make the forward direction vacuous and that is the failure this
    function exists to remove.
    """
    spec = problem.spec
    total = spec.prime**spec.rate
    found: list[list[int]] = []
    for encoded in range(min(total, budget)):
        rate, rest = [], encoded
        for _ in range(spec.rate):
            rate.append(rest % spec.prime)
            rest //= spec.prime
        if problem.holds(rate):
            found.append(rate)
            if len(found) >= wanted:
                return found
    if not found:
        raise RoundTripFailure(
            f"no rate in {min(total, budget)} candidates solves {problem.render()}, "
            "so the forward direction cannot be exercised. Either the problem is "
            "unsatisfiable -- which would itself be a finding -- or the search "
            "budget is too small."
        )
    return found
