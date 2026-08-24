"""Regression tests for defects found by adversarial probing of the skeleton.

Each test names the hole it closes. They are collected in one file because they
share a cause: an integrity rule that was stated in a docstring and enforced
only for the paths the original tests happened to walk.
"""

from __future__ import annotations

import math
from pathlib import Path

import pytest

from core.keccak import KeccakF
from core.mimc import MiMC
from core.targets import InverseMap, LinearMapGF2, PowerMap, RandomFunction
from harness.sweep import Cell, SweepStore
from provenance.store import ResultsLog
from reports.lint import lint_text
from tiers import (
    EnumeratedSpace,
    Provenance,
    SamplingError,
    SeedDistribution,
    TierViolation,
    enumerated,
    prove,
    sampled,
)
from tiers.errors import AppendOnlyViolation, ProbeError

PROV = Provenance(computation_id="REGRESSION")


def a_proof(value: int = 1):
    return prove(metric="m", value=value, target="t", provenance=PROV, derivation="d")


def an_enumeration(value: int = 1):
    return enumerated(
        metric="m",
        value=value,
        target="t",
        provenance=PROV,
        space=EnumeratedSpace(
            description="d", cardinality=2, full_cardinality=4, universe_description="u"
        ),
    )


def a_sample():
    return sampled(
        metric="m",
        target="t",
        provenance=PROV,
        distribution=SeedDistribution(
            seeds=tuple(range(30)), values=tuple(float(i) for i in range(30))
        ),
    )


# ---------------------------------------------------------------------------
# 1. Cross-tier equality answered a question section 3 forbids asking
# ---------------------------------------------------------------------------


def test_cross_tier_equality_raises_rather_than_returning_false() -> None:
    with pytest.raises(TierViolation, match="different tiers"):
        a_proof() == an_enumeration()
    with pytest.raises(TierViolation, match="different tiers"):
        a_proof() != an_enumeration()


def test_cross_tier_membership_raises_too() -> None:
    """`in` uses __eq__, so a mixed-tier container is refused at lookup."""
    with pytest.raises(TierViolation):
        a_proof() in [an_enumeration()]


def test_same_tier_equality_still_works() -> None:
    assert a_proof() == a_proof()
    assert a_proof(1) != a_proof(2)
    assert a_sample() == a_sample()


def test_comparison_against_a_non_result_is_ordinary() -> None:
    assert (a_proof() == 5) is False
    assert (a_proof() != 5) is True


def test_results_remain_hashable() -> None:
    assert isinstance(hash(a_proof()), int)
    assert len({a_proof(), a_proof()}) == 1


# ---------------------------------------------------------------------------
# 2. A "frozen" result whose payload could be edited in place
# ---------------------------------------------------------------------------


def test_the_payload_of_a_minted_result_is_read_only() -> None:
    result = prove(
        metric="m", value=1, target="t", provenance=PROV, derivation="d", payload={"k": 1}
    )
    with pytest.raises(TypeError):
        result.payload["k"] = 999  # type: ignore[index]
    with pytest.raises(TypeError):
        result.payload["new"] = 1  # type: ignore[index]


def test_mutating_the_dict_handed_to_the_factory_does_not_reach_the_result() -> None:
    payload = {"k": [1, 2]}
    result = prove(
        metric="m", value=1, target="t", provenance=PROV, derivation="d", payload=payload
    )
    payload["k"].append(3)
    payload["added"] = True
    assert result.payload["k"] == [1, 2]
    assert "added" not in result.payload


def test_to_dict_hands_out_a_copy_not_the_live_payload() -> None:
    result = prove(
        metric="m", value=1, target="t", provenance=PROV, derivation="d", payload={"k": {"n": 1}}
    )
    serialised = result.to_dict()
    serialised["payload"]["k"]["n"] = 999
    serialised["payload"]["injected"] = True
    assert result.payload["k"]["n"] == 1
    assert "injected" not in result.payload


# ---------------------------------------------------------------------------
# 3. A hash chain does not detect truncation from the end
# ---------------------------------------------------------------------------


def a_closed_log(tmp_path: Path, name: str, n_results: int = 2) -> ResultsLog:
    log = ResultsLog.create(tmp_path / name, {"run_id": name})
    for i in range(n_results):
        log.append({"kind": "result", "v": i})
    log.append({"kind": "run_end", "n_records": n_results + 2})
    log.seal()
    return log


def _drop_last_line(path: Path) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    path.write_text("\n".join(lines[:-1]) + "\n", encoding="utf-8")


def test_dropping_the_run_end_marker_is_detected(tmp_path: Path) -> None:
    log = a_closed_log(tmp_path, "a.jsonl")
    _drop_last_line(log.path)
    with pytest.raises(AppendOnlyViolation, match="truncated or extended"):
        ResultsLog.open(log.path).verify_against_index()


def test_dropping_a_result_before_the_run_end_is_detected(tmp_path: Path) -> None:
    log = a_closed_log(tmp_path, "b.jsonl")
    lines = log.path.read_text(encoding="utf-8").splitlines()
    del lines[2]
    log.path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    with pytest.raises(AppendOnlyViolation):
        ResultsLog.open(log.path)


def test_a_rechained_log_missing_a_record_is_caught_by_the_declared_count(
    tmp_path: Path,
) -> None:
    """The forgery the chain alone cannot see.

    An adversary who removes a record and recomputes every hash after it
    produces a log that verifies end to end. The run_end marker declares how
    long the run was, so the shortened chain contradicts its own closing record.
    """
    forged = ResultsLog.create(tmp_path / "rechained.jsonl", {"run_id": "b"})
    forged.append({"kind": "result", "v": 0})
    # The run declared four records when it closed; this chain holds three.
    forged.append({"kind": "run_end", "n_records": 4})
    with pytest.raises(AppendOnlyViolation, match="records have been removed"):
        ResultsLog.open(forged.path)


def test_truncating_a_log_that_never_got_a_run_end_is_detected_by_the_index(
    tmp_path: Path,
) -> None:
    log = ResultsLog.create(tmp_path / "c.jsonl", {"run_id": "c"})
    log.append({"kind": "result", "v": 1})
    log.append({"kind": "result", "v": 2})
    log.seal()
    _drop_last_line(log.path)
    with pytest.raises(AppendOnlyViolation, match="truncated or extended"):
        ResultsLog.open(log.path).verify_against_index()


def test_a_closed_run_is_not_reopened_for_appending(tmp_path: Path) -> None:
    log = a_closed_log(tmp_path, "d.jsonl")
    reopened = ResultsLog.open(log.path)
    with pytest.raises(AppendOnlyViolation, match="closed run is not reopened"):
        reopened.append({"kind": "result", "v": 99})


def test_an_unsealed_log_reports_that_its_length_is_unverified(tmp_path: Path) -> None:
    log = ResultsLog.create(tmp_path / "e.jsonl", {"run_id": "e"})
    log.append({"kind": "result", "v": 1})
    assert log.verify_against_index() is False


def test_an_intact_closed_log_verifies(tmp_path: Path) -> None:
    log = a_closed_log(tmp_path, "f.jsonl")
    assert ResultsLog.open(log.path).verify_against_index() is True


# ---------------------------------------------------------------------------
# 4. A non-finite value silently corrupted every order statistic
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bad", (float("nan"), float("inf"), float("-inf")))
def test_a_non_finite_seed_value_is_refused(bad: float) -> None:
    with pytest.raises(SamplingError, match="non-finite"):
        SeedDistribution(
            seeds=tuple(range(30)), values=tuple([bad] + [1.0] * 29)
        )


def test_the_refusal_names_the_seed_that_produced_it() -> None:
    values = [1.0] * 30
    values[7] = math.nan
    with pytest.raises(SamplingError, match="seed 7"):
        SeedDistribution(seeds=tuple(range(30)), values=tuple(values))


# ---------------------------------------------------------------------------
# 5. A control target with a wrong stated expected value
# ---------------------------------------------------------------------------


def test_the_zero_exponent_power_map_is_refused() -> None:
    """x^0 is the constant 1, of degree 0, but the wt(d) rule would state 9."""
    with pytest.raises(ValueError, match="must be positive"):
        PowerMap.create(9, 0)
    with pytest.raises(ValueError):
        PowerMap.create(9, -3)


def test_exponents_that_are_multiples_of_the_group_order_still_state_wt_correctly() -> None:
    for exponent in (511, 1022):
        assert PowerMap.create(9, exponent).expected_degree == 9


# ---------------------------------------------------------------------------
# 6. Target arity was a stored field defaulting to zero
# ---------------------------------------------------------------------------


def test_hand_constructed_targets_report_their_real_arity() -> None:
    assert LinearMapGF2(n=4, seed=1, rows=(1, 2, 4, 8)).n_in == 4
    assert LinearMapGF2(n=4, seed=1, rows=(1, 2, 4, 8)).n_out == 4


def test_every_control_reports_a_non_zero_arity() -> None:
    targets = [
        LinearMapGF2.random_invertible(6, 1),
        PowerMap.create(7, 3),
        InverseMap.create(7),
        RandomFunction.create(6, 8, 1),
        KeccakF.create(0, 1),
        MiMC.create(n=9, n_rounds=2),
    ]
    for target in targets:
        assert target.n_in > 0, target.target_id
        assert target.n_out > 0, target.target_id


def test_random_function_arity_distinguishes_input_from_output() -> None:
    target = RandomFunction.create(6, 8, 1)
    assert (target.n_in, target.n_out) == (6, 8)


# ---------------------------------------------------------------------------
# 7. Targets silently truncated an out-of-range input
# ---------------------------------------------------------------------------


def test_every_target_refuses_an_input_wider_than_its_domain() -> None:
    cases = [
        (LinearMapGF2.random_invertible(6, 1), 6),
        (PowerMap.create(7, 3), 7),
        (InverseMap.create(7), 7),
        (RandomFunction.create(6, 8, 1), 6),
        (KeccakF.create(0, 1), 25),
        (MiMC.create(n=9, n_rounds=2), 9),
    ]
    for target, n in cases:
        with pytest.raises(ValueError, match="out of range"):
            target(1 << n)
        with pytest.raises(ValueError, match="out of range"):
            target(-1)


def test_an_out_of_range_input_would_otherwise_alias_onto_a_valid_one() -> None:
    """The failure this closes: the aliased value is a complete, self-consistent,
    wrong answer, and nothing raises."""
    target = KeccakF.create(0, 1)
    with pytest.raises(ValueError):
        target(1 << 25)
    assert target(0) == target(0)


# ---------------------------------------------------------------------------
# 8. The lint missed a phrase wrapped across a line break
# ---------------------------------------------------------------------------


def test_a_forbidden_phrase_split_across_a_line_break_is_caught() -> None:
    assert [h.term for h in lint_text("the margin is as\nexpected at this round")] == [
        "as expected"
    ]


def test_a_forbidden_phrase_with_extra_whitespace_is_caught() -> None:
    assert [h.term for h in lint_text("as  expected")] == ["as expected"]
    assert [h.term for h in lint_text("we\n  conclude nothing")] == ["we conclude"]


def test_a_wrapped_hit_is_reported_on_the_line_it_starts_on() -> None:
    hits = lint_text("clean\nvalue is as\nexpected\n")
    assert len(hits) == 1
    assert hits[0].line_no == 2


def test_a_wrapped_phrase_is_not_double_reported() -> None:
    assert len(lint_text("as expected")) == 1


def test_the_committed_reports_survive_the_stricter_lint() -> None:
    from reports.lint import lint_out_dir

    assert lint_out_dir() == []


# ---------------------------------------------------------------------------
# 9. A partially finished sweep cell was returned without complaint
# ---------------------------------------------------------------------------


def test_reading_a_partly_finished_cell_is_refused_by_default(tmp_path: Path) -> None:
    with SweepStore(tmp_path / "s.sqlite") as store:
        store.declare_plan("P", cell_keys=["c1"], seeds=list(range(50)), family_size=1)
        for seed in range(40):
            store.complete("P", Cell("c1", seed), value=float(seed))
        with pytest.raises(ProbeError, match="40 of 50 planned seeds"):
            store.results("P", "c1")


def test_a_partly_finished_cell_can_be_read_deliberately(tmp_path: Path) -> None:
    with SweepStore(tmp_path / "s.sqlite") as store:
        store.declare_plan("P", cell_keys=["c1"], seeds=list(range(50)), family_size=1)
        for seed in range(40):
            store.complete("P", Cell("c1", seed), value=float(seed))
        seeds, values, _ = store.results("P", "c1", require_complete=False)
        assert len(seeds) == len(values) == 40


def test_a_complete_cell_reads_cleanly(tmp_path: Path) -> None:
    with SweepStore(tmp_path / "s.sqlite") as store:
        store.declare_plan("P", cell_keys=["c1"], seeds=list(range(30)), family_size=1)
        for seed in range(30):
            store.complete("P", Cell("c1", seed), value=float(seed))
        seeds, values, censored = store.results("P", "c1")
        assert len(seeds) == 30
        assert SeedDistribution(seeds=tuple(seeds), values=tuple(values)).n_seeds == 30


def test_reading_an_undeclared_cell_is_refused(tmp_path: Path) -> None:
    with SweepStore(tmp_path / "s.sqlite") as store:
        store.declare_plan("P", cell_keys=["c1"], seeds=[1], family_size=1)
        with pytest.raises(ProbeError, match="not part of the plan"):
            store.results("P", "absent")
