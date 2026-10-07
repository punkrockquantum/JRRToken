"""Benjamini-Hochberg over a pre-registered family, and the two-part rule."""

from __future__ import annotations

import pytest

from stats.bh import (
    BHTest,
    FamilySizeMismatch,
    benjamini_hochberg,
    two_part_acceptance,
)

# A worked step-up example. The critical values are i/m * alpha with m = 15 and
# alpha = 0.05: 0.003333, 0.006667, 0.010000, 0.013333, 0.016667, ...
# The four smallest p-values clear theirs; the fifth (0.0201) does not clear
# 0.016667, and the step-up procedure therefore stops at rank 4.
WORKED_P = [
    0.0001,
    0.0004,
    0.0019,
    0.0095,
    0.0201,
    0.0278,
    0.0298,
    0.0344,
    0.0459,
    0.3240,
    0.4262,
    0.5719,
    0.6528,
    0.7590,
    1.0000,
]


def worked_tests() -> list[BHTest]:
    return [BHTest(label=f"t{i:02d}", p_value=p) for i, p in enumerate(WORKED_P)]


def test_worked_example_rejects_exactly_four() -> None:
    result = benjamini_hochberg(worked_tests(), alpha=0.05, family_size=15)
    assert result.n_rejected == 4
    assert [o.label for o in result.outcomes if o.rejected] == ["t00", "t01", "t02", "t03"]


def test_critical_values_are_i_over_m_times_alpha() -> None:
    result = benjamini_hochberg(worked_tests(), alpha=0.05, family_size=15)
    for outcome in result.outcomes:
        assert outcome.critical_value == pytest.approx(outcome.rank / 15 * 0.05)


def test_q_values_are_monotone() -> None:
    result = benjamini_hochberg(worked_tests(), alpha=0.05, family_size=15)
    q_values = [o.q_value for o in result.outcomes]
    assert q_values == sorted(q_values)
    assert all(0.0 <= q <= 1.0 for q in q_values)


def test_family_size_is_asserted_at_analysis_time() -> None:
    tests = worked_tests()[:10]
    with pytest.raises(FamilySizeMismatch, match="pre-registered family size is 15"):
        benjamini_hochberg(tests, alpha=0.05, family_size=15)


def test_duplicate_labels_are_refused() -> None:
    tests = [BHTest(label="same", p_value=0.01), BHTest(label="same", p_value=0.02)]
    with pytest.raises(FamilySizeMismatch, match="distinct"):
        benjamini_hochberg(tests, alpha=0.05, family_size=2)


def test_two_part_rule_records_a_pass_fail_when_the_effect_is_under_the_floor() -> None:
    result = benjamini_hochberg(worked_tests(), alpha=0.05, family_size=15)
    effects = {o.label: (0.02 if o.label == "t00" else 5.0) for o in result.outcomes}
    outcomes = two_part_acceptance(result, effects, effect_floor=1.0)
    by_label = {o.label: o for o in outcomes}
    assert by_label["t00"].significant is True
    assert by_label["t00"].clears_floor is False
    assert by_label["t00"].accepted is False
    assert by_label["t00"].is_pass_fail is True
    assert by_label["t01"].accepted is True
    assert by_label["t01"].is_pass_fail is False


def test_two_part_rule_requires_effects_for_the_whole_family() -> None:
    result = benjamini_hochberg(worked_tests(), alpha=0.05, family_size=15)
    with pytest.raises(FamilySizeMismatch):
        two_part_acceptance(result, {"t00": 1.0}, effect_floor=1.0)


def test_alpha_must_be_a_probability() -> None:
    with pytest.raises(ValueError):
        benjamini_hochberg(worked_tests(), alpha=1.5, family_size=15)
