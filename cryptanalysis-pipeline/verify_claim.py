"""L4 — claim verification: what earns the word *attack*.

Nothing reaches this layer as an attack. Things reach it as candidates, and most
leave as structure.

Three gates, and all three must pass:

  **recovery**     a candidate solution is executed against ``reference.py``.
                   Not against the model, not against a decoder -- against the
                   implementation that reproduces the primitive. A candidate
                   that fails here is a bug in the pipeline, and saying so is
                   the whole point of the gate.

  **cost**         the measured cost is compared against the generic baseline
                   *in the same attack model*. A solve that costs more than
                   generic is structure, not an attack. This is the gate that
                   most candidates fail, and it should be.

  **scope**        a planted instance cannot support a claim about the
                   zero-target instance; a fitted model cannot support a claim
                   beyond the rungs that were solved. Stated as a refusal
                   rather than a caveat, because a caveat at the bottom of a
                   report is not a gate.

The asymmetry is deliberate. Passing all three does not make a result
publishable -- it makes it eligible. Failing any one makes the word *attack*
unavailable, and ``Verdict.word`` returns what may be said instead.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from ladder import Ladder, Rung
from reference import CicoProblem, permute
from spec import Spec

#: Trials timed when calibrating the generic baseline. Enough to average out
#: scheduling noise, few enough to cost nothing.
GENERIC_CALIBRATION_TRIALS = 2000


def measure_generic_seconds_per_trial(problem: CicoProblem) -> float:
    """Time one generic trial *on this machine*, by running it.

    The first version of the cost gate converted solver seconds into trial
    counts through an invented constant, and that constant was doing all the
    work in the comparison -- the gate's verdict was a property of a number
    nobody had measured.

    This runs the reference implementation the way a generic attacker would,
    on the same hardware in the same process, so the comparison becomes seconds
    against seconds with no conversion. A generic trial is: pick a free value,
    evaluate the permutation, check the capacity output.
    """
    import time

    spec = problem.spec
    trials = GENERIC_CALIBRATION_TRIALS
    start = time.perf_counter()
    for i in range(trials):
        free = [(i * 2654435761) % spec.prime for _ in range(problem.n_free)]
        problem.holds(free)
    elapsed = time.perf_counter() - start
    return elapsed / trials


@dataclass(frozen=True, slots=True)
class Candidate:
    """A proposed solution, before anything has been checked about it."""

    problem: CicoProblem
    free_values: tuple[int, ...]
    provenance: str

    def render(self) -> str:
        return (
            f"candidate free={list(self.free_values)} "
            f"provenance={self.provenance} {self.problem.render()}"
        )


@dataclass(frozen=True, slots=True)
class Verdict:
    """The outcome of the three gates, and what may be said."""

    recovery_passed: bool
    recovery_detail: str
    cost_passed: bool
    cost_detail: str
    scope_passed: bool
    scope_detail: str
    measured_cost_log2: float | None
    generic_cost_log2: float

    @property
    def all_passed(self) -> bool:
        return self.recovery_passed and self.cost_passed and self.scope_passed

    @property
    def word(self) -> str:
        """What this result may be called.

        Deliberately not a boolean. The failure modes are different and the
        honest description differs with them.
        """
        if not self.recovery_passed:
            return "pipeline-defect"
        if not self.scope_passed:
            return "out-of-scope"
        if not self.cost_passed:
            return "structure"
        return "eligible-attack-candidate"

    def render(self) -> str:
        lines = [
            f"verdict word={self.word} all_passed={self.all_passed}",
            f"  recovery passed={self.recovery_passed} {self.recovery_detail}",
            f"  cost     passed={self.cost_passed} {self.cost_detail}",
            f"  scope    passed={self.scope_passed} {self.scope_detail}",
        ]
        if self.measured_cost_log2 is not None:
            lines.append(
                f"  solver_seconds_log2={self.measured_cost_log2:.2f} "
                f"generic_trials_log2={self.generic_cost_log2:.2f}"
            )
        lines.append(
            "  note=eligible-attack-candidate means the three gates passed, "
            "not that the result is publishable. It means the word attack is "
            "available and the claim now needs an independent reader."
        )
        return "\n".join(lines)


def check_recovery(candidate: Candidate) -> tuple[bool, str]:
    """Execute the candidate against the reference implementation.

    The candidate's own problem object states what the output must be, so this
    is a check against the primitive rather than against the model that
    proposed the candidate.
    """
    problem = candidate.problem
    free = list(candidate.free_values)
    if len(free) != problem.n_free:
        return False, f"candidate has {len(free)} values, problem has {problem.n_free} free"
    state = problem.input_from_rate(free)
    out = permute(state, problem.spec, problem.rounds)
    want = problem.required_output
    got = tuple(out[i] for i in range(problem.spec.capacity))
    if got != want:
        return False, (
            f"reference gives capacity output {got}, problem requires {want}: "
            "the candidate does not solve the problem it claims to"
        )
    return True, f"reference confirms capacity output {got} at rounds={problem.rounds}"


def check_cost(
    ladder: Ladder, rung: Rung, problem: CicoProblem
) -> tuple[bool, str, float | None]:
    """Compare measured solve cost against the generic baseline.

    The measured cost is the solver's wall-clock converted into generic-trial
    equivalents, which is a **modelling choice** and is labelled as one:
    comparing seconds to field operations requires a conversion, and
    ``SECONDS_PER_GENERIC_TRIAL`` is where it lives. The comparison is
    nonetheless the right shape -- a solve that takes longer than trying every
    input is not an attack however elegant the algebra.
    """
    if rung.tier != "E":
        return False, f"rung at rounds={rung.rounds} produced no measurement", None

    # Seconds against seconds, both on this machine. The generic attacker's
    # total time is (trials needed) * (seconds per trial), and the trials
    # needed is p^capacity.
    per_trial = measure_generic_seconds_per_trial(problem)
    generic_seconds_log2 = problem.generic_cost_log2 + math.log2(per_trial)
    solver_seconds_log2 = math.log2(max(rung.seconds, 1e-9))

    measured = solver_seconds_log2
    generic = generic_seconds_log2
    shared = (
        f"solver {rung.seconds:.3f}s (2^{measured:.2f}s) vs generic "
        f"2^{problem.generic_cost_log2:.0f} trials at {per_trial * 1e6:.3f}us "
        f"= 2^{generic:.2f}s, both timed on this machine"
    )
    if measured >= generic:
        return False, f"{shared}: at or above generic, so this is structure", measured
    return True, f"{shared}: below generic", measured


def check_scope(ladder: Ladder, rung: Rung, spec: Spec) -> tuple[bool, str]:
    """Refuse claims the experiment does not support.

    Two refusals, both structural rather than stylistic:

    * A **planted** instance says nothing about the zero-target instance, so a
      claim about the primitive's CICO hardness cannot rest on one.
    * A rung **beyond the solved ladder** rests on a fitted model, and the two
      models diverge; past that round count the experiment does not say which
      to believe.
    """
    reasons = []
    if rung.rounds in ladder.contended_rounds:
        reasons.append(
            f"rounds={rung.rounds} was measured while another solver was "
            "running, so its wall-clock reflects scheduling and the cost "
            "comparison cannot rest on it"
        )
    if ladder.planted:
        reasons.append(
            "the instance is planted, so a solution existed by construction; "
            "this measures solver difficulty on a system of this shape and is "
            "not evidence about the zero-target CICO problem"
        )
    if rung.rounds > len(ladder.solved_rungs):
        reasons.append(
            f"rounds={rung.rounds} is beyond the {len(ladder.solved_rungs)} "
            "solved rungs, so any statement about it rests on a fitted model"
        )
    divergence = ladder.divergence_round()
    if divergence is not None and rung.rounds >= divergence:
        reasons.append(
            f"the two growth models diverge by more than a bit from round "
            f"{divergence}, so the experiment does not choose between them here"
        )
    if reasons:
        return False, "; ".join(reasons)
    return True, (
        f"rounds={rung.rounds} is within the solved ladder and the instance is "
        "not planted"
    )


def verify(candidate: Candidate, ladder: Ladder, rung: Rung) -> Verdict:
    """Run all three gates."""
    recovery_ok, recovery_detail = check_recovery(candidate)
    cost_ok, cost_detail, measured = check_cost(ladder, rung, candidate.problem)
    scope_ok, scope_detail = check_scope(ladder, rung, candidate.problem.spec)
    return Verdict(
        recovery_passed=recovery_ok,
        recovery_detail=recovery_detail,
        cost_passed=cost_ok,
        cost_detail=cost_detail,
        scope_passed=scope_ok,
        scope_detail=scope_detail,
        measured_cost_log2=measured,
        generic_cost_log2=candidate.problem.generic_cost_log2,
    )
