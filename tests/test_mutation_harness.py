"""The mutation harness's own side-effect restoration.

Found the hard way. Mutant ``RPRT-07`` exists to make the report renderer ignore
``--out-dir`` and write into the tracked directory -- that is the defect it
injects. Running the catalogue therefore rewrote five committed reports with a
fresh commit stamp, and although the harness restored the mutated *source*, the
files that mutant caused to be written stayed dirty. A dirty tree falsifies the
provenance of every run executed afterwards (D-033), so the harness now snapshots
those files and puts them back.

These tests drive the snapshot and restore directly rather than reading the
committed reports, so they fail if the restoration is removed.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load_harness():
    """Import scripts/mutation_test.py in-process.

    The module must be registered in ``sys.modules`` before it executes:
    ``@dataclass(slots=True)`` looks its own class's module up there while the
    class body is being processed, and gets ``None`` otherwise.
    """
    name = "_mutation_harness_under_test"
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / "mutation_test.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(name, None)
        raise
    return module


def test_the_snapshot_covers_the_tracked_report_directory() -> None:
    harness = _load_harness()
    snapshot = harness.snapshot_side_effects()
    assert snapshot, "the snapshot must cover something, or it protects nothing"
    names = {path.name for path in snapshot}
    assert "module-registry.txt" in names
    for path, content in snapshot.items():
        assert path.read_bytes() == content


def test_a_rewritten_file_is_restored_and_reported(tmp_path) -> None:
    """The behaviour mutant LAND-09 removes."""
    harness = _load_harness()
    victim = tmp_path / "report.txt"
    victim.write_bytes(b"original")
    snapshot = {victim: b"original"}

    victim.write_bytes(b"rewritten by a mutant's test run")
    restored = harness.restore_side_effects(snapshot)

    assert victim.read_bytes() == b"original"
    assert restored == [str(victim)], "a restored file must be named in the report"



def test_an_untouched_file_is_left_alone_and_not_reported(tmp_path) -> None:
    harness = _load_harness()
    victim = tmp_path / "report.txt"
    victim.write_bytes(b"original")
    assert harness.restore_side_effects({victim: b"original"}) == []


def test_a_deleted_file_is_recreated(tmp_path) -> None:
    harness = _load_harness()
    victim = tmp_path / "report.txt"
    victim.write_bytes(b"original")
    snapshot = {victim: b"original"}
    victim.unlink()

    restored = harness.restore_side_effects(snapshot)
    assert victim.read_bytes() == b"original"
    assert len(restored) == 1


def test_the_side_effect_globs_are_stated_rather_than_implied() -> None:
    harness = _load_harness()
    assert harness.SIDE_EFFECT_GLOBS == ("reports/out/*.txt",)


def test_the_catalogue_anchors_all_still_apply() -> None:
    """A mutant whose anchor has drifted silently stops testing anything.

    ``apply_mutant`` reports that as a non-kill, but only when the catalogue is
    run -- which is slow. This is the same check, fast, and it fails the moment a
    refactor moves the line a mutant targets.
    """
    harness = _load_harness()
    stale = []
    for mutant in harness.CATALOGUE:
        source = (ROOT / mutant.path).read_text(encoding="utf-8")
        occurrences = source.count(mutant.old)
        if occurrences != 1:
            stale.append((mutant.mutant_id, mutant.path, occurrences))
    assert stale == [], f"mutant anchors no longer matching exactly once: {stale}"


def test_every_mutant_changes_something() -> None:
    harness = _load_harness()
    for mutant in harness.CATALOGUE:
        assert mutant.old != mutant.new, mutant.mutant_id


def test_mutant_ids_are_unique() -> None:
    harness = _load_harness()
    ids = [m.mutant_id for m in harness.CATALOGUE]
    assert len(ids) == len(set(ids))


def test_every_layer_meets_the_five_mutant_minimum() -> None:
    """Section 8 requires at least five deliberate defects per layer."""
    harness = _load_harness()
    counts: dict[str, int] = {}
    for mutant in harness.CATALOGUE:
        counts[mutant.layer] = counts.get(mutant.layer, 0) + 1
    below = {layer: n for layer, n in counts.items() if n < 5}
    assert below == {}, below


def test_every_mutant_names_at_least_one_test() -> None:
    harness = _load_harness()
    for mutant in harness.CATALOGUE:
        assert mutant.tests, mutant.mutant_id
        for test in mutant.tests:
            assert (ROOT / test).exists(), (mutant.mutant_id, test)
