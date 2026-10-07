"""Expanded polynomial arithmetic over F_p.

Exists because of a silent wrong answer. The first model compiler emitted
equations in factored form -- ``(1*x0+61)^3-y1`` -- and **msolve cannot parse a
parenthesised expression raised to a power**. It does not reject such input; it
returns ``[-1]``, its encoding for *no solution in the algebraic closure*, for a
system with a demonstrable solution.

In an attack pipeline that is the worst failure available: "no solution" reads
as "no attack found" and would be recorded as a clean negative result. Singular
parsed the same input correctly, so the two-solver corroboration the design
insists on is what exposed it -- one rung reported ``agree=False`` and that was
the only visible symptom.

So polynomials are carried in expanded form, as a map from monomial to
coefficient, and every solver gets a sum of monomials. ``Poly`` is small and
deliberately dull: correctness here is worth more than speed, because the
solvers do the work and this only has to hand them something they parse the
same way.
"""

from __future__ import annotations

from dataclasses import dataclass

#: A monomial: variable names with exponents, sorted, so it is canonical and
#: hashable. The empty tuple is the constant monomial.
Monomial = tuple[tuple[str, int], ...]


def _canonical(pairs: dict[str, int]) -> Monomial:
    return tuple(sorted((name, e) for name, e in pairs.items() if e))


@dataclass(frozen=True, slots=True)
class Poly:
    """A polynomial over F_p in expanded form."""

    prime: int
    terms: tuple[tuple[Monomial, int], ...]

    # -- construction --------------------------------------------------------

    @staticmethod
    def constant(value: int, prime: int) -> "Poly":
        v = value % prime
        return Poly(prime, () if v == 0 else (((), v),))

    @staticmethod
    def variable(name: str, prime: int) -> "Poly":
        return Poly(prime, (((( name, 1),), 1),))

    @staticmethod
    def from_terms(mapping: dict[Monomial, int], prime: int) -> "Poly":
        terms = tuple(
            sorted((m, c % prime) for m, c in mapping.items() if c % prime)
        )
        return Poly(prime, terms)

    # -- structure -----------------------------------------------------------

    @property
    def is_zero(self) -> bool:
        return not self.terms

    @property
    def degree(self) -> int:
        if not self.terms:
            return 0
        return max(sum(e for _, e in monomial) for monomial, _ in self.terms)

    @property
    def variables(self) -> tuple[str, ...]:
        names: set[str] = set()
        for monomial, _ in self.terms:
            names.update(name for name, _ in monomial)
        return tuple(sorted(names))

    @property
    def n_terms(self) -> int:
        return len(self.terms)

    # -- arithmetic ----------------------------------------------------------

    def __add__(self, other: "Poly | int") -> "Poly":
        if isinstance(other, int):
            other = Poly.constant(other, self.prime)
        if other.prime != self.prime:
            raise ValueError("field mismatch")
        merged: dict[Monomial, int] = dict(self.terms)
        for monomial, coefficient in other.terms:
            merged[monomial] = (merged.get(monomial, 0) + coefficient) % self.prime
        return Poly.from_terms(merged, self.prime)

    def scale(self, factor: int) -> "Poly":
        f = factor % self.prime
        if f == 0:
            return Poly(self.prime, ())
        return Poly.from_terms(
            {m: c * f for m, c in self.terms}, self.prime
        )

    def __neg__(self) -> "Poly":
        return self.scale(self.prime - 1)

    def __sub__(self, other: "Poly | int") -> "Poly":
        if isinstance(other, int):
            other = Poly.constant(other, self.prime)
        return self + (-other)

    def __mul__(self, other: "Poly | int") -> "Poly":
        if isinstance(other, int):
            return self.scale(other)
        if other.prime != self.prime:
            raise ValueError("field mismatch")
        product: dict[Monomial, int] = {}
        for m1, c1 in self.terms:
            for m2, c2 in other.terms:
                exponents: dict[str, int] = {}
                for name, e in m1:
                    exponents[name] = exponents.get(name, 0) + e
                for name, e in m2:
                    exponents[name] = exponents.get(name, 0) + e
                key = _canonical(exponents)
                product[key] = (product.get(key, 0) + c1 * c2) % self.prime
        return Poly.from_terms(product, self.prime)

    def power(self, exponent: int) -> "Poly":
        """Repeated squaring. The operation whose factored form broke msolve."""
        if exponent < 0:
            raise ValueError("negative exponents are not polynomials")
        result = Poly.constant(1, self.prime)
        base = self
        e = exponent
        while e:
            if e & 1:
                result = result * base
            base = base * base
            e >>= 1
        return result

    # -- rendering -----------------------------------------------------------

    def render(self) -> str:
        """Expanded form: a sum of ``coeff*var^exp*...`` terms.

        Every solver in L2 is handed this. No parentheses, no factored powers,
        so there is nothing for a parser to disagree about.
        """
        if not self.terms:
            return "0"
        parts = []
        for monomial, coefficient in self.terms:
            if not monomial:
                parts.append(str(coefficient))
                continue
            factors = [
                name if e == 1 else f"{name}^{e}" for name, e in monomial
            ]
            if coefficient == 1:
                parts.append("*".join(factors))
            else:
                parts.append(f"{coefficient}*" + "*".join(factors))
        return "+".join(parts)

    def evaluate(self, assignment: dict[str, int]) -> int:
        """Evaluate at a point. Used to check the expansion against the
        factored form it replaced, which is how the fix is verified rather than
        asserted."""
        total = 0
        for monomial, coefficient in self.terms:
            value = coefficient
            for name, e in monomial:
                if name not in assignment:
                    raise KeyError(f"no value for variable {name!r}")
                value = value * pow(assignment[name] % self.prime, e, self.prime)
            total = (total + value) % self.prime
        return total % self.prime
