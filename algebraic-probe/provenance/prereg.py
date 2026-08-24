"""Pre-registration documents and the hash chain that orders them.

Section 8, PRE-REGISTRATION:
  * a pre-registration document per module, committed before any data collection
  * the runner embeds the full commit id plus a hash of the pre-registration
    document into the results blob
  * a test asserts that the runner code performing that embedding was itself
    committed before the pre-registration it references

``PreRegistration.assert_runner_precedes`` implements the third bullet: the
commit that introduced the runner must be a strict ancestor of the commit that
introduced the pre-registration. Ancestry, not timestamps.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

from tiers.errors import ProvenanceError

from . import gitinfo

REPO_ROOT = gitinfo.REPO_ROOT

#: Fields a pre-registration must declare before any data is collected.
REQUIRED_FIELDS = (
    "prereg_id",
    "module",
    "declared_tiers",
    "primary_metric",
    "family_size",
    "alpha",
    "effect_floor",
    "seeds_per_cell",
)

_FIELD_RE = re.compile(r"^-\s+`(?P<key>[A-Za-z0-9_]+)`\s*:\s*(?P<value>.+?)\s*$", re.MULTILINE)


@dataclass(frozen=True, slots=True)
class PreRegistration:
    path: Path
    text: str
    fields: dict[str, str]

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.text.encode("utf-8")).hexdigest()

    @property
    def prereg_id(self) -> str:
        return self.fields["prereg_id"]

    @property
    def relative_path(self) -> str:
        return str(self.path.relative_to(REPO_ROOT))

    def field_float(self, key: str) -> float:
        return float(self.fields[key])

    def field_int(self, key: str) -> int:
        return int(self.fields[key])

    def introducing_commit(self) -> str:
        return gitinfo.introducing_commit(self.relative_path)

    def assert_runner_precedes(self, runner_path: str | Path) -> tuple[str, str]:
        """Assert the runner was committed strictly before this pre-registration.

        Returns (runner_commit, prereg_commit). Raises ProvenanceError if the
        ordering does not hold -- that is a hole in the hash chain.
        """
        runner_rel = str(Path(runner_path))
        runner_commit = gitinfo.introducing_commit(runner_rel)
        prereg_commit = self.introducing_commit()
        if runner_commit == prereg_commit:
            raise ProvenanceError(
                f"{runner_rel} and {self.relative_path} were introduced in the same "
                f"commit {runner_commit}: the pre-registration was not committed "
                "before the machinery that stamps it, so the ordering claim is empty"
            )
        if not gitinfo.is_ancestor(runner_commit, prereg_commit):
            raise ProvenanceError(
                f"runner {runner_rel} (introduced {runner_commit}) is not an ancestor of "
                f"pre-registration {self.relative_path} (introduced {prereg_commit}): "
                "the hash chain has a hole"
            )
        return runner_commit, prereg_commit

    def to_dict(self) -> dict:
        return {
            "prereg_id": self.prereg_id,
            "path": self.relative_path,
            "sha256": self.sha256,
            "fields": dict(self.fields),
        }


def load(path: str | Path) -> PreRegistration:
    resolved = Path(path)
    if not resolved.is_absolute():
        resolved = REPO_ROOT / resolved
    if not resolved.exists():
        raise ProvenanceError(f"pre-registration not found: {resolved}")
    text = resolved.read_text(encoding="utf-8")
    fields = {m.group("key"): m.group("value").strip().strip("`") for m in _FIELD_RE.finditer(text)}
    missing = [key for key in REQUIRED_FIELDS if key not in fields]
    if missing:
        raise ProvenanceError(
            f"pre-registration {resolved.name} is missing required fields: {missing}"
        )
    return PreRegistration(path=resolved, text=text, fields=fields)
