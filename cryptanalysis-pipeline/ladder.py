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
from compile_state import compile_cico_state
from provenance import (
    MODEL,
    PreRegistration,
    ResultLog,
    Tier,
    assert_all_exhausted,
    mint_record,
    tier_of_rung,
)
from reference import (
    CicoProblem,
    brute_force_solutions,
    predicted_ideal_degree,
    validate,
)
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
    #: Top degree of the finished Gröbner basis, from Singular. Not the
    #: solving degree, though it was labelled as if it were.
    max_degree: int | None
    basis_size: int | None
    #: Largest matrix the declared-order F4 computation reduced, in cells.
    matrix_cells: int | None
    #: The Bezout-style prediction, derived from the round structure by
    #: ``reference.predicted_ideal_degree``. Equal to ``d ** rounds`` whenever
    #: the free variable reaches an S-box in round 1, and lower by a factor of
    #: ``d`` per leading partial round when it does not.
    predicted_degree: int
    #: F_p-rational solutions, where brute force was affordable.
    rational_solutions: int | None
    solvers_agree: bool
    detail: str = ""
    #: The highest degree F4 reduced at, from msolve's round table. This is the
    #: observable an AO degree-of-regularity conjecture is a claim about.
    solving_degree: int | None = None
    #: ``((degree, count), ...)`` -- where the algorithm met syzygies it did not
    #: predict. The lowest such degree is the operational proxy for the first
    #: fall degree.
    zero_reductions: tuple[tuple[int, int], ...] = ()
    #: How many F4 computations msolve ran. Above 1 means it permuted the
    #: variable order; every observable above comes from the first.
    f4_blocks: int = 0

    @property
    def tier_label(self) -> Tier | None:
        """The tier, decided in L5 so the rule has one definition.

        ``None`` means this rung measured nothing, which is a legitimate
        outcome: a decisive status is necessary and not sufficient, because the
        observable is the ideal degree and a rung without one has not measured
        anything. ``NO_SOLUTION`` is the exception -- an empty variety has
        degree 0 and that *is* the observable.
        """
        return tier_of_rung(self.status, self.ideal_degree, no_solution=NO_SOLUTION)

    @property
    def tier(self) -> str:
        """The label as it is printed: ``E``, or ``-`` for no measurement."""
        label = self.tier_label
        return "-" if label is None else str(label)

    @property
    def first_zero_reduction_degree(self) -> int | None:
        """The lowest degree at which F4 met a syzygy it did not predict.

        Reported rather than interpreted. For a semi-regular system the degree
        where zero reductions begin is the degree of regularity; for a system
        with hidden structure they begin earlier, and that gap is what an
        algebraic attack on an AO primitive is built out of. Whether *this*
        system's value means either thing is not decided here -- see PREREG-003.
        """
        if not self.zero_reductions:
            return None
        return min(degree for degree, _ in self.zero_reductions)

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
            f"solving_degree={self.solving_degree}",
            f"first_zero_reduction_at={self.first_zero_reduction_degree}",
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
    #: Which model compiler produced the systems measured here.
    encoding: str = "sbox"
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
        # A regression guard, and stated as one: today it cannot fire, because
        # ``solved_rungs`` filters on the same predicate it checks. It exists so
        # that a later rung type -- a sampled solving degree, say -- cannot
        # reach the fit by widening that filter. The guard's own behaviour is
        # tested directly in L5's tests rather than through this call.
        assert_all_exhausted(
            [r.tier_label for r in self.solved_rungs], "the growth-model fit"
        )
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
            f"  encoding={self.encoding}",
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
                lines.append(f"  model={name} {rendered} tier={MODEL}")
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
        """The record as it is committed.

        ``planted`` and ``contended_rounds`` are in here because they were
        once not: the render printed both and the saved JSON dropped them, so
        the committed artefact -- the one a reader actually gets -- omitted the
        two facts that decide what the numbers beside them may be used for. A
        scope refusal that exists only in a terminal is not a refusal.
        """
        payload = {
            "spec": self.spec_render,
            "spec_digest": self.spec_digest,
            "problem": self.problem_render,
            "encoding": self.encoding,
            "planted": self.planted,
            "contended_rounds": list(self.contended_rounds),
            "validation_passed": self.validation_passed,
            "roundtrip_passed": self.roundtrip_passed,
            "wall_at": self.wall_at,
            "solver_versions": list(self.solver_versions),
            "rungs": [asdict(r) for r in self.rungs],
            "rung_tiers": {str(r.rounds): r.tier for r in self.rungs},
            "deviations": [r.rounds for r in self.deviations],
            "sanity_failures": [r.rounds for r in self.sanity_failures],
            "disagreements": [r.rounds for r in self.disagreements],
            "growth_models": self.growth_models(),
            "growth_model_tier": MODEL,
            "models_diverge_beyond_round": self.divergence_round(),
        }
        return json.dumps(payload, indent=2, sort_keys=True)

    # -- L5 --------------------------------------------------------------

    @property
    def record_kind(self) -> str:
        """What this ladder is, by the pre-registered criteria.

        Ordering matters: a deviation is the finding whether or not the ladder
        later hit a wall, and a wall is a result in its own right. Only a
        ladder that reached its prediction at every solved rung is a
        no-deviation record.
        """
        if self.deviations:
            return "deviation"
        if self.wall_at is not None:
            return "wall"
        return "no-deviation"

    def blindness(self) -> str:
        """What this ladder could not have seen. Assembled from its own facts.

        Required by L5 on every negative, and written from the run rather than
        from a template, because a template is a sentence a reader learns to
        skip.
        """
        highest = max((r.rounds for r in self.solved_rungs), default=0)
        parts = [
            f"rounds above {highest} were never closed, so nothing here "
            f"constrains them",
            "one monomial ordering (degrevlex) and one solver pair were tried, "
            "so a collapse visible only under a different ordering would not "
            "appear",
            "the observable is the ideal degree; an attack that does not "
            "proceed by degree collapse is outside what this measures",
        ]
        if self.planted:
            parts.append(
                "the instances are planted, so a solution existed by "
                "construction and the zero-target instance was never attempted"
            )
        if self.contended_rounds:
            parts.append(
                f"rounds {list(self.contended_rounds)} were measured while "
                "another solver was running, so their wall-clock reflects "
                "scheduling"
            )
        return "; ".join(parts)

    def to_record(self, prereg: PreRegistration) -> dict:
        """The log payload, minted through L5 so its refusals apply."""
        return mint_record(
            kind=self.record_kind,
            spec_digest=self.spec_digest,
            solver_versions=self.solver_versions,
            prereg_sha256=prereg.sha256,
            blindness=self.blindness(),
            payload={
                "prereg_id": prereg.prereg_id,
                "spec": self.spec_render,
                "problem": self.problem_render,
                "encoding": self.encoding,
                "planted": self.planted,
                "contended_rounds": list(self.contended_rounds),
                "wall_at": self.wall_at,
                "solved_rungs": len(self.solved_rungs),
                "highest_closed_round": max(
                    (r.rounds for r in self.solved_rungs), default=0
                ),
                "ideal_degrees": {
                    str(r.rounds): r.ideal_degree for r in self.solved_rungs
                },
                "predicted_degrees": {
                    str(r.rounds): r.predicted_degree for r in self.solved_rungs
                },
                "deviations": [r.rounds for r in self.deviations],
                "disagreements": [r.rounds for r in self.disagreements],
                "models_diverge_beyond_round": self.divergence_round(),
            },
        )


class LadderRefused(Exception):
    """The ladder cannot be run as stated."""


#: The model compilers a ladder may run against, by encoding name. A ladder
#: names which one it used, because two encodings of one cipher produce
#: different systems and a record that does not say which was measured cannot
#: be compared with anything.
COMPILERS = {"sbox": compile_cico, "state": compile_cico_state}


def run_ladder(
    spec: Spec,
    max_rounds: int | None = None,
    timeout: float = 300.0,
    brute_force_limit: int = BRUTE_FORCE_LIMIT,
    planted: bool = True,
    encoding: str = "sbox",
) -> Ladder:
    """Run the ladder, stopping at the first wall.

    L0 validation and the L1 round-trip run **before** any solver is invoked. A
    ladder built on an unvalidated implementation or an unchecked model measures
    a different cipher, and there is no point spending solver time on that.
    """
    if encoding not in COMPILERS:
        raise LadderRefused(
            f"unknown encoding {encoding!r}; known: {sorted(COMPILERS)}"
        )
    compile_for = COMPILERS[encoding]

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
        system = compile_for(problem)

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
            solving_degree=primary.solving_degree,
            zero_reductions=primary.zero_reductions,
            f4_blocks=primary.f4_blocks,
            predicted_degree=predicted_ideal_degree(problem, rounds),
            rational_solutions=rational,
            solvers_agree=corroboration.agree,
            detail=f"{primary.detail} | {secondary.detail}",
        )
        rungs.append(rung)

        if rung.status == WALL:
            wall_at = rounds
            break

    return Ladder(
        encoding=encoding,
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


def save(
    ladder: Ladder,
    directory: str | Path,
    prereg: PreRegistration | None = None,
) -> Path:
    """Write the ladder as JSON, named by the spec digest so a result names its
    input and a re-run overwrites nothing it did not produce.

    With a pre-registration, the run is also appended to the L5 hash chain at
    ``<directory>/log.jsonl`` and the pre-registration is checked against its
    committed blob first -- an uncommitted document cannot stamp a run. Without
    one, only the JSON is written and the chain is not touched, because a record
    naming no pre-registration is refused at mint time and a half-written chain
    is worse than none.

    A name collision raises rather than overwriting: results are append-only,
    and a second-resolution timestamp is not a guarantee of uniqueness.
    """
    out = Path(directory)
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"ladder-{ladder.spec_digest}-{int(time.time())}.json"
    if path.exists():
        raise LadderRefused(
            f"{path} already exists; results are append-only and this run will "
            "not overwrite one it did not produce"
        )
    path.write_text(ladder.to_json(), encoding="utf-8")
    if prereg is not None:
        prereg.assert_committed()
        ResultLog(out / "log.jsonl").append(ladder.to_record(prereg))
    return path
