"""Provenance stamp carried by every result.

Prime directive 2.1: every number traces to (a) a computation in this
repository, or (b) a citation to published literature. A result carrying
neither cannot be constructed -- the constructor raises.
"""

from __future__ import annotations

import enum
import hashlib
import json
from dataclasses import asdict, dataclass, field

from .errors import ProvenanceError


class Verification(enum.Enum):
    """How a citation's *numbers* were checked, not whether the paper exists."""

    #: The claimed value was read out of the primary source in this repository's
    #: working environment and the retrieval is recorded in the citation record.
    PRIMARY_SOURCE = "primary-source"
    #: The claimed value is reproduced by a computation in this repository.
    IN_REPO_COMPUTATION = "in-repo-computation"
    #: The value has NOT been checked against the primary source. A calibration
    #: target in this state hard-blocks its module (section 5).
    UNVERIFIED = "unverified"


@dataclass(frozen=True, slots=True)
class Citation:
    """A full literature reference plus the verification state of its numbers."""

    key: str
    authors: str
    title: str
    venue: str
    year: int
    locator: str  # DOI, ePrint number, page range -- how to find the exact claim
    claim: str  # the specific statement being relied on, in the source's terms
    verification: Verification
    verification_note: str = ""

    def __post_init__(self) -> None:
        for name in ("key", "authors", "title", "venue", "locator", "claim"):
            if not getattr(self, name).strip():
                raise ProvenanceError(f"Citation field {name!r} must be non-empty")
        if self.verification is Verification.UNVERIFIED and not self.verification_note.strip():
            raise ProvenanceError(
                f"Citation {self.key!r} is UNVERIFIED and must state why in verification_note"
            )

    def render(self) -> str:
        return (
            f"[{self.key}] {self.authors}. {self.title}. {self.venue}, {self.year}. "
            f"{self.locator}. verification={self.verification.value}"
        )


@dataclass(frozen=True, slots=True)
class Provenance:
    """Where a number came from.

    Exactly one of ``computation_id`` / ``citation_key`` is the minimum; both
    may be present (a computation that reproduces a published value).
    """

    computation_id: str | None = None
    citation_key: str | None = None
    commit: str | None = None
    prereg_sha256: str | None = None
    notes: str = ""

    def __post_init__(self) -> None:
        has_computation = bool(self.computation_id and self.computation_id.strip())
        has_citation = bool(self.citation_key and self.citation_key.strip())
        if not (has_computation or has_citation):
            raise ProvenanceError(
                "A result must carry a computation id or a citation key. "
                "Prime directive 2.1: nothing traces to an assertion in a comment."
            )

    def render(self) -> str:
        parts = []
        if self.computation_id:
            parts.append(f"computation={self.computation_id}")
        if self.citation_key:
            parts.append(f"citation={self.citation_key}")
        if self.commit:
            parts.append(f"commit={self.commit}")
        if self.prereg_sha256:
            parts.append(f"prereg={self.prereg_sha256[:16]}")
        return " ".join(parts)

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v not in (None, "")}


@dataclass(frozen=True, slots=True)
class CitationIndex:
    """The set of citations a module is allowed to reference."""

    citations: tuple[Citation, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        keys = [c.key for c in self.citations]
        dupes = {k for k in keys if keys.count(k) > 1}
        if dupes:
            raise ProvenanceError(f"Duplicate citation keys: {sorted(dupes)}")

    def get(self, key: str) -> Citation:
        for citation in self.citations:
            if citation.key == key:
                return citation
        raise ProvenanceError(f"Unknown citation key {key!r}")

    def unverified(self) -> tuple[Citation, ...]:
        return tuple(c for c in self.citations if c.verification is Verification.UNVERIFIED)

    def digest(self) -> str:
        blob = json.dumps(
            [
                {
                    "key": c.key,
                    "authors": c.authors,
                    "title": c.title,
                    "venue": c.venue,
                    "year": c.year,
                    "locator": c.locator,
                    "claim": c.claim,
                    "verification": c.verification.value,
                }
                for c in sorted(self.citations, key=lambda c: c.key)
            ],
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()
