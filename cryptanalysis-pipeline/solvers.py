"""L2 — solver adapters: delegate, pin, record.

No search is implemented here. msolve and Singular do the work; this layer
translates, invokes, and records enough that a result can be reproduced or
disputed.

What is recorded, per the design: solver name, exact version, parameters,
wall-clock, peak memory, exit status, and -- for Gröbner -- **the maximum degree
reached and the size of the basis**. That last pair is the scientific
observable for arithmetisation-oriented primitives. Wall-clock is a property of
this machine; the degree reached is a property of the mathematics, and it is
what a security claim's degree-of-regularity conjecture is a claim about.

Two solvers, deliberately. Solver nondeterminism, heuristic differences and
outright bugs are real, and agreement between two unrelated implementations is
the cheapest guard available. msolve is the fast open F4; Singular is the
independent corroboration. Both are open, so a result here is checkable by
anyone without a licence.

The wall is data. A solver that exhausts memory at degree 14 has produced a
measurement -- "rounds 1..7 solved exactly, round 8 exceeded the budget at
degree 14" is a checkable, publishable statement, and it is what most cells
produce. ``SolverOutcome.status`` distinguishes that cleanly from a crash.
"""

from __future__ import annotations

import re
import resource
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from compile_polysys import PolynomialSystem


class SolverUnavailable(Exception):
    """The requested solver is not installed."""


#: Status values. Kept explicit so that "the solver hit the wall" is never
#: silently folded into "no solution exists", which would turn a resource limit
#: into a false security claim.
SOLVED = "solved"
POSITIVE_DIM = "positive-dimensional"
NO_SOLUTION = "no-solution"
WALL = "wall"
ERROR = "error"


@dataclass(frozen=True, slots=True)
class SolverOutcome:
    solver: str
    version: str
    status: str
    seconds: float
    peak_memory_mb: float
    #: Gröbner observables. ``None`` where the solver did not report them.
    max_degree: int | None = None
    basis_size: int | None = None
    #: Largest matrix the solver reported, in cells -- the memory proxy.
    matrix_cells: int | None = None
    #: Variable assignments, when the solver found a point.
    assignments: tuple[dict[str, int], ...] = ()
    #: Number of solutions over the algebraic closure, when reported.
    solution_count: int | None = None
    detail: str = ""

    @property
    def is_wall(self) -> bool:
        return self.status == WALL

    def render(self) -> str:
        parts = [
            f"solver={self.solver}",
            f"version={self.version}",
            f"status={self.status}",
            f"seconds={self.seconds:.3f}",
            f"peak_mb={self.peak_memory_mb:.1f}",
        ]
        if self.max_degree is not None:
            parts.append(f"max_degree={self.max_degree}")
        if self.matrix_cells is not None:
            parts.append(f"matrix_cells={self.matrix_cells}")
        if self.basis_size is not None:
            parts.append(f"basis_size={self.basis_size}")
        if self.solution_count is not None:
            parts.append(f"solutions={self.solution_count}")
        parts.append(f"assignments={len(self.assignments)}")
        if self.detail:
            parts.append(f"detail={self.detail[:120]}")
        return " ".join(parts)


#: Process names whose presence means another solver is competing for CPU.
CONTENDING = ("Singular", "msolve")


def contending_solvers() -> tuple[str, ...]:
    """Other solver processes currently running.

    The cost gate compares wall-clock, so a second solver on the same machine
    inflates the observable and the comparison becomes a measurement of
    scheduling rather than of mathematics. Two deep ladders ran concurrently
    once in this project and the timings from that window are not usable.

    Read from /proc rather than by shelling out to ps, so the check itself
    neither spawns a process nor matches its own command line -- the self-match
    trap that has bitten this codebase before.
    """
    import os

    found = []
    for entry in os.listdir("/proc"):
        if not entry.isdigit() or int(entry) == os.getpid():
            continue
        try:
            with open(f"/proc/{entry}/comm", encoding="utf-8") as handle:
                name = handle.read().strip()
        except (OSError, ProcessLookupError):
            continue
        if name in CONTENDING:
            found.append(f"{name}[{entry}]")
    return tuple(found)


def _run(command: list[str], stdin: str | None, timeout: float) -> tuple[int, str, str, float, float]:
    """Invoke a solver, returning exit code, output, elapsed and peak memory.

    Peak memory is read from ``getrusage`` for the child process group, which
    is the figure that matters: Gröbner on these systems is memory-bound before
    it is time-bound, so the memory number decides how many ladder rungs are
    reachable.
    """
    before = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    start = time.monotonic()
    try:
        completed = subprocess.run(
            command,
            input=stdin,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        code, out, err = completed.returncode, completed.stdout, completed.stderr
    except subprocess.TimeoutExpired:
        code, out, err = -1, "", f"timeout after {timeout}s"
    elapsed = time.monotonic() - start
    after = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    # ru_maxrss is kilobytes on Linux.
    peak_mb = max(after - before, 0) / 1024.0
    return code, out, err, elapsed, peak_mb


# -- msolve ------------------------------------------------------------------


def msolve_version() -> str:
    if not shutil.which("msolve"):
        raise SolverUnavailable("msolve is not on PATH")
    code, out, err, _, _ = _run(["msolve", "-h"], None, timeout=20)
    match = re.search(r"(\d+\.\d+\.\d+)", out + err)
    return match.group(1) if match else "unknown"


def solve_with_msolve(
    system: PolynomialSystem, timeout: float = 600.0
) -> SolverOutcome:
    """Solve the system with msolve's default F4 + rational parametrisation.

    msolve's output for a zero-dimensional ideal is a nested list; for a
    positive-dimensional or empty one it says so. Both are parsed, and anything
    unrecognised becomes ``ERROR`` rather than being guessed at -- a
    misinterpreted solver answer is how a non-result becomes a claimed attack.
    """
    version = msolve_version()
    with tempfile.TemporaryDirectory() as directory:
        infile = Path(directory) / "system.ms"
        outfile = Path(directory) / "system.out"
        infile.write_text(system.to_msolve(), encoding="utf-8")
        # -v 2 emits per-step matrix sizes, which is where the Groebner
        # observable lives; without it msolve is silent and only the status is
        # recoverable.
        code, out, err, seconds, peak = _run(
            ["msolve", "-v", "2", "-f", str(infile), "-o", str(outfile)], None, timeout
        )
        text = outfile.read_text(encoding="utf-8") if outfile.exists() else ""

    combined = (out + err).lower()
    if code == -1 or "timeout" in combined:
        return SolverOutcome(
            "msolve", version, WALL, seconds, peak,
            detail=f"exceeded {timeout}s wall budget",
        )
    if "not enough memory" in combined or "cannot allocate" in combined:
        return SolverOutcome(
            "msolve", version, WALL, seconds, peak, detail="allocation failure"
        )
    if code != 0 and not text:
        return SolverOutcome(
            "msolve", version, ERROR, seconds, peak, detail=(err or out)[:400]
        )

    matrices = [int(a) * int(b) for a, b in re.findall(r"(\d+)\s*x\s*(\d+)", out + err)]
    largest = max(matrices) if matrices else None

    stripped = text.strip()
    if stripped.startswith("[-1"):
        # Documented: no solution in the algebraic closure.
        return SolverOutcome(
            "msolve", version, NO_SOLUTION, seconds, peak,
            solution_count=0, matrix_cells=largest,
            detail="msolve: no solution in the algebraic closure",
        )
    if stripped.startswith("[1"):
        # Documented as [1, nvars, -1, []]: infinitely many solutions.
        return SolverOutcome(
            "msolve", version, POSITIVE_DIM, seconds, peak,
            matrix_cells=largest,
            detail="msolve: infinitely many solutions in the algebraic closure",
        )
    if not stripped.startswith("[0"):
        return SolverOutcome(
            "msolve", version, ERROR, seconds, peak,
            detail=f"unrecognised msolve output: {stripped[:200]}",
        )

    # Zero-dimensional: msolve returns a rational parametrisation, and no
    # solution count is recoverable from it.
    #
    # An earlier draft pulled numbers[2] out of this block and called it the
    # solution count. It is nvars, and the figure it produced equalled the
    # variable count in every cell -- a misparsed solver answer reported as an
    # observable, which is the exact failure this module's docstring warns
    # about. The count now comes from Singular's vdim, which is unambiguous.
    return SolverOutcome(
        "msolve", version, SOLVED, seconds, peak,
        matrix_cells=largest,
        detail="zero-dimensional; rational parametrisation returned",
    )


# -- Singular ----------------------------------------------------------------


def singular_version() -> str:
    if not shutil.which("Singular"):
        raise SolverUnavailable("Singular is not on PATH")
    code, out, err, _, _ = _run(["Singular", "--version"], None, timeout=20)
    match = re.search(r"(\d+\.\d+\.\d+)", out + err)
    return match.group(1) if match else "unknown"


def solve_with_singular(
    system: PolynomialSystem, timeout: float = 600.0
) -> SolverOutcome:
    """Compute a Gröbner basis with Singular, reporting degree and basis size.

    This is the corroborating solver. It reports the two observables msolve does
    not expose directly -- the basis size and the top degree -- which is why it
    is worth the second run rather than being redundant.
    """
    version = singular_version()
    script = system.to_singular()
    code, out, err, seconds, peak = _run(["Singular", "-q"], script, timeout)

    combined = out + err
    lowered = combined.lower()
    if code == -1 or "timeout" in lowered:
        return SolverOutcome(
            "singular", version, WALL, seconds, peak,
            detail=f"exceeded {timeout}s wall budget",
        )
    if "no more memory" in lowered or "overflow" in lowered:
        return SolverOutcome(
            "singular", version, WALL, seconds, peak, detail="allocation failure"
        )

    size = re.search(r"GB_SIZE (\d+)", combined)
    dim = re.search(r"GB_DIM (-?\d+)", combined)
    maxdeg = re.search(r"GB_MAXDEG (\d+)", combined)
    vdim = re.search(r"GB_VDIM (-?\d+)", combined)

    if not size:
        return SolverOutcome(
            "singular", version, ERROR, seconds, peak,
            detail=(combined or "no output")[:400],
        )

    basis_size = int(size.group(1))
    dimension = int(dim.group(1)) if dim else None
    # A Groebner basis equal to {1} means the ideal is the whole ring: no
    # solutions. Singular reports dim = -1 in that case.
    if dimension == -1:
        return SolverOutcome(
            "singular", version, NO_SOLUTION, seconds, peak,
            basis_size=basis_size, solution_count=0,
            max_degree=int(maxdeg.group(1)) if maxdeg else None,
            detail="dim = -1: the ideal is the whole ring",
        )
    if dimension != 0:
        return SolverOutcome(
            "singular", version, POSITIVE_DIM, seconds, peak,
            basis_size=basis_size,
            max_degree=int(maxdeg.group(1)) if maxdeg else None,
            detail=f"dim={dimension}: infinitely many solutions",
        )
    return SolverOutcome(
        "singular", version, SOLVED, seconds, peak,
        basis_size=basis_size,
        max_degree=int(maxdeg.group(1)) if maxdeg else None,
        # Solutions over the algebraic closure, with multiplicity. Must be at
        # least the number of F_p-rational solutions brute force finds.
        solution_count=int(vdim.group(1)) if vdim else None,
        detail=f"dim={dimension}",
    )


# -- corroboration -----------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Corroboration:
    """Two solvers on one system, and whether they agree."""

    primary: SolverOutcome
    secondary: SolverOutcome

    @property
    def agree(self) -> bool:
        """Agreement on the *conclusion*, not on the numbers.

        Two Gröbner implementations legitimately report different basis sizes
        and different top degrees, because those depend on the ordering and the
        reduction strategy. What they must not disagree about is whether the
        system has solutions at all.
        """
        decisive = {SOLVED, NO_SOLUTION, POSITIVE_DIM}
        if self.primary.status not in decisive or self.secondary.status not in decisive:
            return True  # a wall is not a disagreement
        return self.primary.status == self.secondary.status

    @property
    def decisive(self) -> bool:
        return self.primary.status in {SOLVED, NO_SOLUTION, POSITIVE_DIM}

    def render(self) -> str:
        lines = [
            f"corroboration agree={self.agree} decisive={self.decisive}",
            f"  primary   {self.primary.render()}",
            f"  secondary {self.secondary.render()}",
        ]
        if not self.agree:
            lines.append(
                "  DISAGREEMENT: two independent solvers reached different "
                "conclusions about the same system. One of them is wrong and no "
                "claim may rest on either until it is resolved."
            )
        return "\n".join(lines)


def corroborate(system: PolynomialSystem, timeout: float = 600.0) -> Corroboration:
    return Corroboration(
        primary=solve_with_msolve(system, timeout),
        secondary=solve_with_singular(system, timeout),
    )
