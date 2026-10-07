"""Energy landscapes with a tunable hierarchy, as evaluable targets.

Why these exist. Module 1 measures algebraic degree over GF(2). Its null is "the
degree has saturated, so no higher-order differential of feasible order
vanishes". That null is a statement about the algebraic normal form of a Boolean
function. It is not a statement about the *geometry of the search landscape*
associated with that function, and the two can come apart: statistical mechanics
describes landscapes whose local statistics are indistinguishable from random
while their global organisation is hierarchical and exploitable.

These targets make that concrete rather than rhetorical. One construction, one
parameter:

    E(x) = sqrt(a) * z_outer(x >> (n - n_outer))  +  sqrt(1 - a) * z_inner(x)

with ``z_outer`` and ``z_inner`` independent standard normals drawn from SHA-256
in counter mode. Two regimes:

  n_outer = 0   a single level. Energies are i.i.d. standard normal across the
                whole hypercube: the Random Energy Model.
  n_outer > 0   two levels. States sharing their top ``n_outer`` bits share an
                energy offset, so the landscape is organised into clusters and
                the overlap between low-energy states is no longer trivial: a
                two-level Generalised Random Energy Model.

Both have variance a + (1 - a) = 1, so E(x) is standard normal *for a random x
under a random seed* in either regime. That is not the same as saying the
empirical density of states over one exhausted hypercube is standard normal, and
the difference matters:

  At a fixed seed the outer term contributes only ``2^n_outer`` distinct draws,
  each shared by a whole block, so the empirical density of states is a mixture
  of ``2^n_outer`` Gaussians with variance ``1 - a`` centred on those draws. Its
  mean fluctuates by order ``sqrt(a / 2^n_outer)``. With 16 clusters that is
  about 0.21, which is visible; with 256 it is about 0.05, which is not.

So the density of states separates the two regimes at small ``n_outer`` and stops
separating as ``n_outer`` grows, because the separation is a finite-cluster
artefact rather than a signature of hierarchy.

The overlap distribution has a blind spot of its own, in the opposite corner. It
is computed over the lowest ``N_LOWEST`` states, and once the clusters are
smaller than that sample the low-energy states are drawn from many different
clusters, so pairs share no block and the overlap falls back to zero even though
the hierarchy is still there by construction. ``scripts/landscape.py`` measures
this: at n = 14 with 1024 clusters of 16 states, the mean overlap returns to the
single-level baseline while the local-minimum count still departs from it by 40%.

The honest summary is that every one of these statistics has a regime in which it
reports "no structure" about a landscape that has structure by construction. That
is the point being demonstrated, and it is demonstrated rather than argued.

The Boolean view. ``__call__`` returns ``floor(Phi(E(x)) * 2^m)``, the energy
pushed through its own CDF and quantised. Phi(E) is uniform on [0,1] in both
regimes, so the Boolean function has the same marginal law either way, and every
output bit depends on ``z_inner(x)`` and therefore on all n input bits. An
attacker who can evaluate the target can evaluate the energy: the landscape is
not side information.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass

from stats.normal import cdf, ppf

#: Domain separation, so these streams cannot collide with the MiMC constants or
#: the RandomFunction target.
DOMAIN = b"algebraic-probe/landscape"

#: Bits drawn from the digest for each uniform. 53 is the mantissa width of a
#: float64, so the uniform is as fine-grained as the arithmetic that consumes it.
UNIFORM_BITS = 53


def _uniform(level: int, seed: int, value: int, width: int) -> float:
    """A uniform on (0,1) from SHA-256, keyed by level, seed and value.

    Offset by a half so it is never exactly 0 or 1, which ``ppf`` refuses.
    """
    payload = (
        DOMAIN
        + level.to_bytes(1, "big")
        + seed.to_bytes(8, "big")
        + width.to_bytes(2, "big")
        + value.to_bytes((width + 7) // 8 or 1, "big")
    )
    digest = hashlib.sha256(payload).digest()
    drawn = int.from_bytes(digest[:8], "big") >> (64 - UNIFORM_BITS)
    return (drawn + 0.5) / float(1 << UNIFORM_BITS)


@dataclass(frozen=True, slots=True)
class HierarchicalEnergy:
    """An energy landscape on {0,1}^n with ``n_outer`` bits of hierarchy."""

    n: int
    n_outer: int
    outer_weight: float
    seed: int
    m: int

    target_id: str = "hierarchical-energy"

    @property
    def n_in(self) -> int:
        return self.n

    @property
    def n_out(self) -> int:
        return self.m

    @staticmethod
    def create(
        n: int,
        *,
        n_outer: int = 0,
        outer_weight: float = 0.0,
        seed: int = 0,
        m: int | None = None,
    ) -> "HierarchicalEnergy":
        if n < 2:
            raise ValueError("n must be at least 2")
        if not 0 <= n_outer < n:
            raise ValueError(
                f"n_outer must be in [0, n); got {n_outer} for n={n}. At n_outer = n "
                "every state is its own cluster and the construction is degenerate"
            )
        if not 0.0 <= outer_weight <= 1.0:
            raise ValueError("outer_weight must be in [0,1]")
        if n_outer == 0 and outer_weight != 0.0:
            raise ValueError(
                "outer_weight is meaningless with no outer bits: n_outer = 0 is the "
                "single-level model and must carry weight 0"
            )
        if n_outer > 0 and outer_weight == 0.0:
            raise ValueError(
                "n_outer > 0 with zero weight is the single-level model wearing a "
                "hierarchy's label; set outer_weight > 0 or n_outer = 0"
            )
        return HierarchicalEnergy(
            n=n,
            n_outer=n_outer,
            outer_weight=outer_weight,
            seed=seed,
            m=n if m is None else m,
        )

    @staticmethod
    def random_energy_model(n: int, seed: int, m: int | None = None) -> "HierarchicalEnergy":
        """REM: i.i.d. standard normal energies, no hierarchy."""
        return HierarchicalEnergy.create(n, n_outer=0, outer_weight=0.0, seed=seed, m=m)

    @staticmethod
    def generalised_random_energy_model(
        n: int, n_outer: int, outer_weight: float, seed: int, m: int | None = None
    ) -> "HierarchicalEnergy":
        """Two-level GREM: states sharing their top ``n_outer`` bits share an offset."""
        return HierarchicalEnergy.create(
            n, n_outer=n_outer, outer_weight=outer_weight, seed=seed, m=m
        )

    # -- the landscape -----------------------------------------------------

    @property
    def n_inner(self) -> int:
        return self.n - self.n_outer

    @property
    def n_clusters(self) -> int:
        """Number of distinct outer blocks. 1 means no hierarchy."""
        return 1 << self.n_outer

    @property
    def is_hierarchical(self) -> bool:
        return self.n_outer > 0 and self.outer_weight > 0.0

    def _check(self, x: int) -> None:
        if not 0 <= x < (1 << self.n):
            raise ValueError(
                f"{self.target_id}: input {x} out of range for {self.n} bits"
            )

    def cluster_of(self, x: int) -> int:
        """The outer block ``x`` belongs to. Always 0 without a hierarchy."""
        self._check(x)
        return x >> self.n_inner if self.n_outer else 0

    def energy(self, x: int) -> float:
        """E(x). Standard normal in both regimes."""
        self._check(x)
        inner = ppf(_uniform(2, self.seed, x, self.n))
        if not self.is_hierarchical:
            return inner
        outer = ppf(_uniform(1, self.seed, self.cluster_of(x), self.n_outer))
        a = self.outer_weight
        return math.sqrt(a) * outer + math.sqrt(1.0 - a) * inner

    def __call__(self, x: int) -> int:
        """The Boolean view: the energy pushed through its own CDF, quantised."""
        u = cdf(self.energy(x))
        value = int(u * (1 << self.m))
        return min(value, (1 << self.m) - 1)

    @property
    def marginal_derivation(self) -> str:
        return (
            "Var(E) = outer_weight + (1 - outer_weight) = 1 in both regimes, and a "
            "weighted sum of independent standard normals whose weights sum in "
            "quadrature to 1 is standard normal, so E is standard normal for a "
            "random state under a random seed"
        )

    @property
    def density_of_states_mean_fluctuation(self) -> float:
        """Expected size of the empirical mean's departure from 0 at a fixed seed.

        The outer term supplies only ``n_clusters`` distinct draws, so the
        empirical mean of E over the exhausted hypercube is
        ``sqrt(outer_weight) * mean(n_clusters draws of N(0,1))``, whose standard
        deviation is ``sqrt(outer_weight / n_clusters)``. This is what makes the
        density of states separate the regimes at small ``n_outer`` and stop
        separating at large ``n_outer``: it is a finite-cluster effect, not a
        signature of hierarchy.
        """
        if not self.is_hierarchical:
            return 0.0
        return math.sqrt(self.outer_weight / self.n_clusters)
