"""Module 6: rotational and rotational-XOR propagation.

The load-bearing test is H1: the closed form over carry cases must equal the
probability counted over every (x, y) pair. ``verify/rotational.py`` shares no
code with the module and counts rather than argues, so a disagreement means the
derivation is wrong -- which is the whole reason a formula is not trusted until
something enumerates it.
"""

from __future__ import annotations

from fractions import Fraction

import pytest

from core.targets import RotateXorConstant
from modules.rx.measure import (
    SEEDS_PER_CELL,
    RotationalRefused,
    addition_probability,
    addition_probability_log2,
    additions_to_random_level,
    linear_propagation,
    measure,
    rotl,
    rx_offset,
    rx_offset_is_constant,
    sampled_propagation,
)
from verify.rotational import (
    addition_propagation_fraction,
    count_addition_propagation,
    count_additions,
    count_function_propagation,
    rx_offsets,
)

SEEDS = list(range(20260923, 20260923 + SEEDS_PER_CELL))


# -- H1: the closed form against the count -----------------------------------


@pytest.mark.parametrize("width", [4, 6, 8])
def test_the_closed_form_equals_the_counted_probability(width: int) -> None:
    """PREREG-M6 H1, at every rotation amount.

    A formula written from a derivation is a claim until something counts it.
    """
    for amount in range(1, width):
        assert addition_probability(width, amount) == addition_propagation_fraction(
            width, amount
        ), (width, amount)


def test_the_counted_probability_is_a_genuine_fraction_of_all_pairs() -> None:
    hits, total = count_addition_propagation(6, 2)
    assert total == 1 << 12
    assert 0 < hits < total, "neither certain nor impossible"
    assert Fraction(hits, total) == addition_probability(6, 2)


# -- H2: the shape of the profile --------------------------------------------


def test_h2_rotation_by_one_is_the_best_case_and_the_middle_is_the_worst() -> None:
    """PREREG-M6 H2, confirmed.

    Registered as a claim about shape, which could have been wrong.
    """
    width = 16
    profile = {r: addition_probability(width, r) for r in range(1, width)}
    best = max(profile, key=lambda r: profile[r])
    worst = min(profile, key=lambda r: profile[r])
    assert profile[1] == profile[width - 1], "the profile is symmetric"
    assert best in (1, width - 1)
    assert worst == width // 2


def test_the_probability_is_never_one_and_never_zero_for_a_real_rotation() -> None:
    for width in (8, 16, 32):
        for amount in range(1, width):
            p = addition_probability(width, amount)
            assert 0 < p < 1, (width, amount)


def test_rotating_by_nothing_is_the_identity_and_propagates_always() -> None:
    assert addition_probability(32, 0) == 1


# -- Tier P: the linear fact -------------------------------------------------


def test_a_rotation_xor_circuit_propagates_with_probability_exactly_one() -> None:
    """Checked exhaustively, not asserted from the algebra alone."""
    assert linear_propagation() == 1
    width = 12
    for amount in range(1, width):
        target = RotateXorConstant.create(width, amount, 0)
        hits, total = count_function_propagation(target, width, amount)
        assert hits == total, amount


def test_a_rotation_invariant_constant_also_propagates_always() -> None:
    """The mechanism turned off: an all-ones constant equals its rotation."""
    width, amount = 12, 5
    constant = RotateXorConstant.rotation_invariant_constant(width, amount)
    target = RotateXorConstant.create(width, amount, constant)
    hits, total = count_function_propagation(target, width, amount)
    assert hits == total
    assert target.expected_rx_offset == 0


# -- the composition ---------------------------------------------------------


def test_the_addition_count_reaches_the_stated_level_and_not_before() -> None:
    width, amount, n_out = 8, 1, 256
    k = additions_to_random_level(width, amount, n_out)
    p = addition_probability(width, amount)
    floor = Fraction(1, 1 << n_out)
    assert p**k <= floor
    assert p ** (k - 1) > floor, "k must be the smallest such count"


def test_the_primary_width_figures_are_what_the_module_reports() -> None:
    """The 32-bit headline, stated so a change to it is visible in a diff."""
    assert addition_probability(32, 1) == Fraction(6442450947, 17179869184)
    assert round(addition_probability_log2(32, 1), 6) == -1.415037
    assert additions_to_random_level(32, 1, 256) == 181


def test_a_probability_of_one_has_no_such_count() -> None:
    with pytest.raises(RotationalRefused, match="never reaches the random level"):
        additions_to_random_level(32, 0, 256)


# -- what SHA-256 actually performs ------------------------------------------


def test_sha256_performs_more_additions_than_the_characteristic_survives() -> None:
    """Measured by instrumenting the real compress, not read off the spec.

    The count crosses the threshold at round 23. Note that Module 5's last
    independent round is also 23: the two computations share no mechanism --
    one counts modular additions, the other closes the message schedule over
    word indices -- and the agreement is a coincidence, recorded here so it is
    not mistaken for a structural fact.
    """
    need = additions_to_random_level(32, 1, 256)
    assert need == 181
    assert count_additions(22) < need <= count_additions(23)
    assert count_additions(64) == 600


def test_the_addition_count_grows_as_the_implementation_does() -> None:
    """Eight for the feed-forward, seven per round, three more once the
    schedule starts deriving words."""
    assert count_additions(0) == 8
    assert count_additions(1) - count_additions(0) == 7
    assert count_additions(17) - count_additions(16) == 10


# -- Tier S ------------------------------------------------------------------


def test_a_sampled_cell_reports_an_interval_containing_its_rate() -> None:
    target = RotateXorConstant.create(16, 3, 0)
    outcome = sampled_propagation(target, 16, 3, SEEDS)
    assert outcome.hits == SEEDS_PER_CELL
    assert outcome.ci_low <= outcome.rate <= outcome.ci_high
    assert outcome.interval_excludes_random_level


def test_a_sampled_null_is_reported_as_an_upper_bound_not_a_zero() -> None:
    target = RotateXorConstant.create(16, 3, 0x00FF)
    outcome = sampled_propagation(target, 16, 3, SEEDS)
    assert outcome.hits == 0
    assert outcome.ci_low == 0.0
    assert outcome.ci_high > 0.0, "a null must carry what it cannot exclude"
    assert not outcome.interval_excludes_random_level


def test_the_sampled_path_agrees_with_the_exhaustive_count() -> None:
    """At a width small enough to enumerate, the estimate must be consistent."""
    target = RotateXorConstant.create(12, 5, 0)
    hits, total = count_function_propagation(target, 12, 5)
    outcome = sampled_propagation(target, 12, 5, SEEDS)
    assert hits / total == 1.0
    assert outcome.rate == 1.0


def test_a_sampled_cell_refuses_too_few_or_repeated_seeds() -> None:
    target = RotateXorConstant.create(16, 3, 0)
    with pytest.raises(RotationalRefused, match="needs 50 seeds"):
        sampled_propagation(target, 16, 3, list(range(10)))
    with pytest.raises(RotationalRefused, match="must be distinct"):
        sampled_propagation(target, 16, 3, [1] * SEEDS_PER_CELL)


# -- the RX offset -----------------------------------------------------------


def test_the_offset_is_zero_exactly_when_the_plain_relation_holds() -> None:
    plain = RotateXorConstant.create(16, 3, 0)
    for x in (0, 1, 0x1234, 0xFFFF):
        assert rx_offset(plain, 16, 3, x) == 0


def test_the_offset_is_a_non_zero_constant_for_a_non_invariant_constant() -> None:
    target = RotateXorConstant.create(16, 3, 0x00FF)
    constant, offset = rx_offset_is_constant(target, 16, 3, list(range(256)))
    assert constant
    assert offset == target.expected_rx_offset != 0
    assert len(rx_offsets(target, 16, 3)) == 1


def test_an_empty_input_list_is_refused_rather_than_called_constant() -> None:
    with pytest.raises(RotationalRefused, match="no inputs"):
        rx_offset_is_constant(RotateXorConstant.create(16, 3, 0), 16, 3, [])


# -- the primitive -----------------------------------------------------------


def test_rotation_is_a_permutation_that_wraps() -> None:
    assert rotl(0b1001, 1, 4) == 0b0011
    assert rotl(1, 0, 8) == 1
    assert rotl(0x80, 1, 8) == 0x01
    assert {rotl(x, 3, 8) for x in range(256)} == set(range(256))


def test_an_impossible_width_or_amount_is_refused() -> None:
    with pytest.raises(RotationalRefused, match="width must be positive"):
        addition_probability(0, 0)
    with pytest.raises(RotationalRefused, match="outside"):
        addition_probability(8, 8)


# -- the dispatch ------------------------------------------------------------


def test_the_dispatch_refuses_an_unknown_quantity() -> None:
    class Case:
        quantity = "something_else"
        parameters: dict = {}

    with pytest.raises(RotationalRefused, match="no measurement path"):
        measure(RotateXorConstant.create(16, 3, 0), Case())


# -- the suite ---------------------------------------------------------------


def test_the_controls_pass_and_the_gate_stays_blocked_without_an_anchor() -> None:
    from modules.rx.calibration.suite import SUITE

    report = SUITE.run_controls(measure)
    assert report.satisfied, report.render()
    assert SUITE.gate().blocked


def test_the_module_has_no_anchor_like_m2_and_m4_and_unlike_m3_and_m5() -> None:
    """The E-05 class, asserted rather than left in prose."""
    from modules.rx.calibration.suite import SUITE

    assert SUITE.allow_missing_ground_truth
    assert "E-05" in SUITE.missing_ground_truth_reason
    from modules.rx.citations import CITATIONS

    assert CITATIONS.citations == ()


def test_the_boundary_between_reaching_and_passing_the_level_is_exact() -> None:
    """A branch no derived probability can reach, reached deliberately.

    Every probability this module derives is non-dyadic, so ``p ** k`` never
    lands exactly on ``2 ** -n``, and the choice between "falls to" and "falls
    below" the level changed no output any caller could obtain. With p = 1/2
    and a 4-bit level the boundary is exact: p^4 == 2^-4, so the smallest k
    that *reaches* the level is 4, and a loop that continued while equal would
    say 5.
    """
    assert additions_to_random_level(8, 1, 4, probability=Fraction(1, 2)) == 4
    assert additions_to_random_level(8, 1, 8, probability=Fraction(1, 2)) == 8


def test_the_derived_probabilities_never_land_on_the_boundary() -> None:
    """Why the override above is needed rather than a cleverer target."""
    for width in (4, 8, 16, 32):
        for amount in range(1, width):
            numerator = addition_probability(width, amount).numerator
            assert numerator & (numerator - 1) != 0, (width, amount)


def test_the_probability_profile_is_symmetric_in_the_split() -> None:
    """p(w, r) == p(w, w - r), because the closed form is symmetric in the two
    parts the rotation cuts the word into. Asserted because it makes a whole
    class of mutation equivalent, which is worth knowing rather than
    rediscovering (D-058)."""
    for width in (8, 16, 32):
        for amount in range(1, width):
            assert addition_probability(width, amount) == addition_probability(
                width, width - amount
            )


def test_the_tier_s_claim_is_made_by_the_interval_not_the_point_estimate() -> None:
    """The straddling cell, again.

    Module 3 needed one of these (D-051) and so does this module: a mutant
    replacing ``ci_low`` with ``rate`` survived every sampled test here,
    because each sat at 0 hits or at 50, where the point estimate and the
    interval bound fall on the same side of the random level.

    One hit in fifty is a rate of 0.02. Against an 8-bit output the random
    level is 2^-8 = 0.0039, so the point estimate clears it while the exact
    Clopper-Pearson lower bound, 0.000506, does not. Fifty draws cannot
    separate this cell from chance, and the module must say so.
    """

    def sparse(x: int) -> int:
        return x if x % 34 == 0 else (x ^ 1)

    outcome = sampled_propagation(sparse, 16, 3, SEEDS, n_out=8)
    assert outcome.hits == 1
    assert outcome.rate > outcome.random_level, "the point estimate clears it"
    assert outcome.ci_low < outcome.random_level, "the interval does not"
    assert not outcome.interval_excludes_random_level
