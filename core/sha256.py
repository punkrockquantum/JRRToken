"""Round-parametrised SHA-256 compression function. The primary target.

Authorisation. The brief directed that the validated parametrised core from
``sha256-testbed`` be vendored rather than rewritten. That repository is not
reachable from this session (E-03), and the operator has authorised a fresh
implementation here with its validation committed. Three of the four
preconditions this module previously listed apply unchanged and are met below;
the fourth -- recording the upstream commit id of vendored code -- does not
apply to an implementation written here, and is replaced by the authorisation
record in DECISIONS.md D-041.

  met  the FIPS 180-4 validation runs in this repository
       (``tests/test_core_sha256.py``) and its outcome is committed
  met  bit-identity with ``hashlib.sha256`` at 64 rounds over a committed vector
       set, plus every length from 0 to 200 bytes and the block-boundary cases
  met  no constant is transcribed: see below
  n/a  upstream commit id -- superseded by D-041

Section 8, VALIDATION: constants are derived from their definitions, not copied
from a table, exactly as ``core/keccak.py`` derives the rho offsets and the iota
LFSR. FIPS 180-4 defines

  K[i]  the first 32 bits of the fractional part of the cube root of the i-th prime
  H[i]  the first 32 bits of the fractional part of the square root of the i-th prime

and both are computed here in exact integer arithmetic -- no floating point, so
there is no rounding to argue about. ``hashlib`` then validates the derivation:
if a constant were wrong the digests would not match.

Parametrisation. ``compress`` takes a round count in [0, 64]. At 64 it is
SHA-256's compression function; below it, the reduced-round target the degree
module measures. The message schedule is computed for as many words as the round
count needs and no more, so a reduced-round target does not secretly depend on
schedule words it never uses.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

MASK32 = 0xFFFFFFFF
WORD_BITS = 32
BLOCK_BITS = 512
STATE_WORDS = 8
FULL_ROUNDS = 64

TARGET_ID = "sha256-compression-parametrised"


# ---------------------------------------------------------------------------
# Constants, derived
# ---------------------------------------------------------------------------


def _primes(count: int) -> tuple[int, ...]:
    """The first ``count`` primes, by trial division."""
    found: list[int] = []
    candidate = 2
    while len(found) < count:
        if all(candidate % p for p in found if p * p <= candidate):
            found.append(candidate)
        candidate += 1
    return tuple(found)


def _icbrt(n: int) -> int:
    """Exact integer cube root: the largest r with r**3 <= n."""
    if n < 0:
        raise ValueError("n must be non-negative")
    if n == 0:
        return 0
    # Newton from a safe over-estimate, then correct exactly.
    r = 1 << ((n.bit_length() + 2) // 3 + 1)
    while True:
        nxt = (2 * r + n // (r * r)) // 3
        if nxt >= r:
            break
        r = nxt
    while r * r * r > n:
        r -= 1
    while (r + 1) ** 3 <= n:
        r += 1
    return r


def _fractional_bits_of_root(prime: int, degree: int) -> int:
    """First 32 bits of the fractional part of ``prime ** (1/degree)``.

    ``floor(a * 2^32) = floor(a) * 2^32 + floor(frac(a) * 2^32)`` for a positive
    real ``a``, and the second term is below 2^32, so reducing the scaled integer
    root modulo 2^32 yields the fractional bits exactly.
    """
    if degree == 2:
        scaled = math.isqrt(prime << (2 * WORD_BITS))
    elif degree == 3:
        scaled = _icbrt(prime << (3 * WORD_BITS))
    else:  # pragma: no cover - only the two FIPS cases exist
        raise ValueError(f"unsupported root degree {degree}")
    return scaled & MASK32


def round_constants() -> tuple[int, ...]:
    """K[0..63]: cube roots of the first 64 primes."""
    return tuple(_fractional_bits_of_root(p, 3) for p in _primes(FULL_ROUNDS))


def initial_hash() -> tuple[int, ...]:
    """H[0..7]: square roots of the first 8 primes."""
    return tuple(_fractional_bits_of_root(p, 2) for p in _primes(STATE_WORDS))


K = round_constants()
IV = initial_hash()


# ---------------------------------------------------------------------------
# The compression function
# ---------------------------------------------------------------------------


def _rotr(value: int, amount: int) -> int:
    amount %= WORD_BITS
    if amount == 0:
        return value & MASK32
    return ((value >> amount) | (value << (WORD_BITS - amount))) & MASK32


def _shr(value: int, amount: int) -> int:
    return (value & MASK32) >> amount


def big_sigma_0(x: int) -> int:
    return _rotr(x, 2) ^ _rotr(x, 13) ^ _rotr(x, 22)


def big_sigma_1(x: int) -> int:
    return _rotr(x, 6) ^ _rotr(x, 11) ^ _rotr(x, 25)


def small_sigma_0(x: int) -> int:
    return _rotr(x, 7) ^ _rotr(x, 18) ^ _shr(x, 3)


def small_sigma_1(x: int) -> int:
    return _rotr(x, 17) ^ _rotr(x, 19) ^ _shr(x, 10)


def ch(x: int, y: int, z: int) -> int:
    """Choice. Written as the FIPS expression, not an optimised equivalent."""
    return (x & y) ^ ((~x & MASK32) & z)


def maj(x: int, y: int, z: int) -> int:
    return (x & y) ^ (x & z) ^ (y & z)


def message_schedule(words: list[int], n_rounds: int) -> list[int]:
    """W[0..n_rounds-1]. Only as many words as the round count needs.

    W[t] = W[t-16] + sigma0(W[t-15]) + W[t-7] + sigma1(W[t-2]) for t >= 16.
    """
    if len(words) != 16:
        raise ValueError("a block is 16 words")
    if not 0 <= n_rounds <= FULL_ROUNDS:
        raise ValueError(f"n_rounds must be in [0, {FULL_ROUNDS}]")
    schedule = [w & MASK32 for w in words]
    for t in range(16, n_rounds):
        schedule.append(
            (
                schedule[t - 16]
                + small_sigma_0(schedule[t - 15])
                + schedule[t - 7]
                + small_sigma_1(schedule[t - 2])
            )
            & MASK32
        )
    return schedule[:n_rounds] if n_rounds <= 16 else schedule


def compress(
    words: list[int], state: tuple[int, ...] | list[int] = IV, n_rounds: int = FULL_ROUNDS
) -> tuple[int, ...]:
    """``n_rounds`` rounds of the SHA-256 compression function.

    Returns the eight-word chaining value after the Davies-Meyer feed-forward.
    """
    if len(state) != STATE_WORDS:
        raise ValueError("the state is eight words")
    if not 0 <= n_rounds <= FULL_ROUNDS:
        raise ValueError(f"n_rounds must be in [0, {FULL_ROUNDS}]")

    schedule = message_schedule(list(words), n_rounds)
    a, b, c, d, e, f, g, h = (w & MASK32 for w in state)

    for t in range(n_rounds):
        t1 = (h + big_sigma_1(e) + ch(e, f, g) + K[t] + schedule[t]) & MASK32
        t2 = (big_sigma_0(a) + maj(a, b, c)) & MASK32
        h, g, f, e = g, f, e, (d + t1) & MASK32
        d, c, b, a = c, b, a, (t1 + t2) & MASK32

    return tuple(
        (x + y) & MASK32 for x, y in zip((a, b, c, d, e, f, g, h), state)
    )


# ---------------------------------------------------------------------------
# The full hash, present only to establish bit-identity with hashlib
# ---------------------------------------------------------------------------


def sha256(data: bytes) -> bytes:
    """Merkle-Damgard over the compression function above."""
    padded = bytearray(data)
    padded.append(0x80)
    while len(padded) % 64 != 56:
        padded.append(0x00)
    padded += (len(data) * 8).to_bytes(8, "big")

    state = IV
    for offset in range(0, len(padded), 64):
        block = padded[offset : offset + 64]
        words = [int.from_bytes(block[i * 4 : i * 4 + 4], "big") for i in range(16)]
        state = compress(words, state, FULL_ROUNDS)
    return b"".join(w.to_bytes(4, "big") for w in state)


# ---------------------------------------------------------------------------
# The target
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class SHA256Compression:
    """The compression function as a (free message bits -> 256)-bit map.

    The chaining value is fixed to the IV, as PREREG-M1 declares, so the free
    input is the 512-bit message block. ``free_bits`` and ``free_offset``
    restrict that for the exhaustive arm: block bits
    ``[free_offset, free_offset + free_bits)`` vary and the rest are held at
    ``fixed_block``. A restricted target is honest about its space --
    ``space_fraction`` reports what fraction of the full 2^512 domain it covers,
    which is what a Tier E result must print alongside its value.

    ``free_offset`` matters more than it looks. Message word ``i`` occupies block
    bits ``[32*(15-i), 32*(15-i)+32)``, and word ``t`` is not consumed until
    round ``t``. Leaving the free window at offset 0 puts every free variable in
    W[15], so a reduced-round target does not depend on its own input at all and
    every degree is 0 -- true, and useless as a check. Offset 480 puts the window
    in W[0], which round 0 consumes.
    """

    n_rounds: int
    free_bits: int = BLOCK_BITS
    fixed_block: int = 0
    free_offset: int = 0

    target_id: str = TARGET_ID

    #: Block bit offset of message word W[0]; the first word any round consumes.
    WORD0_OFFSET = BLOCK_BITS - WORD_BITS

    @staticmethod
    def create(
        n_rounds: int = FULL_ROUNDS,
        free_bits: int = BLOCK_BITS,
        fixed_block: int = 0,
        free_offset: int = 0,
    ) -> "SHA256Compression":
        if not 0 <= n_rounds <= FULL_ROUNDS:
            raise ValueError(f"n_rounds must be in [0, {FULL_ROUNDS}]")
        if not 1 <= free_bits <= BLOCK_BITS:
            raise ValueError(f"free_bits must be in [1, {BLOCK_BITS}]")
        if not 0 <= fixed_block < (1 << BLOCK_BITS):
            raise ValueError("fixed_block must be a 512-bit value")
        if not 0 <= free_offset <= BLOCK_BITS - free_bits:
            raise ValueError(
                f"free_offset must be in [0, {BLOCK_BITS} - free_bits]; the window "
                "must lie inside the block"
            )
        return SHA256Compression(
            n_rounds=n_rounds,
            free_bits=free_bits,
            fixed_block=fixed_block,
            free_offset=free_offset,
        )

    @property
    def n_in(self) -> int:
        return self.free_bits

    @property
    def n_out(self) -> int:
        return STATE_WORDS * WORD_BITS

    @property
    def full_space_bits(self) -> int:
        """Width of the unrestricted input space, so a Tier E result on a
        restricted window can print what fraction of the universe it covers."""
        return BLOCK_BITS

    @property
    def space_fraction(self) -> float:
        """Fraction of the full message space this parametrisation covers."""
        return 2.0 ** (self.free_bits - BLOCK_BITS)

    @property
    def is_restricted(self) -> bool:
        return self.free_bits < BLOCK_BITS

    @property
    def free_mask(self) -> int:
        """Block bits that vary."""
        return ((1 << self.free_bits) - 1) << self.free_offset

    def block_for(self, x: int) -> int:
        """The full 512-bit block for a free-input value ``x``."""
        if not 0 <= x < (1 << self.free_bits):
            raise ValueError(
                f"{self.target_id}: input {x} out of range for {self.free_bits} free bits"
            )
        window = self.free_mask
        keep = ~window & ((1 << BLOCK_BITS) - 1)
        return (self.fixed_block & keep) | (x << self.free_offset)

    def __call__(self, x: int) -> int:
        block = self.block_for(x)
        words = [(block >> (WORD_BITS * (15 - i))) & MASK32 for i in range(16)]
        out = compress(words, IV, self.n_rounds)
        value = 0
        for i, word in enumerate(out):
            value |= word << (WORD_BITS * (STATE_WORDS - 1 - i))
        return value

    @property
    def trivial_degree_bound(self) -> int:
        """No useful closed form. Unlike Keccak, whose only non-linear step has
        degree 2, SHA-256's non-linearity is modular addition, whose carry chain
        makes the per-bit degree depend on bit position. The bound is propagated
        rather than stated; see modules/degree/measure.py."""
        raise NotImplementedError(
            "SHA-256 has no trivial per-round degree bound: modular addition's "
            "carry chain gives a position-dependent degree, so the bound is "
            "propagated through the operations rather than asserted"
        )
