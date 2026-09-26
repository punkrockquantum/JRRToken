"""The Poseidon widening — a sweep over the shapes PREREG-002 declares.

Two things this does that a loop over hardcoded parameters would not.

**The shapes come from the pre-registration.** ``shapes_from_prereg`` parses
the ``widths`` and ``shapes`` fields of the committed document. If the parse
fails it raises, and that is the intended behaviour: the document is committed
and immutable, so a phrasing its parser does not recognise means the code and
the pre-registration have diverged, and the run must stop rather than proceed
on a list that agrees with nothing. A pre-registration that the driver does not
read is decoration.

**The budget is honest about not finishing.** The full grid is 14 ladders of up
to 10 rounds, and the walls measured so far land past 900 seconds a rung, so
the pre-registered grid is tens of hours of solver time. A session cannot run
it. So the sweep takes a total wall budget, stops cleanly when it is spent, and
records **which cells ran and which were never attempted** -- because a sweep
that quietly covers a third of its grid and reports on the third is how a
negative result gets manufactured.

Exclusivity is enforced before the first ladder and re-checked per cell: the
cost gate's observable is wall-clock, and two solvers on one machine produce
two numbers about the scheduler.
"""

from __future__ import annotations

import argparse
import re
import time
from dataclasses import dataclass
from pathlib import Path

from ladder import Ladder, LadderRefused, run_ladder, save
from provenance import PreRegistration, ProvenanceRefused, load_prereg
from solvers import contending_solvers
from spec import Spec, SpecRefused, poseidon_like

#: Default pre-registration for this sweep.
PREREG_PATH = Path(__file__).resolve().parent / "prereg" / "PREREG-002-poseidon-shape-partial-rounds.md"


@dataclass(frozen=True, slots=True)
class Shape:
    """One cell of the grid: a width and a round split."""

    width: int
    rounds_full: int
    rounds_partial: int
    #: Set when the document states the split itself (``1f+1p+4f``). ``None``
    #: means ``poseidon_like``'s even split, which is how PREREG-002's grid is
    #: stated and how every record before PREREG-005 was made.
    rounds_full_first: int | None = None

    @property
    def first(self) -> int:
        return self.rounds_full // 2 if self.rounds_full_first is None else self.rounds_full_first

    @property
    def last(self) -> int:
        return self.rounds_full - self.first

    @property
    def leading_partial(self) -> bool:
        """Whether the first round is partial.

        ``poseidon_like`` splits full rounds as ``rounds_full // 2`` first, so
        an odd ``rounds_full`` of 1 puts zero full rounds at the front and the
        ladder opens on a partial round. That is the case the hardcoded ``d^r``
        prediction got wrong, which is why PREREG-002 names it explicitly
        rather than letting it appear as an accident of the grid.
        """
        return self.first == 0

    def label(self) -> str:
        if self.rounds_full_first is None:
            return f"t{self.width}-f{self.rounds_full}-p{self.rounds_partial}"
        return f"t{self.width}-{self.first}f{self.rounds_partial}p{self.last}f"


def spec_for(shape: Shape, prime: int) -> Spec:
    if shape.rounds_full_first is None:
        return poseidon_like(
            prime=prime,
            width=shape.width,
            rounds_full=shape.rounds_full,
            rounds_partial=shape.rounds_partial,
        )
    return Spec.create(
        name=f"poseidon-like-t{shape.width}",
        prime=prime,
        width=shape.width,
        rounds_full_first=shape.first,
        rounds_partial=shape.rounds_partial,
        rounds_full_last=shape.last,
        capacity=1,
    )


_SPLIT = re.compile(r"`(\d+)f\+(\d+)p\+(\d+)f`")


class SweepRefused(Exception):
    """The sweep cannot be run as pre-registered."""


def shapes_from_prereg(prereg: PreRegistration) -> tuple[Shape, ...]:
    """The grid, read out of the committed document.

    Deliberately strict. Every failure raises with the text it could not read,
    because the alternative -- falling back to a default grid -- would run a
    sweep the pre-registration does not describe while naming it in the log.
    """
    widths_text = prereg.fields.get("widths", "")
    widths = [int(n) for n in re.findall(r"\d+", widths_text)]
    if not widths:
        raise SweepRefused(
            f"the `widths` field names no integers: {widths_text!r}"
        )

    shapes_text = prereg.fields.get("shapes", "")
    splits = [(int(a), int(b), int(c)) for a, b, c in _SPLIT.findall(shapes_text)]
    if splits:
        # PREREG-005 states each split outright, because its shapes are not
        # the even split poseidon_like produces and a crossed grid cannot say so.
        grid = [
            Shape(width, first + last, partial, rounds_full_first=first)
            for width in widths
            for first, partial, last in splits
        ]
        return tuple(grid)

    full_set = re.search(r"`rounds_full`\s+in\s+\{([^}]*)\}", shapes_text)
    partial_set = re.search(r"`rounds_partial`\s+in\s+\{([^}]*)\}", shapes_text)
    if not full_set or not partial_set:
        raise SweepRefused(
            "the `shapes` field does not state a crossed grid in the form "
            "'`rounds_full` in {..} crossed with `rounds_partial` in {..}', "
            "nor any explicit split in the form '`1f+1p+4f`': "
            f"{shapes_text!r}"
        )
    fulls = [int(n) for n in re.findall(r"\d+", full_set.group(1))]
    partials = [int(n) for n in re.findall(r"\d+", partial_set.group(1))]
    if not fulls or not partials:
        raise SweepRefused(f"an empty set in the `shapes` field: {shapes_text!r}")

    extras: list[tuple[int, int]] = [
        (int(f), int(p))
        for f, p in re.findall(
            r"`rounds_full`\s*=\s*(\d+)\s+with\s+`rounds_partial`\s*=\s*(\d+)",
            shapes_text,
        )
    ]

    grid: list[Shape] = []
    for width in widths:
        for full in fulls:
            for partial in partials:
                grid.append(Shape(width, full, partial))
        for full, partial in extras:
            shape = Shape(width, full, partial)
            if shape not in grid:
                grid.append(shape)
    return tuple(grid)


@dataclass(frozen=True, slots=True)
class Cell:
    """One shape's outcome, including the outcome "never attempted"."""

    shape: Shape
    ran: bool
    reason: str = ""
    ladder: Ladder | None = None
    seconds: float = 0.0
    #: Set when the cell raised something the pipeline did not anticipate. Kept
    #: distinct from "not attempted", because a cell nobody got to and a cell
    #: that broke the pipeline are different facts and only one of them is a
    #: bug report.
    failed: bool = False

    def render(self) -> str:
        if self.failed:
            return f"cell {self.shape.label()} PIPELINE FAILURE: {self.reason}"
        if not self.ran:
            return f"cell {self.shape.label()} NOT ATTEMPTED: {self.reason}"
        assert self.ladder is not None
        closed = max((r.rounds for r in self.ladder.solved_rungs), default=0)
        return (
            f"cell {self.shape.label()} kind={self.ladder.record_kind} "
            f"closed_to_round={closed} wall_at={self.ladder.wall_at} "
            f"deviations={[r.rounds for r in self.ladder.deviations]} "
            f"seconds={self.seconds:.1f}"
        )


@dataclass(frozen=True, slots=True)
class SweepReport:
    prereg_id: str
    prereg_sha256: str
    prime: int
    cells: tuple[Cell, ...]
    budget_seconds: float
    seconds_used: float
    #: Which model compiler the cells were measured under. Two encodings of one
    #: cipher produce different systems, so a record that does not say which was
    #: measured cannot be compared with anything.
    encoding: str = "sbox"
    #: The per-rung and round limits actually used, and the pre-registered ones
    #: beside them. Carried because the docstring on ``run_sweep`` claimed a
    #: departure from the document was "recorded" while nothing recorded it --
    #: a claim the code did not keep, which is the failure this whole layer is
    #: built against.
    timeout_seconds: float = 0.0
    max_rounds: int = 0
    prereg_timeout_seconds: float = 0.0
    prereg_max_rounds: int = 0

    @property
    def as_pre_registered(self) -> bool:
        return (
            self.timeout_seconds == self.prereg_timeout_seconds
            and self.max_rounds == self.prereg_max_rounds
        )

    @property
    def attempted(self) -> tuple[Cell, ...]:
        return tuple(c for c in self.cells if c.ran)

    @property
    def unattempted(self) -> tuple[Cell, ...]:
        return tuple(c for c in self.cells if not c.ran and not c.failed)

    @property
    def failures(self) -> tuple[Cell, ...]:
        return tuple(c for c in self.cells if c.failed)

    @property
    def deviating(self) -> tuple[Cell, ...]:
        return tuple(
            c for c in self.attempted
            if c.ladder is not None and c.ladder.deviations
        )

    def render(self) -> str:
        lines = [
            f"sweep prereg={self.prereg_id} sha256={self.prereg_sha256[:16]} "
            f"prime={self.prime} encoding={self.encoding}",
            f"  budget={self.budget_seconds:.0f}s used={self.seconds_used:.0f}s "
            f"attempted={len(self.attempted)}/{len(self.cells)}",
            f"  per_rung_timeout={self.timeout_seconds:.0f}s "
            f"max_rounds={self.max_rounds} "
            f"as_pre_registered={self.as_pre_registered}",
        ]
        if not self.as_pre_registered:
            lines.append(
                f"  DEPARTURE: {self.prereg_id} fixes "
                f"timeout_seconds={self.prereg_timeout_seconds:.0f} and "
                f"max_rounds={self.prereg_max_rounds}; this ran at "
                f"{self.timeout_seconds:.0f} and {self.max_rounds}. A cell run "
                "at a different budget has a different wall and is not the "
                "pre-registered measurement."
            )
        for cell in self.cells:
            lines.append("  " + cell.render())
        lines.append(
            f"  deviating_cells={[c.shape.label() for c in self.deviating]}"
        )
        if self.failures:
            lines.append(
                f"  PIPELINE FAILURES: {len(self.failures)} cells raised. These "
                "are defects in this code, not properties of the primitive, and "
                "nothing about those cells is measured."
            )
        if self.unattempted:
            lines.append(
                f"  COVERAGE: {len(self.unattempted)} of {len(self.cells)} cells "
                "were never attempted. Nothing here is a statement about them, "
                "and the grid is not covered."
            )
        return "\n".join(lines)


def run_sweep(
    prime: int,
    prereg_path: str | Path = PREREG_PATH,
    budget_seconds: float = 3600.0,
    timeout: float | None = None,
    max_rounds: int | None = None,
    only: str = "",
    runs_dir: str | Path | None = None,
    encoding: str = "sbox",
) -> SweepReport:
    """Run as many pre-registered cells as the budget allows, in order.

    ``timeout`` and ``max_rounds`` default to the pre-registered values, and
    passing something else is allowed but recorded: a cell run at a smaller
    budget than the document fixed has a different wall, and the log must say
    so rather than presenting it as the pre-registered measurement.
    """
    prereg = load_prereg(prereg_path)
    prereg.assert_committed()
    per_rung = prereg.field_float("timeout_seconds") if timeout is None else timeout
    rounds_cap = prereg.field_int("max_rounds") if max_rounds is None else max_rounds

    running = contending_solvers()
    if running:
        raise SweepRefused(
            f"another solver is already running ({', '.join(running)}). The cost "
            "gate's observable is wall-clock, and two solvers on one machine "
            "produce two numbers about the scheduler. Wait for it to finish."
        )

    grid = shapes_from_prereg(prereg)
    if only:
        grid = tuple(s for s in grid if s.label() in {p.strip() for p in only.split(",")})
        if not grid:
            raise SweepRefused(f"--only={only!r} selected none of the grid")

    cells: list[Cell] = []
    started = time.perf_counter()
    for shape in grid:
        elapsed = time.perf_counter() - started
        if elapsed >= budget_seconds:
            cells.append(
                Cell(shape, ran=False, reason=f"budget of {budget_seconds:.0f}s spent")
            )
            continue
        try:
            spec = spec_for(shape, prime)
        except (SpecRefused, ValueError) as exc:
            cells.append(Cell(shape, ran=False, reason=f"spec refused: {exc}"))
            continue

        cell_started = time.perf_counter()
        try:
            ladder = run_ladder(
                spec,
                max_rounds=min(rounds_cap, spec.rounds),
                timeout=per_rung,
                encoding=encoding,
            )
        except LadderRefused as exc:
            cells.append(
                Cell(shape, ran=False, reason=f"ladder refused: {exc}",
                     seconds=time.perf_counter() - cell_started)
            )
            continue
        except Exception as exc:  # noqa: BLE001 - deliberate; see below
            # An unanticipated exception in one cell used to kill the sweep, and
            # with it the coverage accounting that is the sweep's whole purpose:
            # the first width-3 cell raised in the round-trip test and the run
            # died with seven cells measured, seven never attempted, and no
            # report saying so. Catching it here is not swallowing it -- the
            # cell is recorded as a PIPELINE FAILURE, which is louder in the
            # report than a traceback in a log file, and the remaining grid
            # still runs.
            cells.append(
                Cell(shape, ran=False, failed=True,
                     reason=f"{type(exc).__name__}: {exc}",
                     seconds=time.perf_counter() - cell_started)
            )
            continue
        took = time.perf_counter() - cell_started
        if runs_dir is not None:
            try:
                save(ladder, runs_dir, prereg=prereg)
            except ProvenanceRefused as exc:
                # A record that cannot be minted must not be quietly dropped:
                # the cell ran, so the sweep says so and says why nothing was
                # logged for it.
                cells.append(
                    Cell(shape, ran=True, ladder=ladder, seconds=took,
                         reason=f"not logged: {exc}")
                )
                continue
        cells.append(Cell(shape, ran=True, ladder=ladder, seconds=took))

    return SweepReport(
        prereg_id=prereg.prereg_id,
        prereg_sha256=prereg.sha256,
        prime=prime,
        encoding=encoding,
        cells=tuple(cells),
        budget_seconds=budget_seconds,
        seconds_used=time.perf_counter() - started,
        timeout_seconds=per_rung,
        max_rounds=rounds_cap,
        prereg_timeout_seconds=prereg.field_float("timeout_seconds"),
        prereg_max_rounds=prereg.field_int("max_rounds"),
    )


def preview(prereg_path: str | Path = PREREG_PATH) -> str:
    """The grid, without constructing a solver or a spec.

    A real preview: it builds nothing and runs nothing, so it cannot leave a
    partial artefact behind. The sibling project shipped a ``--preview`` that
    constructed its runner and wrote a log, which made the flag worse than
    useless -- it produced a second, non-compliant record.
    """
    prereg = load_prereg(prereg_path)
    grid = shapes_from_prereg(prereg)
    lines = [
        f"preview prereg={prereg.prereg_id} sha256={prereg.sha256[:16]}",
        f"  timeout_seconds={prereg.fields['timeout_seconds']} "
        f"max_rounds={prereg.fields['max_rounds']}",
        f"  {len(grid)} cells:",
    ]
    for shape in grid:
        lines.append(
            f"    {shape.label()} rounds={shape.rounds_full + shape.rounds_partial} "
            f"split={shape.first}f+{shape.rounds_partial}p+{shape.last}f "
            f"leading_partial={shape.leading_partial}"
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", action="store_true",
                        help="print the grid and exit, building nothing")
    parser.add_argument("--prereg", default=str(PREREG_PATH),
                        help="the pre-registration whose grid to run; every "
                             "record written is stamped with this document's "
                             "sha256, so it must be the document the runs are for")
    parser.add_argument("--prime", type=int, default=None,
                        help="field size; required unless --preview")
    parser.add_argument("--budget-seconds", type=float, default=3600.0)
    parser.add_argument("--timeout", type=float, default=None,
                        help="per-rung budget; defaults to the pre-registered value")
    parser.add_argument("--max-rounds", type=int, default=None)
    parser.add_argument("--only", default="", help="comma-separated cell labels")
    parser.add_argument("--encoding", default="sbox",
                        help="model compiler: sbox or state")
    parser.add_argument("--runs-dir", default=None,
                        help="write ladders and append to the hash chain here")
    args = parser.parse_args(argv)

    if args.preview:
        print(preview(args.prereg))
        return 0
    if args.prime is None:
        parser.error("--prime is required unless --preview")
    report = run_sweep(
        prime=args.prime,
        prereg_path=args.prereg,
        budget_seconds=args.budget_seconds,
        timeout=args.timeout,
        max_rounds=args.max_rounds,
        only=args.only,
        runs_dir=args.runs_dir,
        encoding=args.encoding,
    )
    print(report.render())
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
