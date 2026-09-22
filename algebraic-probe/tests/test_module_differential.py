"""Module 3: differential characteristics, counted and sampled.

The load-bearing test is soundness: the module counts per pair, while
``verify/differential.py`` builds whole rows in one pass, and they must agree.
A disagreement means one of them is wrong.

This is the first module with a Tier S path, so the tests also pin what a
sampled cell is allowed to say: a rate with an interval, never a bare point.
"""

from __future__ import annotations

import pytest

from core.sha256 import SHA256Compression
from core.targets import LinearMapGF2, PowerMap, RandomFunction
from modules.differential.measure import (
    CONFIDENCE,
    MAX_EXACT_DIFFERENTIAL_VARS,
    SEEDS_PER_CELL,
    DifferentialRefused,
    characteristic_steps,
    differential_probability,
    measure,
    sampled_probability,
)
from verify.differential import (
    ddt_row,
    differential_uniformity,
    impossible_differentials,
    max_differential_count,
)

SEEDS = list(range(20260923, 20260923 + SEEDS_PER_CELL))


# -- soundness against the independent path ---------------------------------


@pytest.mark.parametrize(
    "factory,n",
    [
        (lambda: LinearMapGF2.random_invertible(8, 3), 8),
        (lambda: PowerMap.create(9, 3), 9),
        (lambda: PowerMap.create(9, 31), 9),
        (lambda: RandomFunction.create(10, 10, 5), 10),
    ],
)
def test_the_module_count_matches_the_independent_table(factory, n) -> None:
    target = factory()
    for din in (1, 2, 3, (1 << n) - 1):
        row = ddt_row(target, n, din)
        for dout in list(row)[:6]:
            assert differential_probability(target, din, dout).hits == row[dout]
        # and a difference absent from the row must count zero
        absent = next(d for d in range(1 << n) if d not in row)
        assert differential_probability(target, din, absent).hits == 0


def test_the_max_count_matches_the_independent_maximum() -> None:
    target = PowerMap.create(9, 31)
    for din in (1, 5, 100):
        best = max(
            differential_probability(target, din, d).hits for d in range(1 << 9)
        )
        assert best == max_differential_count(target, 9, din)


# -- the forced control ------------------------------------------------------


def test_a_linear_map_has_probability_one_and_zero_and_nothing_between() -> None:
    target = LinearMapGF2.random_invertible(9, 11)
    for din in (1, 4, 255):
        expected = target(0) ^ target(din)
        assert differential_probability(target, din, expected).hits == 1 << 9
        for dout in range(1 << 9):
            hits = differential_probability(target, din, dout).hits
            assert hits in (0, 1 << 9), (din, dout, hits)


# -- the counted properties --------------------------------------------------


def test_counts_are_even_because_pairs_contribute_twice() -> None:
    """(x, x ^ din) yields the same difference from both ends."""
    for target, n in ((PowerMap.create(9, 31), 9), (RandomFunction.create(9, 9, 2), 9)):
        for din in (1, 7):
            for dout, count in ddt_row(target, n, din).items():
                assert count % 2 == 0, (din, dout, count)


def test_x_cubed_is_almost_perfect_nonlinear_at_every_odd_n() -> None:
    """Computed, not cited: uniformity exactly 2 is the definition of APN."""
    for n in (7, 9):
        assert differential_uniformity(PowerMap.create(n, 3), n) == 2


def test_half_the_table_of_x_cubed_is_impossible() -> None:
    n = 7
    target = PowerMap.create(n, 3)
    for din in (1, 3, 64):
        assert impossible_differentials(target, n, n, din) == (1 << (n - 1))


# -- the sampled path --------------------------------------------------------


def test_a_sampled_cell_reports_an_interval_containing_its_rate() -> None:
    target = LinearMapGF2.random_invertible(10, 7)
    outcome = sampled_probability(target, 1, target(0) ^ target(1), SEEDS)
    assert outcome.hits == SEEDS_PER_CELL, "a probability-1 differential hits always"
    assert outcome.ci_low <= outcome.rate <= outcome.ci_high
    assert outcome.interval_excludes_random_level


def test_a_sampled_null_is_reported_as_an_upper_bound_not_a_zero() -> None:
    target = RandomFunction.create(16, 16, 9)
    outcome = sampled_probability(target, 1, 0, SEEDS)
    assert outcome.hits == 0
    assert outcome.rate == 0.0
    assert outcome.ci_low == 0.0
    assert outcome.ci_high > 0.0, "a null must carry what it cannot exclude"
    assert not outcome.interval_excludes_random_level


def test_the_sampled_path_works_where_the_exact_path_refuses() -> None:
    """The 512-bit primary target: 2^512 is not exhaustible, and refusing to
    estimate would leave the module with no path at all.

    The input difference is placed in W[0], at ``WORD0_OFFSET``, because round 0
    consumes that word. The first draft of this test used ``din=1`` and expected
    no hits; block bit 0 lives in W[15], which a 4-round compression never reads,
    so it hit 50/50 instead. That is the same trap ARX-08 pins for the degree
    arm, and the observed behaviour is now asserted in the test below rather than
    being worked around here.
    """
    target = SHA256Compression.create(n_rounds=4)
    din = 1 << SHA256Compression.WORD0_OFFSET
    with pytest.raises(DifferentialRefused, match="does not estimate"):
        differential_probability(target, din, 0)
    outcome = sampled_probability(target, din, 0, SEEDS)
    assert outcome.seeds == SEEDS_PER_CELL
    assert outcome.hits == 0, "a consumed input bit propagates a difference"
    assert outcome.ci_high > 0.0
    assert not outcome.interval_excludes_random_level


def test_an_unread_message_bit_gives_the_zero_difference_with_probability_one() -> None:
    """Measured, and it is not a defect in the module.

    Flipping a bit the compression has not yet read cannot change the output, so
    ``dout=0`` holds on every draw and the interval sits far above the 2^-256
    random level. The cell is reported honestly -- a Tier S rate with an interval
    -- and the thing it detects is a property of the schedule, not of the round
    function: the difference has nowhere to go.

    This is the differential analogue of what M2 measured structurally, and the
    round it flips at is the load-bearing number in the test below.
    """
    for rounds in (4, 15):
        outcome = sampled_probability(
            SHA256Compression.create(n_rounds=rounds), 1, 0, SEEDS
        )
        assert outcome.hits == SEEDS_PER_CELL, rounds
        assert outcome.interval_excludes_random_level
        assert outcome.ci_low > 0.9


def test_the_round_the_difference_starts_propagating_is_the_round_m2_found() -> None:
    """Two modules, two independent paths, one number.

    M2 computes round 16 as the first round at which the union of reachable block
    bits is complete, by closing the schedule recurrence over word indices and
    never evaluating SHA-256. M3 gets the same 16 here by evaluating the
    compression function on sampled pairs and watching when a flipped W[15] bit
    stops being invisible. Neither computation shares code with the other, and a
    disagreement would mean one of them is wrong about the schedule.
    """
    from modules.reach.measure import first_round_reaching_every_word

    propagates_at = next(
        rounds
        for rounds in range(20)
        if sampled_probability(
            SHA256Compression.create(n_rounds=rounds), 1, 0, SEEDS
        ).hits
        == 0
    )
    assert propagates_at == 16
    assert propagates_at == first_round_reaching_every_word()


def test_the_claim_is_made_by_the_interval_and_not_by_the_point_estimate() -> None:
    """The whole reason a Tier S cell carries an interval.

    One hit in fifty on a 6-bit output is a rate of 0.02 against a random level
    of 2^-6 = 0.015625, so the *point estimate* sits above the random level and a
    search that thresholded on it would report an elevated differential. The
    exact Clopper-Pearson lower bound is 0.000506, well below the random level,
    so fifty draws cannot distinguish this cell from chance and the module says
    so. ``interval_excludes_random_level`` must follow the interval.
    """
    target = RandomFunction.create(12, 6, 1)
    outcome = sampled_probability(target, 1, 10, SEEDS)
    assert outcome.hits == 1
    assert outcome.rate > outcome.random_level, "the point estimate clears it"
    assert outcome.ci_low < outcome.random_level, "the interval does not"
    assert not outcome.interval_excludes_random_level


def test_a_sampled_cell_refuses_too_few_or_repeated_seeds() -> None:
    target = LinearMapGF2.random_invertible(8, 1)
    with pytest.raises(DifferentialRefused, match="needs 50 seeds"):
        sampled_probability(target, 1, 0, list(range(10)))
    with pytest.raises(DifferentialRefused, match="must be distinct"):
        sampled_probability(target, 1, 0, [1] * SEEDS_PER_CELL)


def test_the_confidence_is_the_declared_one() -> None:
    assert CONFIDENCE == 0.95
    assert SEEDS_PER_CELL == 50


# -- step counting -----------------------------------------------------------


def test_steps_stop_at_the_random_level() -> None:
    # Random level for an 8-bit output is 2^-8.
    assert characteristic_steps([0.5, 0.25, 0.125], 8) == 3
    assert characteristic_steps([0.5, 2.0**-8, 0.5], 8) == 1, "stops at the floor"
    assert characteristic_steps([2.0**-9], 8) == 0
    assert characteristic_steps([], 8) == 0


def test_step_counting_refuses_a_meaningless_output_width() -> None:
    with pytest.raises(DifferentialRefused, match="n_out must be positive"):
        characteristic_steps([0.5], 0)


# -- refusals ----------------------------------------------------------------


def test_the_zero_input_difference_is_refused() -> None:
    target = LinearMapGF2.random_invertible(8, 1)
    with pytest.raises(DifferentialRefused, match="probability 1 for every"):
        differential_probability(target, 0, 0)
    with pytest.raises(DifferentialRefused, match="zero input difference"):
        sampled_probability(target, 0, 0, SEEDS)


def test_an_out_of_range_difference_is_refused() -> None:
    target = LinearMapGF2.random_invertible(8, 1)
    with pytest.raises(DifferentialRefused, match="not an 8-bit value"):
        differential_probability(target, 1 << 8, 0)
    with pytest.raises(DifferentialRefused, match="not an 8-bit value"):
        differential_probability(target, 1, 1 << 8)


def test_the_exact_guard_is_a_stated_constant_and_refuses_above_it() -> None:
    assert MAX_EXACT_DIFFERENTIAL_VARS == 18
    target = SHA256Compression.create(n_rounds=1)
    with pytest.raises(DifferentialRefused, match="does not estimate"):
        differential_probability(target, 1, 0)


def test_the_dispatch_refuses_an_unknown_quantity() -> None:
    class Case:
        quantity = "something_else"
        parameters: dict = {}

    with pytest.raises(DifferentialRefused, match="no measurement path"):
        measure(LinearMapGF2.random_invertible(8, 1), Case())


# -- the suite ---------------------------------------------------------------


def test_the_controls_pass_and_the_gate_stays_blocked() -> None:
    from modules.differential.calibration.suite import SUITE

    report = SUITE.run_controls(measure)
    assert report.satisfied, report.render()
    status = SUITE.gate()
    assert status.blocked
    assert status.blocking_citations == ("CITE-SHA256-DIFF",)


def test_the_module_has_a_named_anchor_unlike_m2_m4_and_m6() -> None:
    """The distinction E-04 and E-05 turn on: M3 is blocked by an unreachable
    anchor, not by the brief naming none."""
    from modules.differential.calibration.suite import SUITE

    assert not SUITE.allow_missing_ground_truth
    from harness.calibration import CaseKind

    published = [c for c in SUITE.cases if c.kind is CaseKind.PUBLISHED_GROUND_TRUTH]
    assert len(published) == 1
    assert published[0].expectation_provenance.citation_key == "CITE-SHA256-DIFF"
