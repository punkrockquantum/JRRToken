"""Git facts, read at run start. No timestamp claims -- ancestry and hashes only.

Section 8: "The runner calls ``git rev-parse HEAD`` at run start and embeds the
full commit id ... This makes the ordering a hash chain rather than a timestamp
claim, and a timestamp claim is not sufficient."
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from tiers.errors import ProvenanceError

REPO_ROOT = Path(__file__).resolve().parents[1]


def _git(*args: str, cwd: Path | None = None) -> str:
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=str(cwd or REPO_ROOT),
            capture_output=True,
            text=True,
            check=True,
        )
    except FileNotFoundError as exc:  # pragma: no cover - environment failure
        raise ProvenanceError("git is not available; provenance cannot be established") from exc
    except subprocess.CalledProcessError as exc:
        raise ProvenanceError(f"git {' '.join(args)} failed: {exc.stderr.strip()}") from exc
    return completed.stdout.strip()


def head_commit() -> str:
    return _git("rev-parse", "HEAD")


def working_tree_clean(paths: list[str] | None = None) -> bool:
    args = ["status", "--porcelain"]
    if paths:
        args += ["--", *paths]
    return _git(*args) == ""


def introducing_commit(path: str | Path) -> str:
    """The commit that added ``path``. Raises if the path is untracked."""
    rel = str(path)
    out = _git("log", "--diff-filter=A", "--format=%H", "--", rel)
    if not out:
        raise ProvenanceError(
            f"{rel!r} has no commit that added it: it is untracked, so nothing about "
            "its ordering in the hash chain can be asserted"
        )
    return out.splitlines()[-1]


def is_ancestor(ancestor: str, descendant: str) -> bool:
    completed = subprocess.run(
        ["git", "merge-base", "--is-ancestor", ancestor, descendant],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )
    if completed.returncode == 0:
        return True
    if completed.returncode == 1:
        return False
    raise ProvenanceError(f"git merge-base failed: {completed.stderr.strip()}")


def file_blob_sha(path: str | Path, commit: str = "HEAD") -> str:
    return _git("rev-parse", f"{commit}:{path}")


@dataclass(frozen=True, slots=True)
class GitStamp:
    commit: str
    clean: bool

    def to_dict(self) -> dict:
        return {"commit": self.commit, "working_tree_clean": self.clean}


def stamp(paths: list[str] | None = None) -> GitStamp:
    return GitStamp(commit=head_commit(), clean=working_tree_clean(paths))
