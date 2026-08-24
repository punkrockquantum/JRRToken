"""p-value formatting.

Section 8, RESULTS INTEGRITY: "Underflowed p-values print as ``p < 1e-300``,
never ``0.00e+00``."
"""

from __future__ import annotations

#: Below this, double-precision formatting of a p-value is a lie about
#: precision rather than a small number. 1e-300 is the pre-registered floor.
UNDERFLOW_FLOOR = 1e-300


def format_p(p: float) -> str:
    if p != p:  # NaN
        return "p=NaN"
    if p < 0.0 or p > 1.0:
        raise ValueError(f"p-value out of range: {p!r}")
    if p < UNDERFLOW_FLOOR:
        return "p < 1e-300"
    return f"p={p:.6e}"
