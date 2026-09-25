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
    variables: tuple[str, ...]
    equations: tuple[str, ...]
    #: Which variables are the free rate elements, in rate order. Decoding a
    #: solver answer back to a candidate attack reads these.
    rate_variables: tuple[str, ...]
    #: Degree of each equation, so the system's shape is reportable without
    #: re-parsing it.
    degrees: tuple[int, ...] = field(default=())

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
                "quit;",
            ]
        )

    def render(self) -> str:
        return (
            f"polysys spec={self.spec.name} rounds={self.rounds} "
            f"variables={self.n_variables} equations={self.n_equations} "
            f"max_degree={self.max_degree} sboxes={self.spec.sbox_count}"
        )


def _linear(terms: dict[str, int], constant: int, prime: int) -> str:
    """Render a linear expression ``sum(coeff * var) + constant`` over F_p."""
    parts = []
    for name, coefficient in terms.items():
        c = coefficient % prime
        if c:
            parts.append(f"{c}*{name}")
    k = constant % prime
    if k or not parts:
        parts.append(str(k))
    return "(" + "+".join(parts) + ")"


def compile_cico(problem: CicoProblem) -> PolynomialSystem:
    """Build the polynomial system for a CICO problem.

    State elements are carried as linear forms in the variables -- a dict of
    coefficients plus a constant -- so constant addition and the MDS layer are
    exact symbolic operations that introduce nothing. Only the S-box introduces
    a variable and an equation, which is why the system's size is the S-box
    count and not the round count.
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
    equations: list[str] = []
    degrees: list[int] = []

    # The input: capacity fixed to zero, rate free.
    rate_variables = tuple(f"x{i}" for i in range(spec.rate))
    variables.extend(rate_variables)

    # Each state element is (linear-form-in-variables, constant).
    state: list[tuple[dict[str, int], int]] = []
    for i in range(spec.capacity):
        state.append(({}, 0))
    for i, name in enumerate(rate_variables):
        state.append(({name: 1}, 0))

    sbox_index = 0
    for round_index, kind in enumerate(spec.round_kinds()):
        if round_index >= rounds:
            break

        # Add round constants: exact, in the constant term.
        state = [
            (terms, (constant + spec.constants[round_index][i]) % p)
            for i, (terms, constant) in enumerate(state)
        ]

        # S-box: the only thing that costs a variable and an equation.
        targets = range(spec.width) if kind == "full" else range(1)
        for i in targets:
            terms, constant = state[i]
            fresh = f"y{sbox_index}"
            sbox_index += 1
            variables.append(fresh)
            expression = _linear(terms, constant, p)
            equations.append(f"{expression}^{spec.sbox_exponent}-{fresh}")
            degrees.append(spec.sbox_exponent)
            state[i] = ({fresh: 1}, 0)

        # MDS: exact linear recombination of the forms.
        combined: list[tuple[dict[str, int], int]] = []
        for i in range(spec.width):
            terms: dict[str, int] = {}
            constant = 0
            for j in range(spec.width):
                coefficient = spec.mds[i][j]
                inner_terms, inner_constant = state[j]
                for name, value in inner_terms.items():
                    terms[name] = (terms.get(name, 0) + coefficient * value) % p
                constant = (constant + coefficient * inner_constant) % p
            combined.append((terms, constant))
        state = combined

    # The output constraint: capacity elements zero.
    for i in range(spec.capacity):
        terms, constant = state[i]
        equations.append(_linear(terms, constant, p))
        degrees.append(1)

    if not equations:
        raise CompileRefused("no equations were generated; the model is empty")

    return PolynomialSystem(
        spec=spec,
        rounds=rounds,
        variables=tuple(variables),
        equations=tuple(equations),
        rate_variables=rate_variables,
        degrees=tuple(degrees),
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

    Used by the reverse round-trip test: a known-good pair from the reference
    implementation must make every residual zero. Implemented by rebuilding the
    system's own arithmetic rather than by calling a solver, so it is an
    independent reading of the model.
    """
    from reference import sbox

    spec = system.spec
    p = spec.prime
    residuals = []
    for equation in system.equations:
        residuals.append(_evaluate_expression(equation, assignment, p, spec.sbox_exponent))
    return all(r % p == 0 for r in residuals), tuple(r % p for r in residuals)


def _evaluate_expression(text: str, assignment: dict[str, int], prime: int, exponent: int) -> int:
    """Evaluate one generated equation.

    The generated syntax is restricted -- integers, variable names, ``+``,
    ``*``, ``-``, ``^`` and parentheses -- so it maps onto Python arithmetic by
    replacing ``^`` with ``**``. Evaluated in a namespace holding only the
    assignment, so a name the model did not declare raises instead of resolving.
    """
    expression = text.replace("^", "**")
    namespace = {"__builtins__": {}}
    namespace.update({k: v % prime for k, v in assignment.items()})
    return eval(expression, namespace) % prime  # noqa: S307 - restricted namespace
