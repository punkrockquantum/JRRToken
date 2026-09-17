"""Keccak-f[25] evaluated on all 2^25 inputs at once, as bit-packed columns.

The state of Keccak-f[25] is 25 lanes of one bit. One bit per lane is what makes
this possible: the whole 25-bit state is 25 Boolean values, so the permutation
can be run on 25 *columns* (``verify.packed``) instead of 25 bits, and one pass
evaluates every input in the space.

What is independent here and what is shared. The step wiring -- which lanes theta
sums, where pi sends each lane, which neighbours chi multiplies -- is written out
again in this file, so it is a second reading of the specification and a mistake
in ``core.keccak.permute`` does not propagate here silently.
``tests/test_verify_keccak_columns.py`` asserts the two agree on every input of a
committed sample, which is the check that gives that independence its value. The
rho offsets and iota constants are *imported* from ``core.keccak`` rather than
re-derived: those are already anchored externally, because ``core.keccak.sha3_256``
is asserted bit-equal to ``hashlib.sha3_256``, and re-deriving them here would
add a second derivation to validate rather than a second check.

At lane width 1 two steps degenerate, and this file refuses to run at any other
width rather than carrying the degeneracy as an assumption:

  rho  rotates each lane by an offset taken modulo the lane width, and every
       offset is 0 modulo 1, so rho is the identity.
  theta's D term rotates by 1, likewise the identity.
"""

from __future__ import annotations

from core.keccak import LANES, rho_offsets, round_constants

from .packed import MAX_PACKED_VARS, ExhaustionRefused, full_mask, input_columns

#: Keccak-f[25]: 25 lanes of one bit, so 25 free input bits.
WIDTH = 25


def _require_width_one() -> None:
    """Refuse unless every rho offset really is trivial at lane width 1."""
    offsets = rho_offsets()
    nontrivial = [(i, o) for i, o in enumerate(offsets) if o % 1 != 0]
    if nontrivial:  # pragma: no cover - unreachable, and deliberately checked
        raise AssertionError(
            f"rho is not the identity at lane width 1: offsets {nontrivial}"
        )
    if WIDTH > MAX_PACKED_VARS:  # pragma: no cover - guarded by the constant
        raise ExhaustionRefused(
            f"Keccak-f[{WIDTH}] needs {WIDTH} variables, over the packed guard of "
            f"{MAX_PACKED_VARS}"
        )


def keccak25_columns(n_rounds: int) -> list[int]:
    """The 25 output lanes of ``n_rounds``-round Keccak-f[25], as columns.

    Column ``i`` of the result has bit ``x`` set exactly when output lane ``i``
    of the permutation applied to the 25-bit input ``x`` is 1. Exhaustive: every
    input in [0, 2^25) is accounted for, and nothing is sampled.
    """
    if n_rounds < 0:
        raise ValueError("n_rounds must be non-negative")
    _require_width_one()

    universe = full_mask(WIDTH)
    a = input_columns(WIDTH)
    constants = round_constants(0, n_rounds)

    for rnd in range(n_rounds):
        # theta. c[x] is the parity of column x of the state; d[x] mixes the two
        # neighbouring columns. The rotation by 1 in the general algorithm acts
        # on a one-bit lane and is the identity.
        c = [a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20] for x in range(5)]
        d = [c[(x - 1) % 5] ^ c[(x + 1) % 5] for x in range(5)]
        for x in range(5):
            for y in range(5):
                a[x + 5 * y] ^= d[x]

        # rho and pi. rho is the identity at width 1, so this is pi alone:
        # lane (x, y) moves to (y, 2x + 3y).
        b = [0] * LANES
        for x in range(5):
            for y in range(5):
                b[y + 5 * ((2 * x + 3 * y) % 5)] = a[x + 5 * y]

        # chi, the only non-linear step: one AND per lane, along a row.
        for x in range(5):
            for y in range(5):
                a[x + 5 * y] = b[x + 5 * y] ^ (
                    (universe ^ b[(x + 1) % 5 + 5 * y]) & b[(x + 2) % 5 + 5 * y]
                )

        # iota. At width 1 the round constant is a single bit, so it either
        # complements lane 0 everywhere or does nothing.
        if constants[rnd] & 1:
            a[0] ^= universe

    return a


def evaluate_at(columns: list[int], x: int) -> int:
    """Read the output of the permutation at one input out of the columns.

    Present so the columns can be checked against ``core.keccak.permute``, which
    is what makes the two paths a check on each other rather than two guesses.
    """
    if not 0 <= x < (1 << WIDTH):
        raise ValueError(f"input {x} out of range for a {WIDTH}-bit state")
    value = 0
    for index, column in enumerate(columns):
        if (column >> x) & 1:
            value |= 1 << index
    return value
