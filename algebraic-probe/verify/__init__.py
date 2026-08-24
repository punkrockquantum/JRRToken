"""Independently implemented verification paths.

MUST NOT import from ``modules``. The separation is what stops a verification
from becoming a restatement of the thing it verifies (section 7.2); it is
checked by ``scripts/ci_checks.py`` in CI and by tests/test_ci_checks.py.
"""

from .anf import (
    MAX_EXHAUSTIVE_VARS,
    ExhaustionRefused,
    algebraic_degree,
    algebraic_degree_bit,
    degree_from_anf,
    degree_profile,
    derivative_vanishes,
    mobius,
    monomial_present,
    subspace_sum,
    truth_table,
)

__all__ = [
    "ExhaustionRefused",
    "MAX_EXHAUSTIVE_VARS",
    "algebraic_degree",
    "algebraic_degree_bit",
    "degree_from_anf",
    "degree_profile",
    "derivative_vanishes",
    "mobius",
    "monomial_present",
    "subspace_sum",
    "truth_table",
]
