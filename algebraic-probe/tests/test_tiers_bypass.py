"""What the tier enforcement does NOT stop, pinned as tests.

Raised by outside review: "in Python the mint-token pattern is a discipline aid,
not a guarantee -- ``object.__new__`` defeats it. Don't let the README imply
otherwise to a reviewer."

That is correct, and this file is the correction. Every test here asserts that a
bypass **succeeds**, so the limitation lives in the test suite rather than only
in prose. If someone later hardens ``tiers/result.py``, these tests fail, and the
failure is the reminder to update the README and DECISIONS.md rather than a
regression to fix.

What the enforcement does stop is every route a person takes by accident or
inattention: constructing a Result directly, assigning a tier after the fact,
upgrading a label, combining tiers, comparing across tiers. What it cannot stop
is code that deliberately reaches around the attribute protocol. In CPython there
is no way to close that from inside the process, so the claim the README makes is
bounded accordingly (D-040).
"""

from __future__ import annotations

import dataclasses

import pytest

from tiers.errors import TierViolation
from tiers.result import Result, enumerated, prove
from tiers.space import EnumeratedSpace
from tiers.tier import Tier

FIELDS = tuple(f.name for f in dataclasses.fields(Result))


def _forge(tier: Tier = Tier.P, **overrides) -> Result:
    """Build a Result without passing through any factory or the mint check."""
    forged = object.__new__(Result)
    values = {
        "tier": tier,
        "metric": "forged_metric",
        "value": 999,
        "provenance": None,
        "target": "forged-target",
        "derivation": "",
        "space": None,
        "distribution": None,
        "payload": {},
        "_mint": None,
    }
    values.update(overrides)
    for field in FIELDS:
        object.__setattr__(forged, field, values[field])
    return forged


# -- what the enforcement does stop -----------------------------------------


def test_the_documented_construction_path_is_refused() -> None:
    """The route a person actually takes is closed, and says why."""
    with pytest.raises(TierViolation, match="minted by tiers.result"):
        Result(
            tier=Tier.P,
            metric="m",
            value=1,
            provenance=None,
            target="t",
            derivation="d",
        )


def test_normal_attribute_assignment_is_refused() -> None:
    result = prove(metric="d", value=3, target="t", derivation="because", provenance=None)
    with pytest.raises(TierViolation, match="never be upgraded or reassigned"):
        result.tier = Tier.E  # type: ignore[misc]
    with pytest.raises(TierViolation):
        result.value = 4  # type: ignore[misc]


# -- what it does not stop, and must not be claimed to -----------------------


def test_object_new_bypasses_the_mint_token() -> None:
    """The bypass named in review. It works, and that is the point of this test."""
    forged = object.__new__(Result)
    assert isinstance(forged, Result)
    # No field is set yet, so the object is inert until someone sets one.
    with pytest.raises(AttributeError):
        _ = forged.tier


def test_object_setattr_bypasses_the_frozen_guard() -> None:
    """``__setattr__`` is overridden; ``object.__setattr__`` goes around it."""
    result = prove(metric="d", value=3, target="t", derivation="because", provenance=None)
    object.__setattr__(result, "value", 10**9)
    assert result.value == 10**9, "the override is not a guarantee against this"


def test_a_tier_p_result_can_be_forged_outright() -> None:
    """The two bypasses together produce a fully-formed Tier P result that never
    went near a derivation, a space or a distribution."""
    forged = _forge(tier=Tier.P)
    assert forged.tier is Tier.P
    assert forged.value == 999
    assert forged.derivation == "", "no deductive argument was supplied or demanded"


def test_a_forged_tier_label_can_be_changed_after_the_fact() -> None:
    """Label immutability is the property section 3 leans on hardest, and it is
    the one ``object.__setattr__`` removes."""
    forged = _forge(tier=Tier.S)
    object.__setattr__(forged, "tier", Tier.P)
    assert forged.tier is Tier.P, "a sampled result relabelled as proven"


def test_the_cross_tier_refusal_still_fires_on_forged_results() -> None:
    """One thing the forgery does not get for free: the comparison guard reads
    the tier at call time, so a forged result of a different tier is still
    refused. The guard is intact; it is the *label* that cannot be trusted."""
    real = enumerated(
        metric="d",
        value=3,
        target="t",
        space=EnumeratedSpace(
            description="all 2^4",
            cardinality=16,
            full_cardinality=16,
            universe_description="the 4-bit input space",
        ),
        provenance=None,
    )
    forged = _forge(tier=Tier.P)
    with pytest.raises(TierViolation):
        _ = forged == real


def test_the_bypass_requires_deliberate_intent() -> None:
    """The honest scope of the claim: the bypass is not something a person does
    by accident. It needs ``object.__new__`` or ``object.__setattr__`` named
    explicitly, neither of which appears anywhere in this repository outside
    this file and the frozen-dataclass machinery itself."""
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[1]
    offenders = []
    for path in root.rglob("*.py"):
        if path.name == "test_tiers_bypass.py" or "__pycache__" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        for needle in ("object.__new__", "object.__setattr__"):
            if needle in text:
                offenders.append((str(path.relative_to(root)), needle))
    allowed = {("tiers/result.py", "object.__setattr__")}
    assert set(offenders) <= allowed, f"unexpected attribute-protocol bypasses: {offenders}"
