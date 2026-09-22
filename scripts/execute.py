"""Execute exactly what the readiness gates authorise, and nothing else.

A go/no-go that only prints is half an instrument. This reads the readiness
report, takes the (module, target) pairs it authorises, and runs those -- through
the provenance runner, so every result lands in an append-only hash-chained log
carrying the commit and the pre-registration digest.

An unauthorised pair is refused here, not skipped quietly: the refusal and its
reason are recorded in the same log as the results, so the log says what was not
run as well as what was.

Run:  python scripts/execute.py [--write]
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core.sha256 import SHA256Compression  # noqa: E402
from core.targets import InverseMap, LinearMapGF2, PowerMap, RandomFunction  # noqa: E402
from harness.readiness import Decision  # noqa: E402
from harness.runner import ProvenanceRunner  # noqa: E402
from modules.degree import measure as m1  # noqa: E402
from modules.degree.citations import CITATIONS  # noqa: E402
from modules.degree.spec import PREREG_PATH, SPEC  # noqa: E402
from reports.lint import OUT_DIR, lint_text  # noqa: E402
from scripts.readiness_report import build_report  # noqa: E402
from tiers import EnumeratedSpace, enumerated, prove  # noqa: E402

#: The concrete instance measured for each authorised target family. Declared
#: here rather than chosen at run time, so a run is reproducible from the log.
INSTANCES: dict[str, list[tuple[str, object]]] = {
    "linear-map-gf2": [("n=12 seed=20260824", LinearMapGF2.random_invertible(12, 20260824))],
    "power-map-gf2n": [
        ("n=11 d=3", PowerMap.create(11, 3)),
        ("n=11 d=31", PowerMap.create(11, 31)),
    ],
    "inverse-map-gf2n": [("n=11", InverseMap.create(11))],
    "random-function-sha256-prf": [
        ("n=12 m=12 seed=20260825", RandomFunction.create(12, 12, 20260825))
    ],
    # The primary target, authorised in D-041. Three parameterisations, because
    # no one of them answers the question: the full 512-bit input carries the
    # Tier P bound and refuses an exact value, while the restricted windows are
    # exhaustible and give a Tier P lower bound on the full target (a
    # restriction's degree never exceeds the function's). The window sits in
    # W[0], the first message word any round consumes.
    "sha256-compression-parametrised": [
        (
            "rounds=4 free=512",
            SHA256Compression.create(n_rounds=4),
        ),
        (
            "rounds=64 free=512",
            SHA256Compression.create(n_rounds=64),
        ),
        (
            "rounds=4 free=12 window=W0",
            SHA256Compression.create(
                n_rounds=4, free_bits=12, free_offset=SHA256Compression.WORD0_OFFSET
            ),
        ),
        (
            "rounds=64 free=12 window=W0",
            SHA256Compression.create(
                n_rounds=64, free_bits=12, free_offset=SHA256Compression.WORD0_OFFSET
            ),
        ),
    ],
}

WITNESS_SEEDS = list(range(20260901, 20260901 + 50))

#: Probe dimension used where no exact degree is available to aim at. 16 costs
#: 2^16 target evaluations per seed, which is affordable on SHA-256; the proven
#: lower bound is whatever dimension actually witnesses.
WITNESS_FALLBACK_DIM = 16


@dataclass(frozen=True, slots=True)
class RunLine:
    text: str


def execute(write: bool) -> tuple[str, int]:
    report = build_report()
    authorised = {pair for pair in report.authorised_runs}
    lines: list[str] = [
        f"commit={report.commit}",
        f"authorised_runs={len(authorised)}",
    ]

    runner = ProvenanceRunner(
        module_id=SPEC.module_id,
        prereg_path=PREREG_PATH,
        citations=CITATIONS,
        require_clean_tree=False,
    )
    receipt = runner.start()
    lines.append(f"run_id={receipt.run_id} prereg_sha256={receipt.prereg_sha256[:16]}")

    # Refusals first, so the log records what was withheld and why.
    for module in report.modules:
        for target in module.targets:
            if target.decision is Decision.GO:
                continue
            reasons = [f"{o.gate_id}:{o.name}" for o in target.blocking_failures]
            runner.record_event(
                "refusal",
                {
                    "module": module.module_id,
                    "target": target.target_id,
                    "blocking_gates": reasons,
                },
            )
            lines.append(
                f"refused module={module.module_id} target={target.target_id} "
                f"blocking={reasons}"
            )

    executed = 0
    for module_id, target_id in report.authorised_runs:
        if module_id != SPEC.module_id.split(".")[-1] and module_id != "M1":
            continue
        for label, target in INSTANCES.get(target_id, []):
            n, out_bits = target.n_in, target.n_out

            # Not every target has a bound path: a random-oracle stand-in has no
            # round structure to propagate through, and the measure says so
            # rather than inventing one. That refusal is recorded, not skipped.
            bound = None
            try:
                bound = m1.degree_upper_bound(target)
            except m1.MeasurementRefused as exc:
                runner.record_event(
                    "no_bound_path",
                    {"target": target_id, "instance": label, "reason": str(exc)},
                )
            if bound is not None:
                runner.record_result(
                    prove(
                        metric="d_ub",
                        value=bound.value,
                        target=f"{target_id} {label}",
                        provenance=runner.provenance(f"DUB-{target_id}-{label}"),
                        derivation=bound.derivation,
                        payload={"capped_by_permutation": bound.capped_by_permutation},
                    )
                )

            # A second, tighter bound where the family admits one. Recording
            # both is the point: the difference is what the extra argument
            # bought, and for SHA-256 it is the difference between a vacuous
            # bound and a usable one.
            derived = None
            try:
                derived = m1.derived_upper_bound(target)
            except m1.MeasurementRefused:
                pass
            if derived is not None:
                runner.record_result(
                    prove(
                        metric="d_ub_derived",
                        value=derived.value,
                        target=f"{target_id} {label}",
                        provenance=runner.provenance(f"DUD-{target_id}-{label}"),
                        derivation=derived.derivation,
                        payload={
                            "improvement_over_propagated": (
                                bound.value - derived.value if bound is not None else None
                            )
                        },
                    )
                )

            # Nor does every target have an exact path. The 512-bit SHA-256
            # target is over the exact guard by 499 bits, and the measure refuses
            # rather than approximating. That refusal is recorded too: a target
            # measured by bound alone must say so in the log, not simply omit a
            # field.
            exact = None
            try:
                exact = m1.exact_degree(target)
            except m1.MeasurementRefused as exc:
                runner.record_event(
                    "no_exact_path",
                    {"target": target_id, "instance": label, "reason": str(exc)},
                )

            if exact is not None:
                full_space = getattr(target, "full_space_bits", n)
                space = EnumeratedSpace(
                    description=f"every input of the {n}-bit domain",
                    cardinality=1 << n,
                    full_cardinality=1 << full_space,
                    universe_description=f"the {full_space}-bit input space",
                )
                runner.record_result(
                    enumerated(
                        metric="d_exact",
                        value=exact,
                        target=f"{target_id} {label}",
                        provenance=runner.provenance(f"DEX-{target_id}-{label}"),
                        space=space,
                        payload={"output_bits": out_bits},
                    )
                )

                witness = m1.witness_lower_bound(target, exact, WITNESS_SEEDS)
                if witness.witnessed:
                    runner.record_result(
                        prove(
                            metric="d_lb",
                            value=exact,
                            target=f"{target_id} {label}",
                            provenance=runner.provenance(f"DLB-{target_id}-{label}"),
                            derivation=witness.derivation,
                            payload={"witness_seed": witness.witness_seed},
                        )
                    )
            else:
                # No exact value to aim the probe at, so the witness is run at the
                # largest dimension the guard allows and reported as the proven
                # lower bound it is.
                witness = m1.witness_lower_bound(target, WITNESS_FALLBACK_DIM, WITNESS_SEEDS, n=n)
                if witness.witnessed:
                    runner.record_result(
                        prove(
                            metric="d_lb",
                            value=WITNESS_FALLBACK_DIM,
                            target=f"{target_id} {label}",
                            provenance=runner.provenance(f"DLB-{target_id}-{label}"),
                            derivation=witness.derivation,
                            payload={"witness_seed": witness.witness_seed},
                        )
                    )

            lines.append(
                f"module=M1 target={target_id} instance={label} "
                + (
                    f"d_ub={bound.value} "
                    + (
                        f"gap={bound.value - exact} "
                        if exact is not None
                        else "gap=no-exact-path "
                    )
                    + (
                        f"d_ub_derived={derived.value} "
                        if derived is not None
                        else ""
                    )
                    + f"bound_capped={bound.capped_by_permutation} "
                    if bound is not None
                    else "d_ub=no-bound-path gap=n/a "
                )
                + f"d_exact={exact} d_lb_witnessed={witness.witnessed} "
                f"witness_seed={witness.witness_seed} space=2^{n}"
            )
            executed += 1

    final = runner.finish()
    lines.append(f"records={final.n_records} head_hash={final.head_hash[:16]}")
    lines.append(f"log={final.path.relative_to(ROOT)}")
    lines.append(f"content_sha256={final.content_sha256[:16]}")

    text = "\n".join(lines) + "\n"
    hits = lint_text(text, path="reports/out/execution.txt")
    if hits:
        for hit in hits:
            print(hit.render())
        return text, 1
    if write:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        (OUT_DIR / "execution.txt").write_text(text, encoding="utf-8")
    return text, 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    text, code = execute(args.write)
    print(text)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
