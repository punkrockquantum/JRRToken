"""Section 8: the runner that stamps a pre-registration was committed before it.

"Verify, and assert in a test, that the runner code performing that embedding was
itself committed before the pre-registration it references. Otherwise the chain
has a hole."

The assertion is on git ancestry, not on timestamps. Both commits are in this
branch's history: the runner in the infrastructure commit, the pre-registration
in the commit after it.
"""

from __future__ import annotations

import pytest

from harness.runner import RUNNER_RELPATH
from modules.degree.spec import PREREG_PATH
from provenance import gitinfo
from provenance.prereg import load as load_prereg
from tiers.errors import ProvenanceError


def test_the_runner_was_committed_before_the_prereg_it_stamps() -> None:
    prereg = load_prereg(PREREG_PATH)
    runner_commit, prereg_commit = prereg.assert_runner_precedes(RUNNER_RELPATH)
    assert runner_commit != prereg_commit
    assert gitinfo.is_ancestor(runner_commit, prereg_commit)


def test_the_ordering_is_strict_not_same_commit() -> None:
    """A pre-registration introduced in the same commit as the runner would make
    the ordering claim empty, and is refused explicitly."""
    prereg = load_prereg(PREREG_PATH)
    runner_commit = gitinfo.introducing_commit(RUNNER_RELPATH)
    prereg_commit = prereg.introducing_commit()
    assert runner_commit != prereg_commit
    assert not gitinfo.is_ancestor(prereg_commit, runner_commit)


def test_an_untracked_file_has_no_ordering_claim(tmp_path) -> None:
    with pytest.raises(ProvenanceError, match="untracked"):
        gitinfo.introducing_commit("algebraic-probe/does-not-exist.md")


def test_the_prereg_the_runner_names_is_the_one_the_module_registers() -> None:
    from modules.degree.spec import SPEC

    assert SPEC.runner_path == RUNNER_RELPATH
    assert SPEC.prereg_path == PREREG_PATH
