"""Degree of the SHA-256 compression function, and the support-capping that
makes the bound mean something.

The load-bearing tests here are the soundness ones: the propagated bound must
never fall below an exhaustively computed exact degree, on every restricted
window measured. That is falsifiable, and it is the only check on the
propagation rules for modular addition that does not depend on a citation.

The second group documents *why* ``SupportWord`` exists. The naive bound is
sound and vacuous -- it sits at the free-variable ceiling from round one -- and a
test asserts that, so nobody later removes the support tracking on the grounds
that the simpler path "already works".
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from core.sha256 import BLOCK_BITS, FULL_ROUNDS, SHA256Compression
from modules.degree.calibration import sha256_truth as truth
from modules.degree.measure import (
    MeasurementRefused,
    SupportWord,
    derived_upper_bound,
    sha256_bound,
    sha256_support_bound,
)
from verify import packed

ROOT = Path(__file__).resolve().parents[1]
TABLE = ROOT / "modules" / "degree" / "calibration" / "sha256_truth.py"
W0 = SHA256Compression.WORD0_OFFSET


# -- soundness, the falsifiable claim ---------------------------------------


def test_the_recorded_bounds_are_sound_on_every_restricted_window() -> None:
    for row in truth.LOWER_BOUNDS:
        if "exact_degree" not in row:
            continue
        assert int(row["support_bound"]) >= int(row["exact_degree"]), row
        assert int(row["naive_bound"]) >= int(row["exact_degree"]), row
        assert row["sound"] is True, row


@pytest.mark.parametrize("free_bits,rounds", [(8, 1), (8, 4), (10, 2), (10, 64)])
def test_soundness_recomputed_from_scratch(free_bits: int, rounds: int) -> None:
    """Not read off the table: exhausted here, compared here."""
    target = SHA256Compression.create(
        n_rounds=rounds, free_bits=free_bits, free_offset=W0
    )
    columns = packed.pack_truth_table(target, target.n_in, target.n_out)
    exact = max(packed.degree_profile_from_columns(columns, target.n_in))
    assert sha256_support_bound(target).value >= exact
    assert sha256_bound(target).value >= exact


def test_the_restricted_degree_saturates_at_its_own_ceiling() -> None:
    """The substantive measurement: one round is enough to reach full degree in
    any small window of message bits."""
    for row in truth.LOWER_BOUNDS:
        if "exact_degree" not in row:
            continue
        assert row["saturated_at_free_bits"] is True, row
        assert int(row["exact_degree"]) == int(row["free_bits"]), row


def test_a_restriction_gives_a_proven_lower_bound_on_the_full_target() -> None:
    """Restricting variables to constants cannot raise the degree, so the exact
    degree of a window is a lower bound on the unrestricted function."""
    assert truth.proven_lower_bound() == 16
    for row in truth.LOWER_BOUNDS:
        if "exact_degree" not in row:
            continue
        assert int(row["space_fraction_log2"]) == int(row["free_bits"]) - BLOCK_BITS


# -- why SupportWord exists --------------------------------------------------


def test_the_naive_bound_is_vacuous_from_the_first_round() -> None:
    """Sound, and says nothing. If this ever stops holding, the support tracking
    may no longer be earning its keep -- which is worth knowing."""
    for rounds in (1, 2, 4, 8, 16, 32, 64):
        target = SHA256Compression.create(n_rounds=rounds)
        assert sha256_bound(target).value == BLOCK_BITS, rounds


def test_the_support_capped_bound_is_below_the_ceiling_through_16_rounds() -> None:
    for rounds in range(1, 17):
        target = SHA256Compression.create(n_rounds=rounds)
        assert sha256_support_bound(target).value < BLOCK_BITS, rounds


def test_the_support_capped_bound_is_never_looser_than_the_naive_one() -> None:
    for row in truth.UPPER_BOUNDS:
        assert int(row["support_bound"]) <= int(row["naive_bound"]), row


def test_the_support_bound_grows_by_one_word_per_round() -> None:
    """32r - 1 through round 16, then the ceiling. Each round consumes one
    message word, and the top bit's degree comes from a carry that spans all but
    one of the variables below it."""
    for rounds in range(1, 17):
        target = SHA256Compression.create(n_rounds=rounds)
        assert sha256_support_bound(target).value == 32 * rounds - 1, rounds
    for rounds in (17, 24, 32, 64):
        assert sha256_support_bound(SHA256Compression.create(n_rounds=rounds)).value == BLOCK_BITS


def test_zero_rounds_has_degree_zero() -> None:
    """The feed-forward alone is a constant: no message bit has been read."""
    target = SHA256Compression.create(n_rounds=0)
    assert sha256_support_bound(target).value == 0
    assert sha256_bound(target).value == 0


# -- the SupportWord type ----------------------------------------------------


def test_the_cap_is_the_variable_count() -> None:
    """A function of k variables has degree at most k, and the cap enforces it."""
    assert SupportWord._cap(99, 0b1011) == (3, 0b1011)
    assert SupportWord._cap(2, 0b1011) == (2, 0b1011)
    assert SupportWord._cap(5, 0) == (0, 0)


def test_and_sums_degrees_then_caps() -> None:
    a = (1, 0b0001)
    b = (1, 0b0010)
    assert SupportWord._and(a, b) == (2, 0b0011)
    # Same variable on both sides: the union is one variable, so degree 1.
    assert SupportWord._and(a, a) == (1, 0b0001)
    assert SupportWord._and(a, None) is None


def test_xor_takes_the_maximum_and_unions_the_support() -> None:
    assert SupportWord._xor((3, 0b0111), (1, 0b1000)) == (3, 0b1111)
    assert SupportWord._xor(None, (2, 0b0011)) == (2, 0b0011)
    assert SupportWord._xor(None, None) is None


def test_addition_of_variables_grows_the_degree_along_the_word() -> None:
    """The carry chain, which is the whole reason an ARX bound behaves as it
    does: bit i of x + y depends on every operand bit at or below i."""
    x = SupportWord.variables(8, first_index=0)
    y = SupportWord.variables(8, first_index=8)
    total = x + y
    degrees = [b[0] for b in total.bits]
    assert degrees[0] == 1, "the lowest bit is a plain XOR"
    assert degrees == sorted(degrees), "degree cannot fall as the carry advances"
    assert max(degrees) <= 16, "and it cannot exceed the variable count"


def test_adding_a_constant_still_propagates_a_carry() -> None:
    """XOR with a constant is affine; addition is not, and the bound must say so."""
    x = SupportWord.variables(8, first_index=0)
    assert (x ^ 0xFF).degree == 1, "XOR with a constant is affine"
    assert (x + 0xFF).degree > 1, "addition with a constant is not"


def test_a_constant_word_carries_no_variables() -> None:
    word = SupportWord.constant(0b1010, 4)
    assert word.degree == 0
    assert word.support_size == 0
    assert word.bits[0] is None and word.bits[1] == (0, 0)


def test_rotation_stays_tight() -> None:
    """The idiom ``(x >> k) | (x << (w-k))``: the two halves are disjoint, so
    the OR must not be charged as a product."""
    x = SupportWord.variables(16, first_index=0)
    rotated = (x >> 5) | (x << 11)
    assert rotated.degree == 1, "a rotation is a permutation of bits"
    assert rotated.support_size == 16


def test_masking_cannot_raise_a_degree() -> None:
    x = SupportWord.variables(8, first_index=0)
    assert (x & 0x0F).degree == 1
    assert (x & 0x0F).support_size == 4


def test_complement_is_affine() -> None:
    x = SupportWord.variables(8, first_index=0)
    assert (~x).degree == 1
    assert (~SupportWord.constant(0, 4)).degree == 0


def test_width_mismatch_is_refused() -> None:
    with pytest.raises(ValueError, match="width mismatch"):
        _ = SupportWord.variables(8) ^ SupportWord.variables(16)
    with pytest.raises(TypeError, match="cannot combine SupportWord"):
        _ = SupportWord.variables(8) ^ "nope"


# -- dispatch ----------------------------------------------------------------


def test_the_derived_bound_dispatches_for_sha256_and_mimc() -> None:
    from core.mimc import MiMC

    assert derived_upper_bound(SHA256Compression.create(n_rounds=4)).value == 127
    assert derived_upper_bound(MiMC.create(n=9, n_rounds=3)).value >= 0


def test_the_derived_bound_refuses_a_family_with_no_derivation() -> None:
    from core.targets import PowerMap

    with pytest.raises(MeasurementRefused, match="no derived bound exists"):
        derived_upper_bound(PowerMap.create(11, 31))


def test_the_full_target_refuses_an_exact_degree_rather_than_approximating() -> None:
    from modules.degree.measure import exact_degree

    with pytest.raises(MeasurementRefused, match="does not approximate"):
        exact_degree(SHA256Compression.create(n_rounds=1))


# -- regeneration ------------------------------------------------------------


@pytest.mark.slow
def test_the_committed_table_is_byte_equal_to_a_fresh_run() -> None:
    result = subprocess.run(
        [sys.executable, "scripts/sha256_degree.py", "--emit-module"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == TABLE.read_text(), (
        "the committed SHA-256 table is not what a fresh run produces; regenerate "
        "with scripts/sha256_degree.py --emit-module"
    )


def test_the_table_records_the_full_round_count() -> None:
    assert truth.FULL_ROUNDS == FULL_ROUNDS == 64
    assert truth.BLOCK_BITS == BLOCK_BITS == 512
    assert truth.FREE_OFFSET == W0 == 480
    assert truth.support_bound(64) == BLOCK_BITS
