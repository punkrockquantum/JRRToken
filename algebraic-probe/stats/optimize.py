"""A small deterministic Nelder-Mead, used by the censored regression fit.

Standard library only (DECISIONS.md D-004). Deterministic: no random restarts,
fixed simplex construction, fixed termination, so a fit is reproducible bit for
bit given the same data.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Sequence


@dataclass(frozen=True, slots=True)
class OptimiseResult:
    x: tuple[float, ...]
    fun: float
    iterations: int
    converged: bool


def nelder_mead(
    f: Callable[[Sequence[float]], float],
    x0: Sequence[float],
    *,
    step: float = 0.1,
    max_iter: int = 20000,
    xtol: float = 1e-10,
    ftol: float = 1e-12,
) -> OptimiseResult:
    n = len(x0)
    if n == 0:
        raise ValueError("x0 must be non-empty")

    def build_simplex() -> list[list[float]]:
        simplex = [list(x0)]
        for i in range(n):
            point = list(x0)
            delta = step * (abs(point[i]) if point[i] != 0.0 else 1.0)
            point[i] += delta
            simplex.append(point)
        return simplex

    simplex = build_simplex()
    values = [f(p) for p in simplex]
    alpha, gamma, rho, sigma = 1.0, 2.0, 0.5, 0.5

    iterations = 0
    converged = False
    for iterations in range(1, max_iter + 1):
        order = sorted(range(n + 1), key=lambda i: values[i])
        simplex = [simplex[i] for i in order]
        values = [values[i] for i in order]

        spread_x = max(
            abs(simplex[i][j] - simplex[0][j]) for i in range(1, n + 1) for j in range(n)
        )
        spread_f = abs(values[-1] - values[0])
        if spread_x <= xtol and spread_f <= ftol:
            converged = True
            break

        centroid = [sum(simplex[i][j] for i in range(n)) / n for j in range(n)]
        worst = simplex[-1]

        reflected = [centroid[j] + alpha * (centroid[j] - worst[j]) for j in range(n)]
        f_reflected = f(reflected)
        if values[0] <= f_reflected < values[-2]:
            simplex[-1], values[-1] = reflected, f_reflected
            continue
        if f_reflected < values[0]:
            expanded = [centroid[j] + gamma * (reflected[j] - centroid[j]) for j in range(n)]
            f_expanded = f(expanded)
            if f_expanded < f_reflected:
                simplex[-1], values[-1] = expanded, f_expanded
            else:
                simplex[-1], values[-1] = reflected, f_reflected
            continue
        contracted = [centroid[j] + rho * (worst[j] - centroid[j]) for j in range(n)]
        f_contracted = f(contracted)
        if f_contracted < values[-1]:
            simplex[-1], values[-1] = contracted, f_contracted
            continue
        best = simplex[0]
        for i in range(1, n + 1):
            simplex[i] = [best[j] + sigma * (simplex[i][j] - best[j]) for j in range(n)]
            values[i] = f(simplex[i])

    best_index = min(range(n + 1), key=lambda i: values[i])
    return OptimiseResult(
        x=tuple(simplex[best_index]),
        fun=values[best_index],
        iterations=iterations,
        converged=converged,
    )
