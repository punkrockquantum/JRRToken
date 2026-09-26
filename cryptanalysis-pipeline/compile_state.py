"""L1, second encoding — one variable per state element per stage.

This exists for one reason: to decide whether a measured difference between
full and partial rounds is a fact about the cipher or a fact about the model.

Under the S-box encoding in ``compile_polysys.py``, a full round introduces
``width`` variables and ``width`` cubic equations while a partial round
introduces one of each. So the two round kinds differ in **two** ways at once:
how much S-box nonlinearity they add, and how many generators they add. Adding
generators can lower a system's degree of regularity on its own. A measurement
that separates the kinds under that encoding cannot say which of the two causes
it saw.

This encoding holds the second one fixed. Per round, for every state element:

    u[r][i]  the value after the round constant and, where it applies, the
             S-box.  S-box target:  (s[r-1][i] + c[r][i])^d - u[r][i] = 0
                     otherwise:     (s[r-1][i] + c[r][i])   - u[r][i] = 0
    s[r][i]  the value after the MDS layer:  sum_j M[i][j] u[r][j] - s[r][i] = 0

**Every round adds exactly ``2 * width`` variables and ``2 * width`` equations,
whatever its kind.** A full round contributes ``width`` cubics among those
equations; a partial round contributes one cubic and ``width - 1`` linears.
Variable count, equation count and the MDS structure are identical; only the
placement of nonlinearity differs. That is the controlled comparison.

The input state is *not* given variables: capacity elements are zero, the free
rate element is the same ``x0`` the other encoding uses, and pinned rate
elements are constants. Keeping the free variables identical is what makes the
two systems describe the same solution set, which is what makes ``vdim`` a
cross-model check rather than two unrelated numbers.

This encoding is deliberately worse as an attack model -- it is bigger, and a
solver will be slower on it. That is not the point. The point is that it is a
*different* model of the same cipher, and agreement between two different
models is the only evidence available that a measurement is about the cipher.
"""

from __future__ import annotations

from compile_polysys import CompileRefused, PolynomialSystem
from polynomial import Poly
from reference import CicoProblem


def state_variable(round_index: int, element: int) -> str:
    """Name of the post-MDS state variable. Rounds are 1-based in names."""
    return f"s{round_index}_{element}"


def sbox_variable(round_index: int, element: int) -> str:
    """Name of the post-S-box (or post-constant) variable."""
    return f"u{round_index}_{element}"


def compile_cico_state(problem: CicoProblem) -> PolynomialSystem:
    """Build the state-variable system for a CICO problem, in expanded form."""
    spec = problem.spec
    p = spec.prime
    rounds = problem.rounds
    if not 0 <= rounds <= spec.rounds:
        raise CompileRefused(f"rounds must be in [0, {spec.rounds}]")
    if rounds == 0:
        raise CompileRefused(
            "a zero-round CICO problem is the identity; there is no system to build"
        )

    variables: list[str] = []
    equations: list[Poly] = []

    rate_variables = tuple(f"x{i}" for i in range(problem.n_free))
    variables.extend(rate_variables)

    state: list[Poly] = [Poly.constant(0, p) for _ in range(spec.capacity)]
    state.extend(Poly.variable(name, p) for name in rate_variables)
    state.extend(Poly.constant(v, p) for v in problem.fixed_rate)

    for round_index, kind in enumerate(spec.round_kinds()):
        if round_index >= rounds:
            break
        number = round_index + 1
        targets = set(range(spec.width)) if kind == "full" else {0}

        # Stage one: constants, then the S-box where it applies. One variable
        # per element either way -- that is the control.
        u_names = []
        for i in range(spec.width):
            name = sbox_variable(number, i)
            variables.append(name)
            u_names.append(name)
            after_constant = state[i] + spec.constants[round_index][i]
            fresh = Poly.variable(name, p)
            if i in targets:
                equations.append(after_constant.power(spec.sbox_exponent) - fresh)
            else:
                equations.append(after_constant - fresh)

        # Stage two: the MDS layer, as linear equations in the u variables.
        s_names = []
        for i in range(spec.width):
            name = state_variable(number, i)
            variables.append(name)
            s_names.append(name)
            acc = Poly.constant(0, p)
            for j in range(spec.width):
                acc = acc + Poly.variable(u_names[j], p).scale(spec.mds[i][j])
            equations.append(acc - Poly.variable(name, p))

        state = [Poly.variable(name, p) for name in s_names]

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
        encoding="state",
        degrees=tuple(e.degree for e in equations),
        polys=tuple(equations),
    )


def cubic_equation_count(problem: CicoProblem) -> int:
    """How many equations are genuinely cubic -- the only thing the round kind
    changes under this encoding.

    Stated as a function rather than read off the compiled system, so a test
    checks the compiler against an independent count.

    The subtlety, which the first version got wrong and the disagreement
    located: **an S-box applied to a constant does not produce a cubic
    equation.** At round 1 the capacity elements are zero and the pinned rate
    elements are constants, so cubing them gives a constant and the equation
    ``const - u`` is linear. Only elements that actually depend on a free
    variable yield a cubic. This is the same effect that makes
    ``predicted_ideal_degree`` lag on a leading-partial spec.
    """
    spec = problem.spec
    # True where the element depends on a free variable.
    varying = [False] * spec.width
    for i in range(spec.capacity, spec.capacity + problem.n_free):
        varying[i] = True
    total = 0
    for round_index, kind in enumerate(spec.round_kinds()):
        if round_index >= problem.rounds:
            break
        targets = range(spec.width) if kind == "full" else range(1)
        for i in targets:
            if varying[i]:
                total += 1
        # The Cauchy MDS layer has no zero coefficient, so one varying element
        # makes every element vary from here on.
        if any(varying):
            varying = [True] * spec.width
    return total
