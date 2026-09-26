"""L5 — provenance and epistemics.

The design says "port wholesale from ``algebraic-probe``". This is a port, not
an import: the two projects share no code and must not, because a pipeline that
cannot be run without a sibling directory is a pipeline nobody re-runs. What is
carried over is the five mechanisms, restated in terms this pipeline has.

  1. **Tier labels assigned by code path.** ``E`` for a rung whose observable
     the solver reported, ``S`` for a sampled quantity, ``P`` for a deduction.
     A fitted curve gets no tier at all -- it gets ``MODEL``, which is not a
     tier and cannot be used where one is required. Mixing them raises.

  2. **Pre-registration of what counts as a break, before the ladder runs.**
     Enforced by content hash and by git: a pre-registration with uncommitted
     edits cannot stamp a run. ``algebraic-probe`` learned this the expensive
     way -- all seven of its runs were invalidated at once because the
     pre-registration they named had been edited after they referenced it.

  3. **Append-only hash-chained result logs with solver versions embedded.**
     Each record commits to its predecessor's hash, so the order of a log is a
     hash chain rather than a sequence of timestamp claims, and a record cannot
     be revised without breaking every record after it.

  4. **Mandatory blindness statement on every negative.** A run that found
     nothing must say what it could not have seen. Enforced at mint time: a
     negative without one raises rather than logging.

  5. **Byte-identical regeneration.** A committed table must regenerate
     byte-for-byte from the code that claims to produce it.

Point 5 is the differentiator and it is worth being blunt about why. In a field
where disputes take the form "your experiment does not reproduce", the product
is not the attack. It is that every number in the log regenerates.
"""

from __future__ import annotations

import enum
import hashlib
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator, Sequence

#: The first record's predecessor. Not a hash of anything -- a stated origin.
GENESIS = "0" * 64

#: What a fitted curve is labelled. Deliberately not a member of ``Tier``, so
#: it cannot be passed where a tier is required: the type system refuses the
#: substitution that the prose is trying to prevent.
MODEL = "MODEL-not-a-measurement"


class TierViolation(Exception):
    """An operation that would mix, upgrade, or hand-set a tier label."""


class ProvenanceRefused(Exception):
    """A record, log or pre-registration fails an integrity requirement."""


class Tier(enum.Enum):
    """Exactly three labels, and no fourth.

    No ``UNKNOWN``, no ``PROVISIONAL``, no ``LIKELY``. A quantity that does not
    fit one of these three has not been established, and the honest record of
    that is the absence of a result rather than a softer label.
    """

    P = "P"  # PROVEN: deductive. True or false, not measured.
    E = "E"  # EXHAUSTED-IN-SPACE: the solver closed a stated space exactly.
    S = "S"  # SAMPLED: a statistic over draws, carrying an interval.

    @property
    def long_name(self) -> str:
        return {
            Tier.P: "PROVEN",
            Tier.E: "EXHAUSTED-IN-SPACE",
            Tier.S: "SAMPLED",
        }[self]

    def __str__(self) -> str:
        return self.value

    def __lt__(self, other: object) -> bool:
        raise TierViolation(
            "Tier labels are not ordered. A proof is not a bigger number than a "
            "sample; they answer different questions."
        )

    __gt__ = __lt__
    __le__ = __lt__
    __ge__ = __lt__


def tier_of_rung(status: str, ideal_degree: int | None, no_solution: str) -> Tier | None:
    """The tier of a ladder rung, by code path.

    ``None`` means the rung measured nothing, which is a legitimate outcome and
    is why this returns an option rather than a tier with a caveat. The rule:
    a decisive status is necessary and not sufficient -- the observable is the
    ideal degree, so a rung without one has not measured anything. An empty
    variety is the exception, because degree zero *is* the observable.
    """
    if status == no_solution:
        return Tier.E
    if ideal_degree is not None and status in {"solved", "positive-dimensional"}:
        return Tier.E
    return None


def assert_all_exhausted(tiers: Sequence[Tier | None], what: str) -> None:
    """Refuse to fit a curve through anything but Tier E points.

    The fit is the only place in this pipeline where numbers from different
    rungs are combined, so it is the only place cross-tier arithmetic could
    happen. It happens here or nowhere.
    """
    bad = [str(t) for t in tiers if t is not Tier.E]
    if bad:
        raise TierViolation(
            f"{what} was given points at tiers {bad}; a growth model may only be "
            "fitted through rungs the solver closed exactly. A fit through a "
            "sampled or unmeasured point is a model of a model."
        )


# -- the hash chain ----------------------------------------------------------


def canonical(payload: Any) -> str:
    """One serialisation, so one hash. Sorted keys, no incidental whitespace."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(payload: Any) -> str:
    return hashlib.sha256(canonical(payload).encode("utf-8")).hexdigest()


def record_hash(seq: int, prev_hash: str, payload: Any) -> str:
    return digest({"seq": seq, "prev_hash": prev_hash, "payload": payload})


@dataclass(frozen=True, slots=True)
class ChainRecord:
    seq: int
    prev_hash: str
    payload: dict
    hash: str

    @staticmethod
    def create(seq: int, prev_hash: str, payload: dict) -> "ChainRecord":
        return ChainRecord(
            seq=seq,
            prev_hash=prev_hash,
            payload=payload,
            hash=record_hash(seq, prev_hash, payload),
        )

    def to_dict(self) -> dict:
        return {
            "seq": self.seq,
            "prev_hash": self.prev_hash,
            "payload": self.payload,
            "hash": self.hash,
        }

    @staticmethod
    def from_dict(data: dict) -> "ChainRecord":
        try:
            return ChainRecord(
                seq=int(data["seq"]),
                prev_hash=str(data["prev_hash"]),
                payload=data["payload"],
                hash=str(data["hash"]),
            )
        except KeyError as exc:
            raise ProvenanceRefused(f"log record missing field {exc}") from exc

    def holds(self, expected_seq: int, expected_prev: str) -> bool:
        return (
            self.seq == expected_seq
            and self.prev_hash == expected_prev
            and self.hash == record_hash(self.seq, self.prev_hash, self.payload)
        )


#: Fields every logged run must carry. A record without them is not a result,
#: it is a number with no way back to what produced it -- which the original
#: brief forbids outright: every number traces to a rerunnable computation or a
#: citation, and nothing else.
REQUIRED_RECORD_FIELDS = ("kind", "spec_digest", "solver_versions", "prereg_sha256")

#: Version strings that are not versions. A record carrying one of these names
#: no solver anybody can install, while passing every non-empty check -- which
#: is what happened: seven ladders logged ``msolve/unknown`` because msolve's
#: banner carries no version number and nothing looked further.
NON_VERSIONS = ("unknown", "none", "?", "n/a", "unspecified", "latest")


#: Record kinds whose meaning is "we found nothing", and which therefore must
#: state what the experiment could not have seen.
NEGATIVE_KINDS = (
    "no-deviation",
    "wall",
    "no-solution",
    "structure",
    # An outcome record that retracts a lead, or that cannot be read at all, is
    # a negative and owes the same blindness statement as any other.
    "outcome-vanishes",
    "outcome-inconclusive",
)

#: Verdict words an outcome record may carry. A pre-registration fixes the
#: reading of each before its run; these are the names of those readings.
OUTCOME_KINDS = (
    "outcome-survives",
    "outcome-vanishes",
    "outcome-reverses",
    "outcome-inconclusive",
)


def file_digest(path: "str | Path") -> str:
    """SHA-256 of a file's bytes.

    An outcome record cites the run artefacts it was computed from by content
    hash. The ladder JSON is where the solving degrees live for runs made
    before those degrees reached the chained record, so an outcome over those
    runs has to address the files directly or it addresses nothing.
    """
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def mint_record(
    kind: str,
    spec_digest: str,
    solver_versions: Sequence[str],
    prereg_sha256: str,
    payload: dict | None = None,
    blindness: str = "",
) -> dict:
    """Build a log payload, refusing the ones that would mislead.

    Two refusals, both at mint time rather than at review time, because a
    caveat added during review is a caveat that can be forgotten:

    * a record with no solver versions cannot be re-run, and a Gröbner result
      without its solver version is not reproducible in practice -- the
      versions differ in what they can close;
    * a **negative** with no blindness statement reads as "there is nothing
      there" when what it means is "this experiment would not have seen it".
    """
    if not kind.strip():
        raise ProvenanceRefused("a record must state its kind")
    if not solver_versions:
        raise ProvenanceRefused(
            f"record kind={kind} names no solver versions, so the measurement "
            "cannot be re-run; a Gröbner result is a claim about a program and "
            "the program's version is part of the claim"
        )
    for entry in solver_versions:
        name, _, version = str(entry).partition("/")
        if not version.strip() or version.strip().lower() in NON_VERSIONS:
            raise ProvenanceRefused(
                f"record kind={kind} names solver {name!r} at version "
                f"{version.strip() or '(empty)'!r}, which is not a version. A "
                "non-empty string is not the requirement -- being able to "
                "install the same program is. Read it from the package "
                "database or fall back to a hash of the executable."
            )
    if not prereg_sha256.strip():
        raise ProvenanceRefused(
            f"record kind={kind} names no pre-registration; what counts as a "
            "break must be fixed before the measurement, not after it"
        )
    if kind in NEGATIVE_KINDS and not blindness.strip():
        raise ProvenanceRefused(
            f"record kind={kind} is a negative and states no blindness. Say what "
            "this experiment could not have seen -- the round counts it never "
            "reached, the solver orderings it did not try, the instances it "
            "excluded. A negative without that reads as an absence of structure "
            "rather than an absence of measurement."
        )
    record = {
        "kind": kind,
        "spec_digest": spec_digest,
        "solver_versions": list(solver_versions),
        "prereg_sha256": prereg_sha256,
    }
    if blindness.strip():
        record["blindness"] = blindness.strip()
    if payload:
        overlap = set(payload) & set(record)
        if overlap:
            raise ProvenanceRefused(
                f"payload would overwrite provenance fields {sorted(overlap)}"
            )
        record.update(payload)
    missing = [f for f in REQUIRED_RECORD_FIELDS if f not in record]
    if missing:  # pragma: no cover - the guards above make this unreachable
        raise ProvenanceRefused(f"record is missing {missing}")
    return record


class ResultLog:
    """An append-only hash-chained log, one JSON record per line.

    Append-only is enforced by refusing to extend a log whose chain does not
    verify, so a revised record makes every later append fail rather than
    passing quietly. That is the point: the log does not prevent someone
    editing a line -- nothing at this layer can -- it prevents an edited line
    from being usable.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    # -- reading -------------------------------------------------------------

    def records(self) -> list[ChainRecord]:
        if not self.path.exists():
            return []
        out: list[ChainRecord] = []
        for number, line in enumerate(self.path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                out.append(ChainRecord.from_dict(json.loads(line)))
            except json.JSONDecodeError as exc:
                raise ProvenanceRefused(
                    f"{self.path}:{number} is not valid JSON: {exc}"
                ) from exc
            except ProvenanceRefused as exc:
                # A structurally invalid record gets the same treatment as
                # unparseable text: say where. An integrity error that does not
                # name its line starts an investigation instead of ending one.
                raise ProvenanceRefused(f"{self.path}:{number} {exc}") from exc
        return out

    def verify(self) -> tuple[bool, str]:
        """``(ok, detail)``. Detail names the first record that fails and why."""
        prev = GENESIS
        for index, record in enumerate(self.records()):
            if not record.holds(index, prev):
                recomputed = record_hash(record.seq, record.prev_hash, record.payload)
                return False, (
                    f"record {index} fails: seq={record.seq} (expected {index}), "
                    f"prev_hash={record.prev_hash[:12]} (expected {prev[:12]}), "
                    f"hash={record.hash[:12]} (recomputes to {recomputed[:12]}). "
                    "Every record after this one is unusable too."
                )
            prev = record.hash
        return True, f"{len(self.records())} records, chain intact"

    @property
    def head(self) -> str:
        records = self.records()
        return records[-1].hash if records else GENESIS

    # -- writing -------------------------------------------------------------

    def append(self, payload: dict) -> ChainRecord:
        """Extend the chain, or refuse because it is already broken."""
        existing = self.records()
        ok, detail = self.verify()
        if not ok:
            raise ProvenanceRefused(
                f"{self.path} will not be extended: {detail} Appending to a broken "
                "chain would bury the break under a valid-looking record."
            )
        record = ChainRecord.create(len(existing), self.head, payload)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(canonical(record.to_dict()) + "\n")
        return record


# -- pre-registration --------------------------------------------------------

#: What a pre-registration must fix before the ladder runs. Each is a number or
#: a statement that would otherwise be chosen after seeing the data.
REQUIRED_PREREG_FIELDS = (
    "prereg_id",
    "target",
    "observable",
    "prediction",
    "break_criterion",
    "wall_criterion",
    "max_rounds",
    "timeout_seconds",
)


def _git(*args: str, cwd: Path) -> str:
    result = subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        raise ProvenanceRefused(
            f"git {' '.join(args)} failed: {result.stderr.strip() or 'no output'}"
        )
    return result.stdout.strip()


_FIELD_START = re.compile(r"^-\s+`([A-Za-z0-9_]+)`\s*:\s*(.*)$")


def _unwrap(value: str) -> str:
    """Remove backticks that quote the *whole* value, and no others.

    ``strip("`")`` looks equivalent and is not: a value that merely begins with
    inline code -- a backtick-quoted function name followed by ", which
    propagates ..." -- loses its opening backtick and nothing closes it, so the
    field reads as mismatched markup. The content hash covers the raw document, so
    this corrupts only what a reader of the parsed field sees, which is exactly
    the audience that matters.
    """
    if len(value) > 1 and value.startswith("`") and value.endswith("`"):
        inner = value[1:-1]
        if "`" not in inner:
            return inner
    return value


def _parse_fields(text: str) -> dict[str, str]:
    """``- `key`: value`` entries, with indented continuation lines joined.

    A field ends at the next field, at a blank line, or at a non-indented line.
    Nested list items under a field (the numbered criteria in PREREG-001) are
    indented, so they belong to the field above them.
    """
    fields: dict[str, str] = {}
    current: str | None = None
    parts: list[str] = []

    def flush() -> None:
        if current is not None:
            fields[current] = _unwrap(" ".join(p for p in parts if p).strip())

    for line in text.splitlines():
        match = _FIELD_START.match(line)
        if match:
            flush()
            current, parts = match.group(1), [match.group(2).strip()]
            continue
        if current is None:
            continue
        if not line.strip() or not line[:1].isspace():
            flush()
            current, parts = None, []
            continue
        parts.append(line.strip())
    flush()
    return fields


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

    def field_int(self, key: str) -> int:
        return int(self.fields[key])

    def field_float(self, key: str) -> float:
        return float(self.fields[key])

    def assert_committed(self) -> str:
        """The document on disk must be the committed one, byte for byte.

        This is the check whose absence invalidated every run in the sibling
        project. A run stamps the pre-registration's content hash; if the file
        can be edited afterwards, the stamp records agreement with a document
        that no longer exists. Comparing the working tree against the committed
        blob is what makes the stamp mean something.

        Returns the commit that last touched the file.
        """
        root = Path(_git("rev-parse", "--show-toplevel", cwd=self.path.parent))
        relative = self.path.resolve().relative_to(root.resolve())
        status = _git("status", "--porcelain", "--", str(relative), cwd=root)
        if status:
            raise ProvenanceRefused(
                f"{relative} has uncommitted changes ({status.split()[0]}), so a run "
                "cannot stamp it: the hash would record agreement with a document "
                "that is not in the history. Commit the pre-registration first -- "
                "that is the whole ordering claim."
            )
        commit = _git("log", "-n", "1", "--format=%H", "--", str(relative), cwd=root)
        if not commit:
            raise ProvenanceRefused(
                f"{relative} is not in the history at all, so there is nothing to "
                "have preceded the run"
            )
        return commit

    def to_dict(self) -> dict:
        return {
            "prereg_id": self.prereg_id,
            "path": str(self.path),
            "sha256": self.sha256,
            "fields": dict(self.fields),
        }


def load_prereg(path: str | Path) -> PreRegistration:
    """Read a pre-registration, refusing an incomplete one.

    The format is deliberately the same list-of-backticked-fields markdown the
    sibling project uses, so a reader who has seen one has seen both. With one
    fix: a value that continues onto indented following lines is joined rather
    than truncated at the first newline. The sibling's parser takes the first
    line only, which means a field whose text wraps is read as a prefix of
    itself and the parser never says so -- and the fields worth pre-registering
    are precisely the ones too long for one line. The break criterion here was
    read as "all four, and any one missing means no break is claimed" with the
    four criteria silently dropped, which is how this was found.
    """
    resolved = Path(path)
    if not resolved.exists():
        raise ProvenanceRefused(f"pre-registration not found: {resolved}")
    text = resolved.read_text(encoding="utf-8")
    fields = _parse_fields(text)
    missing = [key for key in REQUIRED_PREREG_FIELDS if key not in fields]
    if missing:
        raise ProvenanceRefused(
            f"pre-registration {resolved.name} does not fix {missing}. Every one of "
            "those is a choice that would otherwise be made after seeing the data."
        )
    return PreRegistration(path=resolved, text=text, fields=fields)


# -- byte-identical regeneration ---------------------------------------------


def regenerate(path: str | Path, produce: Callable[[], str]) -> tuple[bool, str]:
    """Regenerate a committed artefact and compare bytes.

    ``(ok, detail)``, and on failure the detail names the first differing byte
    offset rather than saying the files differ. A diff that says "they differ"
    starts an investigation; an offset ends one.
    """
    target = Path(path)
    if not target.exists():
        return False, f"{target} does not exist, so there is nothing to regenerate"
    committed = target.read_text(encoding="utf-8")
    fresh = produce()
    if committed == fresh:
        return True, f"{target.name} regenerates byte-for-byte ({len(fresh)} bytes)"
    for offset, (a, b) in enumerate(zip(committed, fresh)):
        if a != b:
            return False, (
                f"{target.name} differs from its regeneration at byte {offset}: "
                f"committed {a!r}, regenerated {b!r}"
            )
    return False, (
        f"{target.name} is {len(committed)} bytes, its regeneration is "
        f"{len(fresh)}: one is a prefix of the other"
    )
