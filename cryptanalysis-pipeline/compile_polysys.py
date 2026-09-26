"""L1 — the model compiler: ``Spec`` to polynomial system over F_p.

The CICO problem becomes a polynomial system by the standard device: introduce
one variable per S-box output, so each equation is degree ``d`` rather than
letting the composed map reach degree ``d ** rounds``. A system of many
low-degree equations is what a Gröbner engine can work on; one equation of
degree 3^64 is not.

For each S-box application, with input expression ``e`` and fresh variable ``y``:

    e ** d - y = 0

The linear layers and constant additions are carried symbolically inside the
expressions, so they cost no equations and no variables. The CICO constraints --
capacity elements zero on output -- are appended as linear equations.

**The round-trip test is the load-bearing check in this pipeline**, and it runs
in both directions:

  forward   any solution the model admits, decoded, must satisfy the CICO
            problem according to ``reference.py``. Catches a model that
            describes a different cipher, which is the defect that silently
            invalidates this whole class of work.

  reverse   any input/output pair taken from ``reference.py`` must be *accepted*
            by the model. Catches an over-constrained model, which fails as
            "no attack found" forever and is how a project runs for months
            measuring nothing.

Both are in ``roundtrip.py``. Neither is optional.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from polynomial import Poly
from reference import CicoProblem
from spec import Spec


class CompileRefused(Exception):
    """The requested model cannot be built as stated."""


@dataclass(frozen=True, slots=True)
class PolynomialSystem:
    """A system over F_p, in msolve's input syntax.

    ``variables`` is ordered, and that order is part of the model: msolve
    reports solutions positionally, so decoding depends on it.
    """

    spec: Spec
    rounds: int
    #: The problem this system encodes. Carried because reconstructing one from
    #: the spec and round count loses everything else about it -- an earlier
    #: version did that and silently rebuilt a planted instance as an
    #: un-planted one, so the round-trip lost the witness it had been given.
    problem: "CicoProblem | None"
    variables: tuple[str, ...]
    equations: tuple[str, ...]
    #: Which variables are the free rate elements, in rate order. Decoding a
    #: solver answer back to a candidate attack reads these.
    rate_variables: tuple[str, ...]
    #: Which encoding produced this system. ``"sbox"`` is one variable per
    #: S-box output; ``"state"`` is one variable per state element per stage.
    #: The round-trip test dispatches on this, so both encodings are checked by
    #: the same load-bearing code rather than by two implementations that could
    #: each be wrong in a different way.
    encoding: str = "sbox"
    #: Degree of each equation, so the system's shape is reportable without
    #: re-parsing it.
    degrees: tuple[int, ...] = field(default=())
    #: The equations as Poly objects. Kept so evaluation never re-parses the
    #: rendered strings -- re-parsing is how a second reading of the model
    #: drifts from the first.
    polys: tuple[Poly, ...] = field(default=())

    @property
    def n_variables(self) -> int:
        return len(self.variables)

    @property
    def n_equations(self) -> int:
        return len(self.equations)

    @property
    def max_degree(self) -> int:
        return max(self.degrees) if self.degrees else 0

    def to_msolve(self) -> str:
        """msolve's format: variables, characteristic, then comma-separated
        equations with no trailing comma."""
        return (
            ",".join(self.variables)
            + "\n"
            + str(self.spec.prime)
            + "\n"
            + ",\n".join(self.equations)
            + "\n"
        )

    def to_singular(self) -> str:
        """Singular's format, for the second-solver corroboration L2 requires."""
        ring = f"ring r = {self.spec.prime},({','.join(self.variables)}),dp;"
        ideal = "ideal I = " + ",\n  ".join(self.equations) + ";"
        return "\n".join(
            [
                ring,
                ideal,
                "option(redSB);",
                "ideal G = groebner(I);",
                'printf("GB_SIZE %s", size(G));',
                'printf("GB_DIM %s", dim(G));',
                'printf("GB_MAXDEG %s", deg(G[size(G)]));',
                # vdim is the quotient ring's vector-space dimension: the number
                # of solutions over the algebraic closure with multiplicity.
                # Only defined for a zero-dimensional ideal.
                'if (dim(G) == 0) { printf("GB_VDIM %s", vdim(G)); }',
                "quit;",
            ]
        )

    def render(self) -> str:
        return (
            f"polysys spec={self.spec.name} rounds={self.rounds} "
            f"variables={self.n_variables} equations={self.n_equations} "
            f"max_degree={self.max_degree} sboxes={self.spec.sbox_count}"
        )


def compile_cico(problem: CicoProblem) -> PolynomialSystem:
    """Build the polynomial system for a CICO problem, in **expanded** form.

    State elements are carried as ``Poly`` objects, so constant addition and the
    MDS layer are exact polynomial operations and only the S-box introduces a
    variable and an equation. Every equation handed to a solver is a sum of
    monomials.

    The expansion is not cosmetic. The first version emitted the factored form
    ``(1*x0+61)^3-y1``, which msolve silently mis-parses -- it returns ``[-1]``,
    *no solution in the algebraic closure*, for a system with a demonstrable
    solution. See ``polynomial.py``'s docstring; the two-solver corroboration is
    what caught it.
    """
    spec = problem.spec
    p = spec.prime
    rounds = problem.rounds
    if not 0 <= rounds <= spec.rounds:
        raise CompileRefused(f"rounds must be in [0, {spec.rounds}]")
    if rounds == 0:
        raise CompileRefused(
            "a zero-round CICO problem is the identity and has no S-boxes; "
            "there is no system to build"
        )

    variables: list[str] = []
    equations: list[Poly] = []

    rate_variables = tuple(f"x{i}" for i in range(problem.n_free))
    variables.extend(rate_variables)

    # Capacity zero, free rate variable, then the pinned rate elements. Pinning
    # is what makes the system zero-dimensional -- see CicoProblem.
    state: list[Poly] = [Poly.constant(0, p) for _ in range(spec.capacity)]
    state.extend(Poly.variable(name, p) for name in rate_variables)
    state.extend(Poly.constant(v, p) for v in problem.fixed_rate)

    sbox_index = 0
    for round_index, kind in enumerate(spec.round_kinds()):
        if round_index >= rounds:
            break

        state = [
            element + spec.constants[round_index][i]
            for i, element in enumerate(state)
        ]

        targets = range(spec.width) if kind == "full" else range(1)
        for i in targets:
            fresh = f"y{sbox_index}"
            sbox_index += 1
            variables.append(fresh)
            equations.append(
                state[i].power(spec.sbox_exponent) - Poly.variable(fresh, p)
            )
            state[i] = Poly.variable(fresh, p)

        combined: list[Poly] = []
        for i in range(spec.width):
            acc = Poly.constant(0, p)
            for j in range(spec.width):
                acc = acc + state[j].scale(spec.mds[i][j])
            combined.append(acc)
        state = combined

    # The output constraint. For a planted instance this is the value the
    # reference produced at the witness; otherwise zero.
    want = problem.required_output
    for i in range(spec.capacity):
        equations.append(state[i] - want[i])

    if not equations:
        raise CompileRefused("no equations were generated; the model is empty")

    return PolynomialSystem(
        spec=spec,
        rounds=rounds,
        problem=problem,
        variables=tuple(variables),
        equations=tuple(e.render() for e in equations),
        rate_variables=rate_variables,
        degrees=tuple(e.degree for e in equations),
        polys=tuple(equations),
    )


def decode_solution(system: PolynomialSystem, assignment: dict[str, int]) -> list[int]:
    """Pull the candidate rate assignment out of a solver's answer.

    Raises rather than guessing if a rate variable is absent, because a
    silently-defaulted variable would produce a candidate that fails L4
    verification for a reason nobody could diagnose.
    """
    missing = [name for name in system.rate_variables if name not in assignment]
    if missing:
        raise CompileRefused(f"solver answer omits rate variables: {missing}")
    return [assignment[name] % system.spec.prime for name in system.rate_variables]


def evaluate_system(
    system: PolynomialSystem, assignment: dict[str, int]
) -> tuple[bool, tuple[int, ...]]:
    """Whether an assignment satisfies every equation, and each residual.

    Evaluates the ``Poly`` objects directly rather than re-parsing the rendered
    strings. An earlier version evaluated the strings through ``eval``, which
    made the check a second parser rather than a second reading -- and a parser
    that agreed with the renderer by construction.
    """
    p = system.spec.prime
    residuals = tuple(poly.evaluate(assignment) % p for poly in system.polys)
    return all(r == 0 for r in residuals), residuals
