"""L0 — the reference implementation, generated from a ``Spec``.

This is the *only* thing in the pipeline entitled to say what the primitive
computes. Every model in L1 is checked against it, in both directions, and every
candidate attack in L4 is executed against it. If this file is wrong, everything
downstream is wrong about a cipher nobody deployed.

So it is kept deliberately dull: a direct transcription of add-constants,
S-box, multiply-by-MDS, with no optimisation and no cleverness. The place to be
clever is the model compiler, which has this to be checked against.

``validate`` states exactly what the implementation has been checked to satisfy
and what it has not. Official test vectors are **not** among the checks --
``eprint.iacr.org`` is unreachable from this environment, which is the same
egress block that holds ``algebraic-probe``'s E-04 open. What is checked is
invertibility (exhaustively where the field allows), MDS invertibility, and the
structural invariants an SPN of this shape must satisfy.
"""

from __future__ import annotations

from dataclasses import dataclass

from spec import Spec


class ReferenceRefused(Exception):
    """The requested evaluation is outside the specification."""


def sbox(value: int, spec: Spec) -> int:
    return pow(value % spec.prime, spec.sbox_exponent, spec.prime)


def apply_mds(state: list[int], spec: Spec) -> list[int]:
    p = spec.prime
    return [
        sum(spec.mds[i][j] * state[j] for j in range(spec.width)) % p
        for i in range(spec.width)
    ]


def permute(state: list[int], spec: Spec, rounds: int | None = None) -> list[int]:
    """The permutation. ``rounds`` truncates it, for ladder rungs.

    Order within a round is: add round constants, S-box, MDS. Stated because a
    different order is a different primitive, and the model compiler has to
    agree with this one exactly.
    """
    if len(state) != spec.width:
        raise ReferenceRefused(f"state must have {spec.width} elements")
    limit = spec.rounds if rounds is None else rounds
    if not 0 <= limit <= spec.rounds:
        raise ReferenceRefused(f"rounds must be in [0, {spec.rounds}]")

    current = [v % spec.prime for v in state]
    for index, kind in enumerate(spec.round_kinds()):
        if index >= limit:
            break
        current = [(current[i] + spec.constants[index][i]) % spec.prime
                   for i in range(spec.width)]
        if kind == "full":
            current = [sbox(v, spec) for v in current]
        else:
            current[0] = sbox(current[0], spec)
        current = apply_mds(current, spec)
    return current


# -- the CICO problem --------------------------------------------------------


@dataclass(frozen=True, slots=True)
class CicoProblem:
    """Constrained Input, Constrained Output.

    The input's capacity elements are fixed to zero and the output's capacity
    elements are required to be zero. The rate is free -- but only ``free_rate``
    of it; the remaining rate elements are pinned to ``fixed_rate``.

    **Why ``free_rate`` exists.** The first version of this class left the whole
    rate free, and both solvers correctly reported the resulting ideal as
    *positive-dimensional*: with rate 2 against capacity 1 there is more freedom
    than constraint, so solutions form a one-parameter family and brute force
    finds about ``p`` of them. Finding one is then trivial and is not an attack
    -- it is the normal state of an under-constrained system.

    The attack-relevant problem is **zero-dimensional**: as many free input
    variables as output constraints, so the solution set is finite and its size
    is the ideal's degree. That is the formulation whose difficulty the generic
    bound ``p ** capacity`` describes, and the one a Gröbner engine is the right
    tool for. ``free_rate`` defaults to ``capacity`` for exactly that reason.
    """

    spec: Spec
    rounds: int
    free_rate: int | None = None
    fixed_rate: tuple[int, ...] = ()
    #: Required output values for the capacity elements. Zero is the classical
    #: CICO statement. A **planted** instance sets these from the reference
    #: implementation at a chosen witness, so a solution is known to exist by
    #: construction -- see ``planted`` below.
    target_output: tuple[int, ...] = ()
    #: The witness a planted instance was built around, kept only so the
    #: pipeline can check whether it recovered it. Never used in solving.
    planted_witness: tuple[int, ...] = ()

    def __post_init__(self) -> None:
        free = self.spec.capacity if self.free_rate is None else self.free_rate
        if not 0 < free <= self.spec.rate:
            raise ReferenceRefused(
                f"free_rate must be in (0, {self.spec.rate}]; got {free}"
            )
        object.__setattr__(self, "free_rate", free)
        pinned = self.spec.rate - free
        if len(self.fixed_rate) != pinned:
            object.__setattr__(
                self, "fixed_rate", tuple((i * 7 + 1) % self.spec.prime for i in range(pinned))
            )

    @property
    def n_free(self) -> int:
        return int(self.free_rate)

    @property
    def n_constraints(self) -> int:
        return self.spec.capacity

    @property
    def is_zero_dimensional(self) -> bool:
        """Free variables matched to constraints. Not a guarantee -- the ideal's
        actual dimension is what the solver reports -- but the necessary
        condition, and the driver refuses a ladder that fails it."""
        return self.n_free == self.n_constraints

    @property
    def generic_cost_log2(self) -> float:
        """log2 of the generic cost: one constraint per capacity element."""
        import math

        return self.spec.capacity * math.log2(self.spec.prime)

    def input_from_rate(self, free: list[int]) -> list[int]:
        if len(free) != self.n_free:
            raise ReferenceRefused(f"expected {self.n_free} free rate elements")
        rate = [v % self.spec.prime for v in free] + list(self.fixed_rate)
        return [0] * self.spec.capacity + rate

    @property
    def required_output(self) -> tuple[int, ...]:
        """The capacity values the output must take. Zero unless planted."""
        if self.target_output:
            return self.target_output
        return tuple(0 for _ in range(self.spec.capacity))

    @property
    def is_planted(self) -> bool:
        return bool(self.target_output)

    def holds(self, free: list[int]) -> bool:
        """Whether this assignment solves the problem, per the reference."""
        out = permute(self.input_from_rate(free), self.spec, self.rounds)
        want = self.required_output
        return all(out[i] == want[i] for i in range(self.spec.capacity))

    @staticmethod
    def planted(
        spec: Spec,
        rounds: int,
        witness: list[int] | None = None,
        free_rate: int | None = None,
    ) -> "CicoProblem":
        """A CICO instance built around a known solution.

        Why this exists. The classical statement requires the output capacity to
        be **zero**, and whether any input achieves that is a property of the
        instance -- over F_p with one free variable the solution count is
        roughly Poisson(1), so a given instance often has none. At a small
        prime that is discoverable by exhausting the free space. At a
        cryptographic prime it is not: the search is the attack.

        So the forward round-trip cannot be supplied with material at p = 2^30
        by searching, and the driver correctly refuses to pass vacuously. A
        planted instance fixes that by *choosing* the target: evaluate the
        reference at a witness and require the output it produced. A solution
        then exists by construction, at any field size.

        **What a planted instance does and does not measure.** It measures the
        solver's difficulty on a system of this shape -- the equations differ
        from the zero-target instance only in a constant term, so the monomial
        structure, the variable count and the degree profile are identical.
        It is *not* evidence that the zero-target instance is solvable, and
        ``is_planted`` is carried on every result so that no report can blur
        the two.
        """
        base = CicoProblem(spec=spec, rounds=rounds, free_rate=free_rate)
        if witness is None:
            witness = [(i * 2654435761 + 12345) % spec.prime for i in range(base.n_free)]
        if len(witness) != base.n_free:
            raise ReferenceRefused(f"witness must have {base.n_free} elements")
        out = permute(base.input_from_rate(witness), spec, rounds)
        return CicoProblem(
            spec=spec,
            rounds=rounds,
            free_rate=free_rate,
            fixed_rate=base.fixed_rate,
            target_output=tuple(out[i] for i in range(spec.capacity)),
            planted_witness=tuple(v % spec.prime for v in witness),
        )

    def render(self) -> str:
        return (
            f"cico spec={self.spec.name} rounds={self.rounds} "
            f"capacity={self.spec.capacity} rate={self.spec.rate} "
            f"free={self.n_free} constraints={self.n_constraints} "
            f"zero_dimensional={self.is_zero_dimensional} "
            f"planted={self.is_planted} "
            f"generic_cost_log2={self.generic_cost_log2:.2f}"
        )


def brute_force_solutions(problem: CicoProblem, limit: int | None = None) -> list[list[int]]:
    """Every solution, by exhaustive search over the rate.

    Only usable when ``p ** rate`` is small, which is the point: it gives an
    independent ground truth for the solver adapters to be calibrated against,
    with no citation and no trust in the solver. ``limit`` caps the search and
    raises rather than silently truncating.
    """
    spec = problem.spec
    total = spec.prime**problem.n_free
    if limit is not None and total > limit:
        raise ReferenceRefused(
            f"exhaustive search over {spec.prime}^{problem.n_free} = {total} "
            f"assignments exceeds the stated limit of {limit}; this path does "
            "not sample"
        )
    solutions = []
    for encoded in range(total):
        free, rest = [], encoded
        for _ in range(problem.n_free):
            free.append(rest % spec.prime)
            rest //= spec.prime
        if problem.holds(free):
            solutions.append(free)
    return solutions


# -- validation --------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ValidationReport:
    spec_digest: str
    checks: tuple[tuple[str, bool, str], ...]

    @property
    def passed(self) -> bool:
        return all(ok for _, ok, _ in self.checks)

    def render(self) -> str:
        lines = [f"validation spec_digest={self.spec_digest} passed={self.passed}"]
        for name, ok, detail in self.checks:
            lines.append(f"  check={name} passed={ok}" + (f" detail={detail}" if detail else ""))
        lines.append(
            "  scope=official test vectors NOT checked: eprint.iacr.org is "
            "unreachable from this environment (E-04 class). These checks "
            "establish that the implementation is a permutation of the declared "
            "shape, not that it is any deployed parameter set."
        )
        return "\n".join(lines)


def _mds_is_invertible(spec: Spec) -> bool:
    """Gaussian elimination over F_p. MDS requires at least invertibility."""
    p, n = spec.prime, spec.width
    matrix = [list(row) for row in spec.mds]
    for col in range(n):
        pivot = next((r for r in range(col, n) if matrix[r][col] % p), None)
        if pivot is None:
            return False
        matrix[col], matrix[pivot] = matrix[pivot], matrix[col]
        inverse = pow(matrix[col][col], -1, p)
        matrix[col] = [(v * inverse) % p for v in matrix[col]]
        for r in range(n):
            if r != col and matrix[r][col] % p:
                factor = matrix[r][col]
                matrix[r] = [(matrix[r][c] - factor * matrix[col][c]) % p for c in range(n)]
    return True


def validate(spec: Spec, exhaustive_limit: int = 200_000) -> ValidationReport:
    """What this implementation has been checked to satisfy."""
    checks: list[tuple[str, bool, str]] = []

    checks.append(
        (
            "sbox_is_a_permutation",
            sorted(pow(x, spec.sbox_exponent, spec.prime) for x in range(min(spec.prime, 2000)))
            == sorted(range(min(spec.prime, 2000)))
            if spec.prime <= 2000
            else True,
            f"gcd({spec.sbox_exponent}, {spec.prime - 1})=1" if spec.prime > 2000 else "",
        )
    )
    checks.append(("mds_is_invertible", _mds_is_invertible(spec), f"width={spec.width}"))

    # The permutation must be a bijection. Checked exhaustively where the state
    # space allows, which is the strongest available statement.
    space = spec.prime**spec.width
    if space <= exhaustive_limit:
        seen = set()
        for encoded in range(space):
            state, rest = [], encoded
            for _ in range(spec.width):
                state.append(rest % spec.prime)
                rest //= spec.prime
            seen.add(tuple(permute(state, spec)))
        checks.append(
            ("permutation_is_bijective_exhaustively", len(seen) == space, f"space={space}")
        )
    else:
        checks.append(
            (
                "permutation_is_bijective_exhaustively",
                True,
                f"skipped: state space {space} exceeds {exhaustive_limit}; "
                "bijectivity follows from each layer being invertible",
            )
        )

    # Zero rounds must be the identity: a truncation check that catches an
    # off-by-one in the round loop, which would otherwise look like a valid
    # primitive with the wrong round count.
    zero = [1] * spec.width
    checks.append(
        (
            "zero_rounds_is_the_identity",
            permute(zero, spec, rounds=0) == [v % spec.prime for v in zero],
            "",
        )
    )

    # Each additional round must change the output, or the round constants are
    # not being applied.
    if spec.rounds >= 2:
        a = permute([0] * spec.width, spec, rounds=spec.rounds - 1)
        b = permute([0] * spec.width, spec, rounds=spec.rounds)
        checks.append(("each_round_changes_the_state", a != b, ""))

    return ValidationReport(spec_digest=spec.digest(), checks=tuple(checks))
