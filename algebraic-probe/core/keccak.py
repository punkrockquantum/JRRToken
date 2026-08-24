"""Keccak-f, parametrised by lane width and round count.

Present as a calibration target: the literature states per-round algebraic
degree bounds for Keccak-f, and the b=25 instance (lane width 1) is small enough
that a degree instrument can be checked against them.

Section 8, VALIDATION: constants are derived from their definitions, not copied
from a table. The rho offsets come from the (x,y) <- (y, 2x+3y) recurrence and
the iota round constants from the 8-bit LFSR; nothing here is transcribed.
Bit-exactness is established by ``sha3_256`` below, which is asserted equal to
``hashlib.sha3_256`` over a committed vector set in tests/test_core_keccak.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

LANES = 25


def _rot(value: int, amount: int, w: int) -> int:
    amount %= w
    if amount == 0:
        return value
    mask = (1 << w) - 1
    return ((value << amount) | (value >> (w - amount))) & mask


@lru_cache(maxsize=None)
def rho_offsets() -> tuple[int, ...]:
    """Offsets from the standard recurrence, starting at (x,y) = (1,0)."""
    offsets = [0] * LANES
    x, y = 1, 0
    for t in range(24):
        offsets[x + 5 * y] = (t + 1) * (t + 2) // 2
        x, y = y, (2 * x + 3 * y) % 5
    return tuple(offsets)


def _lfsr_bit(t: int) -> int:
    """Bit t of the LFSR with feedback polynomial x^8 + x^6 + x^5 + x^4 + 1."""
    t %= 255
    register = 0x01
    for _ in range(t):
        register <<= 1
        if register & 0x100:
            register ^= 0x171
    return register & 1


@lru_cache(maxsize=None)
def round_constants(lane_log2: int, n_rounds: int) -> tuple[int, ...]:
    constants = []
    for i in range(n_rounds):
        rc = 0
        for j in range(lane_log2 + 1):
            if _lfsr_bit(j + 7 * i):
                rc ^= 1 << ((1 << j) - 1)
        constants.append(rc)
    return tuple(constants)


def default_rounds(lane_log2: int) -> int:
    """n_r = 12 + 2*l, the Keccak-f round count for lane width 2^l."""
    return 12 + 2 * lane_log2


def permute(state: list[int], *, lane_log2: int, n_rounds: int) -> list[int]:
    """Apply ``n_rounds`` rounds of Keccak-f to a 25-lane state."""
    if len(state) != LANES:
        raise ValueError("state must have 25 lanes")
    w = 1 << lane_log2
    mask = (1 << w) - 1
    offsets = rho_offsets()
    constants = round_constants(lane_log2, n_rounds)
    a = [lane & mask for lane in state]

    for rnd in range(n_rounds):
        # theta
        c = [a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rot(c[(x + 1) % 5], 1, w) for x in range(5)]
        for x in range(5):
            for y in range(5):
                a[x + 5 * y] ^= d[x]
        # rho and pi
        b = [0] * LANES
        for x in range(5):
            for y in range(5):
                b[y + 5 * ((2 * x + 3 * y) % 5)] = _rot(a[x + 5 * y], offsets[x + 5 * y], w)
        # chi
        for x in range(5):
            for y in range(5):
                a[x + 5 * y] = b[x + 5 * y] ^ ((~b[(x + 1) % 5 + 5 * y]) & b[(x + 2) % 5 + 5 * y])
        # iota
        a[0] ^= constants[rnd]
        a = [lane & mask for lane in a]
    return a


@dataclass(frozen=True, slots=True)
class KeccakF:
    """Keccak-f as an (b -> b)-bit function of a single integer, b = 25 * 2^l."""

    lane_log2: int
    n_rounds: int

    target_id: str = "keccak-f"

    @property
    def n_in(self) -> int:
        return self.width

    @property
    def n_out(self) -> int:
        return self.width

    @staticmethod
    def create(lane_log2: int, n_rounds: int | None = None) -> "KeccakF":
        rounds = default_rounds(lane_log2) if n_rounds is None else n_rounds
        return KeccakF(lane_log2=lane_log2, n_rounds=rounds)

    @property
    def width(self) -> int:
        return LANES << self.lane_log2

    def __call__(self, x: int) -> int:
        if not 0 <= x < (1 << self.width):
            raise ValueError(
                f"{self.target_id}: input {x} out of range for a {self.width}-bit state"
            )
        w = 1 << self.lane_log2
        mask = (1 << w) - 1
        state = [(x >> (i * w)) & mask for i in range(LANES)]
        out = permute(state, lane_log2=self.lane_log2, n_rounds=self.n_rounds)
        value = 0
        for i, lane in enumerate(out):
            value |= lane << (i * w)
        return value

    @property
    def chi_degree(self) -> int:
        """Degree of the only non-linear step. Checked exhaustively in tests."""
        return 2

    @property
    def trivial_degree_bound(self) -> int:
        """deg(chi) = 2 and every other step is GF(2)-linear, so r rounds have
        degree at most 2^r, capped by the maximum for a permutation, width - 1."""
        return min(2**self.n_rounds, self.width - 1)


# ---------------------------------------------------------------------------
# SHA-3, present only to establish bit-exactness of the permutation above
# ---------------------------------------------------------------------------


def _sponge(data: bytes, *, rate_bytes: int, out_bytes: int, suffix: int) -> bytes:
    lane_log2 = 6
    w = 64
    state = [0] * LANES
    padded = bytearray(data)
    padded.append(suffix)
    while len(padded) % rate_bytes != 0:
        padded.append(0x00)
    padded[-1] ^= 0x80

    for offset in range(0, len(padded), rate_bytes):
        block = padded[offset : offset + rate_bytes]
        for i in range(rate_bytes // 8):
            lane = int.from_bytes(block[i * 8 : i * 8 + 8], "little")
            state[i] ^= lane
        state = permute(state, lane_log2=lane_log2, n_rounds=default_rounds(lane_log2))

    out = bytearray()
    while len(out) < out_bytes:
        for i in range(rate_bytes // 8):
            out += state[i].to_bytes(w // 8, "little")
            if len(out) >= out_bytes:
                break
        if len(out) < out_bytes:
            state = permute(state, lane_log2=lane_log2, n_rounds=default_rounds(lane_log2))
    return bytes(out[:out_bytes])


def sha3_256(data: bytes) -> bytes:
    return _sponge(data, rate_bytes=136, out_bytes=32, suffix=0x06)


def shake128(data: bytes, out_bytes: int) -> bytes:
    return _sponge(data, rate_bytes=168, out_bytes=out_bytes, suffix=0x1F)
