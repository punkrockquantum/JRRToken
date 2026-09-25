"""L3 — the experiment driver: parameter ladders and the model comparison.

You cannot solve the full parameter set. That is the premise, not a limitation.
So: run a **ladder** of round counts, measure the observable at each rung, and
compare it against a stated prediction. Where the measurement falls *below* the
prediction, the system is easier than the algebraic bound suggests, and that gap
is what an attack is made of.

The prediction. For a CICO system with one free variable, each round applies the
S-box to the element carrying that variable, so the degree of the eliminated
univariate polynomial multiplies by ``d`` per round and the ideal's degree
should be ``d ** rounds``. That is a Bézout-style upper bound, and it is what
``vdim`` is measured against.

**Tier discipline, carried over from algebraic-probe and load-bearing here.**

  * each solved rung is **Tier E** -- exact, complete, reproducible, and the
    solver reports it;
  * the fitted growth is **a model**, never a measurement, and is labelled so;
  * two competing growth models are required, and the round count at which
    they diverge is the stated boundary of what the experiment supports.

The wall is data. "Rounds 1..7 solved exactly; round 8 exceeded the budget at
degree 14" is a checkable, publishable statement, and it is what most cells
produce. ``Rung.status`` keeps that distinct from "no solution exists", because
folding a resource limit into a security claim is the worst error available
here.
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from compile_polysys import compile_cico
from reference import CicoProblem, brute_force_solutions, validate
from roundtrip import round_trip
from solvers import (
    NO_SOLUTION,
    POSITIVE_DIM,
    SOLVED,
    WALL,
    Corroboration,
    contending_solvers,
    corroborate,
)
from spec import Spec

#: Rate assignments brute force will enumerate to cross-check a rung. Above
#: this the cross-check is skipped and said to be skipped.
BRUTE_FORCE_LIMIT = 200_000


@dataclass(frozen=True, slots=True)
class Rung:
    """One round count, measured."""

    rounds: int
    n_variables: int
    n_equations: int
    status: str
    seconds: float
    peak_memory_mb: float
    #: Solutions over the algebraic closure, with multiplicity (Singular vdim).
    ideal_degree: int | None
    max_degree: int | None
    basis_size: int | None
    matrix_cells: int | None
    #: The Bezout-style prediction, d ** rounds.
    predicted_degree: int
    #: F_p-rational solutions, where brute force was affordable.
    rational_solutions: int | None
    solvers_agree: bool
    detail: str = ""

    @property
    def tier(self) -> str:
        """E only for a rung that produced its observable.

        A decisive status is necessary and not sufficient: the measurement is
        the ideal degree, and a rung without one has not measured anything.
        ``NO_SOLUTION`` is the exception -- an empty variety has degree 0 and
        that *is* the observable.
        """
        if self.status == NO_SOLUTION:
            return "E"
        if self.status in {SOLVED, POSITIVE_DIM} and self.ideal_degree is not None:
            return "E"
        return "-"

    @property
    def degree_deficit(self) -> int | None:
        """``predicted - measured``. Positive means the system is *easier* than
        the algebraic bound, which is the direction an attack lives in."""
        if self.ideal_degree is None:
            return None
        return self.predicted_degree - self.ideal_degree

    @property
    def matches_prediction(self) -> bool | None:
        if self.ideal_degree is None:
            return None
        return self.ideal_degree == self.predicted_degree

    @property
    def sanity_holds(self) -> bool | None:
        """vdim must be at least the number of F_p-rational solutions."""
        if self.ideal_degree is None or self.rational_solutions is None:
            return None
        return self.ideal_degree >= self.rational_solutions

    def render(self) -> str:
        parts = [
            f"rounds={self.rounds}",
            f"tier={self.tier}",
            f"status={self.status}",
            f"vars={self.n_variables}",
            f"eqs={self.n_equations}",
            f"ideal_degree={self.ideal_degree}",
            f"predicted={self.predicted_degree}",
            f"deficit={self.degree_deficit}",
            f"max_degree={self.max_degree}",
            f"basis={self.basis_size}",
            f"seconds={self.seconds:.3f}",
            f"peak_mb={self.peak_memory_mb:.1f}",
            f"agree={self.solvers_agree}",
        ]
        if self.rational_solutions is not None:
            parts.append(f"Fp_solutions={self.rational_solutions}")
            parts.append(f"sanity={self.sanity_holds}")
        return " ".join(parts)


@dataclass(frozen=True, slots=True)
class Ladder:
    """A full ladder over one specification, with its models."""

    spec_render: str
    spec_digest: str
    problem_render: str
    rungs: tuple[Rung, ...]
    validation_passed: bool
    roundtrip_passed: bool
    wall_at: int | None
    planted: bool = True
    #: Any rung measured while another solver was running. Timings from a
    #: contended window measure scheduling, not mathematics, so the cost gate
    #: must not rest on them.
    contended_rounds: tuple[int, ...] = field(default=())
    solver_versions: tuple[str, ...] = field(default=())

    @property
    def solved_rungs(self) -> tuple[Rung, ...]:
        return tuple(r for r in self.rungs if r.tier == "E")

    @property
    def deviations(self) -> tuple[Rung, ...]:
        """Rungs whose measured degree fell below the prediction."""
        return tuple(
            r for r in self.solved_rungs
            if r.degree_deficit is not None and r.degree_deficit > 0
        )

    @property
    def sanity_failures(self) -> tuple[Rung, ...]:
        return tuple(r for r in self.solved_rungs if r.sanity_holds is False)

    @property
    def disagreements(self) -> tuple[Rung, ...]:
        return tuple(r for r in self.rungs if not r.solvers_agree)

    def growth_models(self) -> dict[str, dict[str, float]]:
        """Two competing models for how the ideal degree grows, both reported.

        ``exponential``: log(degree) linear in rounds -- the Bezout expectation.
        ``polynomial``:  log(degree) linear in log(rounds) -- what a system with
                         substantial degree collapse would look like.

        Both are fitted by least squares on the solved rungs, and each carries
        its residual so the reader can see which fits and by how much. Neither
        is a measurement; the ``tier`` field on every rung says which parts are.
        """
        points = [
            (r.rounds, r.ideal_degree)
            for r in self.solved_rungs
            if r.ideal_degree and r.ideal_degree > 0 and r.rounds > 0
        ]
        models: dict[str, dict[str, float]] = {}
        if len(points) < 3:
            return models

        def fit(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
            n = len(xs)
            mx, my = sum(xs) / n, sum(ys) / n
            sxx = sum((x - mx) ** 2 for x in xs)
            if sxx == 0:
                return 0.0, my, float("inf")
            slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
            intercept = my - slope * mx
            residual = math.sqrt(
                sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys)) / n
            )
            return slope, intercept, residual

        rounds = [float(r) for r, _ in points]
        log_degree = [math.log2(d) for _, d in points]
        slope, intercept, residual = fit(rounds, log_degree)
        models["exponential"] = {
            "log2_degree_per_round": slope,
            "intercept": intercept,
            "rms_residual_bits": residual,
        }

        log_rounds = [math.log2(r) for r, _ in points]
        slope2, intercept2, residual2 = fit(log_rounds, log_degree)
        models["polynomial"] = {
            "log2_degree_per_log2_round": slope2,
            "intercept": intercept2,
            "rms_residual_bits": residual2,
        }
        return models

    def divergence_round(self, limit: int = 128) -> int | None:
        """Where the two growth models disagree by more than one bit.

        The honest boundary of what the ladder supports: beyond this round
        count, which model you believe changes the answer, and the experiment
        does not say which to believe.
        """
        models = self.growth_models()
        if len(models) < 2:
            return None
        e, p = models["exponential"], models["polynomial"]
        for r in range(2, limit + 1):
            exp_bits = e["log2_degree_per_round"] * r + e["intercept"]
            poly_bits = p["log2_degree_per_log2_round"] * math.log2(r) + p["intercept"]
            if abs(exp_bits - poly_bits) > 1.0:
                return r
        return None

    def render(self) -> str:
        lines = [
            f"ladder {self.spec_render}",
            f"  {self.problem_render}",
            f"  validation_passed={self.validation_passed} "
            f"roundtrip_passed={self.roundtrip_passed} planted={self.planted}",
            f"  solvers={list(self.solver_versions)}",
        ]
        for rung in self.rungs:
            lines.append("  " + rung.render())
        lines.append(
            f"  contended_rounds={list(self.contended_rounds)} "
            f"solved_rungs={len(self.solved_rungs)}/{len(self.rungs)} "
            f"wall_at={self.wall_at} "
            f"deviations={[r.rounds for r in self.deviations]} "
            f"sanity_failures={[r.rounds for r in self.sanity_failures]} "
            f"disagreements={[r.rounds for r in self.disagreements]}"
        )
        models = self.growth_models()
        if models:
            for name, params in models.items():
                rendered = " ".join(f"{k}={v:.6g}" for k, v in params.items())
                lines.append(f"  model={name} {rendered} tier=MODEL-not-a-measurement")
            lines.append(f"  models_diverge_beyond_round={self.divergence_round()}")
        else:
            lines.append(
                "  models=none: fewer than three solved rungs, so no growth "
                "claim is made"
            )
        lines.append(
            "  scope=instances are PLANTED: the output target is what the "
            "reference produced at a known witness, so a solution exists by "
            "construction. That measures solver difficulty on a system of this "
            "shape and is not evidence about the zero-target instance. "
            if self.planted else "  scope="
            "Solved rungs are Tier E and reproducible; the fitted models are "
            "models. A deviation below the prediction is a lead, not an attack: "
            "L4 must verify a candidate against the reference implementation "
            "and the cost gate before the word attack applies."
        )
        return "\n".join(lines)

    def to_json(self) -> str:
        payload = {
            "spec": self.spec_render,
            "spec_digest": self.spec_digest,
            "problem": self.problem_render,
            "validation_passed": self.validation_passed,
            "roundtrip_passed": self.roundtrip_passed,
            "wall_at": self.wall_at,
            "solver_versions": list(self.solver_versions),
            "rungs": [asdict(r) for r in self.rungs],
            "growth_models": self.growth_models(),
            "models_diverge_beyond_round": self.divergence_round(),
        }
        return json.dumps(payload, indent=2, sort_keys=True)


class LadderRefused(Exception):
    """The ladder cannot be run as stated."""


def run_ladder(
    spec: Spec,
    max_rounds: int | None = None,
    timeout: float = 300.0,
    brute_force_limit: int = BRUTE_FORCE_LIMIT,
    planted: bool = True,
) -> Ladder:
    """Run the ladder, stopping at the first wall.

    L0 validation and the L1 round-trip run **before** any solver is invoked. A
    ladder built on an unvalidated implementation or an unchecked model measures
    a different cipher, and there is no point spending solver time on that.
    """
    report = validate(spec)
    if not report.passed:
        raise LadderRefused(
            f"L0 validation failed for {spec.name}; no ladder is run on an "
            f"unvalidated implementation:\n{report.render()}"
        )

    limit = spec.rounds if max_rounds is None else min(max_rounds, spec.rounds)

    # Planted by default. The zero-target instance often has no F_p-rational
    # solution at all, and at a cryptographic prime whether it does is exactly
    # the question the solver is being asked -- so the forward round-trip
    # cannot be supplied with material by search. A planted instance differs
    # only in a constant term, so the monomial structure, variable count and
    # degree profile are identical; every rung records planted so no report can
    # blur that into a claim about the zero-target instance.
    def problem_at(r: int) -> CicoProblem:
        if planted:
            return CicoProblem.planted(spec, rounds=r)
        return CicoProblem(spec=spec, rounds=r)

    first = problem_at(1)
    if not first.is_zero_dimensional:
        raise LadderRefused(
            f"{first.render()}: free variables do not match constraints, so the "
            "system is under-constrained and its solution set is a positive-"
            "dimensional family. Set free_rate = capacity."
        )

    rungs: list[Rung] = []
    wall_at: int | None = None
    versions: set[str] = set()
    roundtrip_ok = True
    contended: list[int] = []

    for rounds in range(1, limit + 1):
        problem = problem_at(rounds)
        system = compile_cico(problem)

        trip = round_trip(system)
        if not trip.passed:
            roundtrip_ok = False
            raise LadderRefused(
                f"L1 round-trip failed at rounds={rounds}; the model and the "
                f"reference disagree and no measurement is meaningful:\n{trip.render()}"
            )

        # Exclusivity, checked per rung rather than once: a competing solver
        # can start at any point during a long ladder.
        before = contending_solvers()
        corroboration: Corroboration = corroborate(system, timeout=timeout)
        if before or contending_solvers():
            contended.append(rounds)
        versions.add(f"{corroboration.primary.solver}/{corroboration.primary.version}")
        versions.add(f"{corroboration.secondary.solver}/{corroboration.secondary.version}")

        rational: int | None = None
        try:
            rational = len(brute_force_solutions(problem, limit=brute_force_limit))
        except Exception:
            # Brute force is only affordable at small primes. Its absence is
            # recorded as None rather than as zero, because zero would read as
            # "no solutions exist" -- the opposite of "not checked".
            rational = None

        # The ideal degree comes from Singular's vdim; msolve does not expose
        # it. So a rung where Singular walled has produced no measurement, and
        # calling it "solved" because msolve finished would report a wall as a
        # result. An earlier version did exactly that: rungs 7 and 8 showed
        # status=solved with ideal_degree=None and seconds equal to the timeout.
        secondary = corroboration.secondary
        primary = corroboration.primary
        if primary.status == WALL or secondary.status == WALL:
            status = WALL
        elif primary.status == "error":
            status = secondary.status
        else:
            status = primary.status

        rung = Rung(
            rounds=rounds,
            n_variables=system.n_variables,
            n_equations=system.n_equations,
            status=status,
            seconds=primary.seconds + secondary.seconds,
            peak_memory_mb=max(primary.peak_memory_mb, secondary.peak_memory_mb),
            ideal_degree=secondary.solution_count,
            max_degree=secondary.max_degree,
            basis_size=secondary.basis_size,
            matrix_cells=primary.matrix_cells,
            predicted_degree=spec.sbox_exponent**rounds,
            rational_solutions=rational,
            solvers_agree=corroboration.agree,
            detail=f"{primary.detail} | {secondary.detail}",
        )
        rungs.append(rung)

        if rung.status == WALL:
            wall_at = rounds
            break

    return Ladder(
        spec_render=spec.render(),
        spec_digest=spec.digest(),
        problem_render=problem_at(1).render(),
        planted=planted,
        rungs=tuple(rungs),
        validation_passed=report.passed,
        roundtrip_passed=roundtrip_ok,
        wall_at=wall_at,
        solver_versions=tuple(sorted(versions)),
        contended_rounds=tuple(contended),
    )


def save(ladder: Ladder, directory: str | Path) -> Path:
    """Write the ladder as JSON, named by the spec digest so a result names its
    input and a re-run overwrites nothing it did not produce."""
    out = Path(directory)
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"ladder-{ladder.spec_digest}-{int(time.time())}.json"
    path.write_text(ladder.to_json(), encoding="utf-8")
    return path
