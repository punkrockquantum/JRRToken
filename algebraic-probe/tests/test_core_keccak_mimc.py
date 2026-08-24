"""Calibration targets: Keccak-f validated bit-exactly, MiMC validated structurally."""

from __future__ import annotations

import hashlib

import pytest

from core.keccak import KeccakF, default_rounds, permute, rho_offsets, round_constants, sha3_256, shake128
from core.mimc import MiMC, standard_rounds
from verify.anf import algebraic_degree

VECTOR_LENGTHS = (0, 1, 2, 55, 135, 136, 137, 200, 271, 272, 300)


def _vector(length: int) -> bytes:
    """Deterministic committed inputs: SHAKE-free, derived from a counter."""
    return bytes((i * 37 + 11) % 256 for i in range(length))


@pytest.mark.parametrize("length", VECTOR_LENGTHS)
def test_sha3_256_is_bit_identical_to_hashlib(length: int) -> None:
    data = _vector(length)
    assert sha3_256(data) == hashlib.sha3_256(data).digest()


@pytest.mark.parametrize("length", (0, 10, 167, 168, 169))
def test_shake128_is_bit_identical_to_hashlib(length: int) -> None:
    data = _vector(length)
    assert shake128(data, 64) == hashlib.shake_128(data).digest(64)


def test_rho_offsets_visit_every_lane_but_the_origin_exactly_once() -> None:
    offsets = rho_offsets()
    assert len(offsets) == 25
    assert offsets[0] == 0
    # The recurrence (x,y) <- (y, 2x+3y) starting at (1,0) has period 24.
    visited = set()
    x, y = 1, 0
    for _ in range(24):
        visited.add((x, y))
        x, y = y, (2 * x + 3 * y) % 5
    assert len(visited) == 24
    assert (0, 0) not in visited


def test_round_constants_are_derived_from_the_lfsr() -> None:
    constants = round_constants(6, 24)
    assert len(constants) == 24
    assert constants[0] == 0x0000000000000001
    assert all(0 <= c < (1 << 64) for c in constants)
    # For lane width 1 only bit 0 of each constant survives.
    narrow = round_constants(0, 12)
    assert all(c in (0, 1) for c in narrow)


def test_default_round_count_follows_12_plus_2l() -> None:
    assert default_rounds(0) == 12
    assert default_rounds(6) == 24


def test_keccak_f25_is_a_permutation_of_its_state_on_a_sample() -> None:
    f = KeccakF.create(lane_log2=0, n_rounds=12)
    sample = [f(x) for x in range(4096)]
    assert len(set(sample)) == 4096
    assert all(0 <= y < (1 << 25) for y in sample)


def test_one_round_keccak_f25_has_degree_two_on_a_declared_subspace() -> None:
    """chi is the only non-linear step and has degree 2, so one round has
    degree exactly 2. Measured on a 12-variable coordinate subspace, the rest of
    the state held at zero -- the space is stated, as a Tier E result must."""
    f = KeccakF.create(lane_log2=0, n_rounds=1)
    restricted = lambda x: f(x)  # noqa: E731 - low 12 bits vary, high 13 are zero
    assert algebraic_degree(restricted, 12, 25) == 2


def test_two_round_keccak_f25_exceeds_degree_two_on_the_same_subspace() -> None:
    f = KeccakF.create(lane_log2=0, n_rounds=2)
    assert algebraic_degree(f, 12, 25) > 2


def test_permute_rejects_a_malformed_state() -> None:
    with pytest.raises(ValueError, match="25 lanes"):
        permute([0] * 24, lane_log2=0, n_rounds=1)


# -- MiMC -------------------------------------------------------------------


def test_mimc_is_a_permutation_over_gf2n() -> None:
    mimc = MiMC.create(n=9, n_rounds=3, seed=0)
    images = {mimc(x) for x in range(512)}
    assert len(images) == 512


def test_mimc_refuses_even_n() -> None:
    with pytest.raises(ValueError, match="not a permutation"):
        MiMC.create(n=8)


def test_mimc_univariate_degree_is_three_to_the_r() -> None:
    for rounds in (1, 2, 3, 4):
        mimc = MiMC.create(n=9, n_rounds=rounds, seed=0)
        assert mimc.univariate_degree == pow(3, rounds, 511)


def test_mimc_standard_round_count_covers_the_field() -> None:
    assert 3 ** standard_rounds(9) >= 1 << 9
    assert 3 ** (standard_rounds(9) - 1) < 1 << 9


def test_mimc_one_round_has_boolean_degree_two() -> None:
    mimc = MiMC.create(n=9, n_rounds=1, seed=0)
    assert algebraic_degree(mimc, 9, 9) == 2


def test_mimc_constants_depend_on_the_seed_and_start_at_zero() -> None:
    a = MiMC.create(n=9, n_rounds=4, seed=0)
    b = MiMC.create(n=9, n_rounds=4, seed=1)
    assert a.constants[0] == 0
    assert a.constants != b.constants
