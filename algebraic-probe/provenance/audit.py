"""Compliance audit: executed runs versus their pre-registration.

Section 8, AUDIT: "A compliance audit script that checks executed runs against
their pre-registration and reports every deviation, with the recomputed result
under the pre-registered rule alongside the as-run result."

The auditor recomputes. It does not merely flag. Where an analysis was run with
parameters that differ from the pre-registered ones, the auditor re-runs the
pre-registered rule over the same p-values and prints both outcomes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from stats.bh import BHTest, benjamini_hochberg
from tiers.errors import AppendOnlyViolation, ProvenanceError

from . import gitinfo
from .prereg import load as load_prereg
from .store import ResultsLog


@dataclass(frozen=True, slots=True)
class Deviation:
    field_name: str
    prereg_value: str
    as_run_value: str
    recomputed: str = ""

    def render(self) -> str:
        line = (
            f"deviation field={self.field_name} prereg={self.prereg_value} "
            f"as_run={self.as_run_value}"
        )
        if self.recomputed:
            line += f" recomputed_under_prereg={self.recomputed}"
        return line


@dataclass(frozen=True, slots=True)
class AuditReport:
    run_path: str
    run_id: str
    prereg_id: str
    chain_valid: bool
    prereg_digest_matches: bool
    deviations: tuple[Deviation, ...] = field(default_factory=tuple)
    notes: tuple[str, ...] = field(default_factory=tuple)

    @property
    def compliant(self) -> bool:
        return self.chain_valid and self.prereg_digest_matches and not self.deviations

    def render(self) -> str:
        lines = [
            f"audit run={self.run_path} run_id={self.run_id} prereg={self.prereg_id} "
            f"chain_valid={self.chain_valid} prereg_digest_matches={self.prereg_digest_matches} "
            f"n_deviations={len(self.deviations)} compliant={self.compliant}"
        ]
        lines += ["  " + d.render() for d in self.deviations]
        lines += [f"  note={n}" for n in self.notes]
        return "\n".join(lines)


def _as_str(value: object) -> str:
    return json.dumps(value, sort_keys=True) if isinstance(value, (dict, list)) else str(value)


def audit_run(log_path: Path) -> AuditReport:
    chain_valid = True
    try:
        log = ResultsLog.open(log_path)
    except Exception as exc:  # chain broken or unreadable
        return AuditReport(
            run_path=str(log_path),
            run_id="unknown",
            prereg_id="unknown",
            chain_valid=False,
            prereg_digest_matches=False,
            notes=(f"log could not be verified: {exc}",),
        )

    header = log.header
    prereg = load_prereg(header["prereg_path"])
    digest_matches = prereg.sha256 == header["prereg_sha256"]

    deviations: list[Deviation] = []
    notes: list[str] = []

    # The chain alone cannot see records removed from the end of the log; the
    # index recorded the sealed length and head hash for exactly this check.
    try:
        if log.verify_against_index():
            notes.append("log length and head hash match the sealed run index")
        else:
            notes.append("log is not sealed in the run index; length is unverified")
    except AppendOnlyViolation as exc:
        chain_valid = False
        deviations.append(
            Deviation(
                field_name="log_length",
                prereg_value="as sealed in the run index",
                as_run_value=str(exc),
            )
        )

    if not digest_matches:
        deviations.append(
            Deviation(
                field_name="prereg_sha256",
                prereg_value=prereg.sha256,
                as_run_value=str(header["prereg_sha256"]),
                recomputed="pre-registration document changed after this run",
            )
        )

    if not header.get("runner_precedes_prereg", False):
        deviations.append(
            Deviation(
                field_name="runner_precedes_prereg",
                prereg_value="True",
                as_run_value=str(header.get("runner_precedes_prereg")),
            )
        )
    else:
        try:
            runner_commit, prereg_commit = prereg.assert_runner_precedes(header["runner_relpath"])
            if runner_commit != header.get("runner_introducing_commit") or prereg_commit != header.get(
                "prereg_introducing_commit"
            ):
                deviations.append(
                    Deviation(
                        field_name="ordering_commits",
                        prereg_value=f"{runner_commit}<{prereg_commit}",
                        as_run_value=(
                            f"{header.get('runner_introducing_commit')}<"
                            f"{header.get('prereg_introducing_commit')}"
                        ),
                    )
                )
        except ProvenanceError as exc:
            deviations.append(
                Deviation(
                    field_name="runner_precedes_prereg",
                    prereg_value="ancestry holds",
                    as_run_value=str(exc),
                )
            )

    if header.get("working_tree_clean") is False:
        deviations.append(
            Deviation(
                field_name="working_tree_clean",
                prereg_value="True",
                as_run_value="False",
                recomputed="embedded commit does not describe the code that ran",
            )
        )

    commit = header.get("commit")
    if commit:
        try:
            gitinfo._git("cat-file", "-e", f"{commit}^{{commit}}")
        except ProvenanceError:
            deviations.append(
                Deviation(
                    field_name="commit",
                    prereg_value="reachable in this repository",
                    as_run_value=str(commit),
                )
            )

    # Analysis records: recompute under the pre-registered rule.
    for record in log.records:
        payload = record.payload
        if payload.get("kind") != "analysis":
            continue
        as_run_alpha = float(payload["alpha"])
        as_run_family = int(payload["family_size"])
        as_run_floor = float(payload["effect_floor"])
        prereg_alpha = prereg.field_float("alpha")
        prereg_family = prereg.field_int("family_size")
        prereg_floor = prereg.field_float("effect_floor")
        tests = [BHTest(label=t["label"], p_value=float(t["p_value"])) for t in payload["tests"]]

        if (as_run_alpha, as_run_family, as_run_floor) != (
            prereg_alpha,
            prereg_family,
            prereg_floor,
        ):
            try:
                recomputed = benjamini_hochberg(
                    tests, alpha=prereg_alpha, family_size=prereg_family
                )
                recomputed_desc = (
                    f"n_rejected={recomputed.n_rejected} "
                    f"accepted_after_floor="
                    f"{sum(1 for o in recomputed.outcomes if o.rejected and abs(float(payload['effects'][o.label])) >= prereg_floor)}"
                )
            except Exception as exc:
                recomputed_desc = f"could not recompute under prereg rule: {exc}"
            deviations.append(
                Deviation(
                    field_name=f"analysis[{payload.get('analysis_id', '?')}]",
                    prereg_value=(
                        f"alpha={prereg_alpha} family_size={prereg_family} "
                        f"effect_floor={prereg_floor}"
                    ),
                    as_run_value=(
                        f"alpha={as_run_alpha} family_size={as_run_family} "
                        f"effect_floor={as_run_floor} n_rejected={payload.get('n_rejected')}"
                    ),
                    recomputed=recomputed_desc,
                )
            )
        else:
            notes.append(
                f"analysis[{payload.get('analysis_id', '?')}] parameters match the "
                "pre-registration"
            )

    for key in ("seeds_per_cell",):
        if key in header and str(header[key]) != prereg.fields[key]:
            deviations.append(
                Deviation(
                    field_name=key,
                    prereg_value=prereg.fields[key],
                    as_run_value=_as_str(header[key]),
                )
            )

    return AuditReport(
        run_path=str(log_path),
        run_id=str(header.get("run_id", "unknown")),
        prereg_id=prereg.prereg_id,
        chain_valid=chain_valid,
        prereg_digest_matches=digest_matches,
        deviations=tuple(deviations),
        notes=tuple(notes),
    )


def audit_tree(runs_root: Path) -> tuple[AuditReport, ...]:
    reports = []
    for path in sorted(runs_root.rglob("*.jsonl")):
        if path.name == "index.jsonl":
            continue
        reports.append(audit_run(path))
    return tuple(reports)
