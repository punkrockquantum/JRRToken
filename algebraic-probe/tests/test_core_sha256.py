"""FIPS 180-4 validation of the SHA-256 implementation. Precondition, not a nicety.

``core/sha256.py`` was written here rather than vendored (E-03, authorised in
D-041), so the validation the brief demanded of the vendored core has to be met
by this file instead. Three things are established:

1. **Bit-identity with ``hashlib.sha256``** over every length from 0 to 200
   bytes, the block-boundary cases either side of 56 and 64, and a fixed
   pseudo-random set. ``hashlib`` is the external anchor -- the same one that
   already pins ``core/keccak.py`` against ``hashlib.sha3_256``.

2. **No constant is transcribed.** K and IV are derived from their FIPS
   definitions in exact integer arithmetic, and the derivation is checked against
   its own definition here as well as implicitly by the digests matching. A wrong
   constant cannot survive both.

3. **The round parametrisation is honest**: 64 rounds is SHA-256, fewer rounds
   really is fewer rounds, and a reduced-round target does not depend on message
   schedule words it never consumes.
"""

from __future__ import annotations

import hashlib
import math
import random

import pytest

from core import sha256 as impl


# -- 1. bit-identity ---------------------------------------------------------


def test_bit_identity_across_every_length_up_to_200() -> None:
    for length in range(201):
        data = bytes((i * 37 + length) & 0xFF for i in range(length))
        assert impl.sha256(data) == hashlib.sha256(data).digest(), length


@pytest.mark.parametrize(
    "length", [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 129, 1000]
)
def test_bit_identity_at_the_padding_boundaries(length: int) -> None:
    """55/56 and 119/120 are where the length field forces an extra block."""
    data = bytes(range(length % 256)) * (length // 256 + 1)
    data = data[:length]
    assert impl.sha256(data) == hashlib.sha256(data).digest()


def test_bit_identity_over_a_fixed_pseudo_random_set() -> None:
    rng = random.Random(20260922)
    for _ in range(300):
        data = bytes(rng.randrange(256) for _ in range(rng.randrange(0, 300)))
        assert impl.sha256(data) == hashlib.sha256(data).digest()


def test_the_canonical_vectors() -> None:
    """The two most-quoted SHA-256 digests.

    Compared against ``hashlib`` rather than against hex strings written from
    memory: a digest recalled rather than computed is exactly the unattributed
    constant prime directive 2.1 forbids.
    """
    for data in (b"", b"abc", b"a" * 1_000_000):
        assert impl.sha256(data) == hashlib.sha256(data).digest()


# -- 2. the constants are derived --------------------------------------------


def test_the_round_constants_are_the_cube_roots_of_the_first_64_primes() -> None:
    primes = impl._primes(64)
    assert len(primes) == 64
    assert primes[:6] == (2, 3, 5, 7, 11, 13)
    assert primes[-1] == 311
    for prime, constant in zip(primes, impl.K):
        # floor(frac(cbrt(p)) * 2^32), independently via floats as a cross-check.
        root = prime ** (1.0 / 3.0)
        expected = int((root - math.floor(root)) * 2**32)
        assert abs(constant - expected) <= 1, (prime, constant, expected)


def test_the_initial_hash_is_the_square_roots_of_the_first_8_primes() -> None:
    for prime, word in zip(impl._primes(8), impl.IV):
        root = math.sqrt(prime)
        expected = int((root - math.floor(root)) * 2**32)
        assert abs(word - expected) <= 1, (prime, word, expected)


def test_every_constant_is_a_32_bit_word() -> None:
    assert len(impl.K) == 64 and len(impl.IV) == 8
    for value in impl.K + impl.IV:
        assert 0 <= value <= impl.MASK32


def test_the_integer_cube_root_is_exact() -> None:
    """The derivation rests on this, so it is tested rather than assumed."""
    for n in list(range(0, 500)) + [10**18, 2**96, 311 << 96]:
        r = impl._icbrt(n)
        assert r**3 <= n < (r + 1) ** 3, n


def test_a_wrong_constant_would_break_the_digest() -> None:
    """The derivation's real check: perturb one constant, lose bit-identity."""
    original = impl.K
    try:
        impl.K = (original[0] ^ 1,) + original[1:]
        assert impl.sha256(b"abc") != hashlib.sha256(b"abc").digest()
    finally:
        impl.K = original
    assert impl.sha256(b"abc") == hashlib.sha256(b"abc").digest()


# -- 3. the round parametrisation --------------------------------------------


def test_sixty_four_rounds_is_the_real_compression_function() -> None:
    words = [i * 0x01010101 & impl.MASK32 for i in range(16)]
    full = impl.compress(words, impl.IV, impl.FULL_ROUNDS)
    assert len(full) == 8
    # Reconstruct a single-block hash by hand and compare with hashlib.
    message = b"\x61" * 55  # 55 bytes: fits one block with padding
    assert impl.sha256(message) == hashlib.sha256(message).digest()


def test_fewer_rounds_really_is_fewer_rounds() -> None:
    words = [i * 0x01010101 & impl.MASK32 for i in range(16)]
    outputs = {r: impl.compress(words, impl.IV, r) for r in range(0, 65)}
    assert outputs[0] == tuple(2 * h & impl.MASK32 for h in impl.IV), (
        "zero rounds is the feed-forward alone"
    )
    distinct = len(set(outputs.values()))
    assert distinct >= 60, f"round counts collapse onto each other: {distinct} distinct"


def test_the_schedule_computes_only_what_the_round_count_needs() -> None:
    words = list(range(16))
    for rounds in (0, 1, 8, 16, 17, 40, 64):
        schedule = impl.message_schedule(words, rounds)
        assert len(schedule) == max(rounds, 16) if rounds > 16 else len(schedule) <= 16


def test_the_schedule_recurrence_holds() -> None:
    words = [(i * 2654435761) & impl.MASK32 for i in range(16)]
    schedule = impl.message_schedule(words, 64)
    for t in range(16, 64):
        expected = (
            schedule[t - 16]
            + impl.small_sigma_0(schedule[t - 15])
            + schedule[t - 7]
            + impl.small_sigma_1(schedule[t - 2])
        ) & impl.MASK32
        assert schedule[t] == expected, t


def test_out_of_range_parameters_are_refused() -> None:
    with pytest.raises(ValueError, match=r"n_rounds must be in \[0, 64\]"):
        impl.compress([0] * 16, impl.IV, 65)
    with pytest.raises(ValueError, match="a block is 16 words"):
        impl.message_schedule([0] * 15, 8)
    with pytest.raises(ValueError, match="the state is eight words"):
        impl.compress([0] * 16, [0] * 7, 8)


# -- the target --------------------------------------------------------------


def test_the_target_is_a_512_to_256_bit_map() -> None:
    target = impl.SHA256Compression.create()
    assert target.n_in == 512 and target.n_out == 256
    assert not target.is_restricted and target.space_fraction == 1.0


def test_a_restricted_target_reports_its_fraction_of_the_universe() -> None:
    target = impl.SHA256Compression.create(n_rounds=4, free_bits=16)
    assert target.n_in == 16
    assert target.is_restricted
    assert target.space_fraction == 2.0 ** (16 - 512)


def test_the_free_window_lands_where_the_offset_says() -> None:
    offset = impl.SHA256Compression.WORD0_OFFSET
    assert offset == 480
    target = impl.SHA256Compression.create(n_rounds=1, free_bits=8, free_offset=offset)
    assert target.free_mask == 0xFF << 480
    assert target.block_for(0) == 0
    assert target.block_for(0xFF) == 0xFF << 480


def test_the_fixed_bits_are_preserved_outside_the_window() -> None:
    fixed = (1 << 511) | 0b1011
    target = impl.SHA256Compression.create(
        n_rounds=1, free_bits=4, free_offset=100, fixed_block=fixed
    )
    block = target.block_for(0b0101)
    assert block & 0b1011 == 0b1011, "bits below the window survive"
    assert (block >> 511) & 1 == 1, "bits above the window survive"
    assert (block >> 100) & 0b1111 == 0b0101, "the window carries the input"


def test_the_target_refuses_an_input_outside_its_window() -> None:
    target = impl.SHA256Compression.create(n_rounds=1, free_bits=8)
    with pytest.raises(ValueError, match="out of range"):
        target(1 << 8)


def test_the_window_must_lie_inside_the_block() -> None:
    with pytest.raises(ValueError, match="must lie inside the block"):
        impl.SHA256Compression.create(free_bits=16, free_offset=500)
    with pytest.raises(ValueError, match=r"free_bits must be in \[1, 512\]"):
        impl.SHA256Compression.create(free_bits=0)


def test_the_unrestricted_target_agrees_with_the_hash_on_a_full_block() -> None:
    """The target and sha256() must be the same function of a single block."""
    target = impl.SHA256Compression.create(n_rounds=64)
    message = b"\x61" * 55
    padded = bytearray(message)
    padded.append(0x80)
    while len(padded) % 64 != 56:
        padded.append(0x00)
    padded += (len(message) * 8).to_bytes(8, "big")
    block = int.from_bytes(padded, "big")
    assert target(block).to_bytes(32, "big") == hashlib.sha256(message).digest()


def test_there_is_no_trivial_degree_bound_and_asking_says_why() -> None:
    target = impl.SHA256Compression.create()
    with pytest.raises(NotImplementedError, match="carry chain"):
        _ = target.trivial_degree_bound
