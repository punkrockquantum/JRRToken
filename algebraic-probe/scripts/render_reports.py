"""Regenerate the files under reports/out/.

No prose. Numbers, bounds, scope statements and tier labels only; the lint in
``reports/lint.py`` runs over everything this script writes, and
``scripts/ci_checks.py`` fails the build if a forbidden term appears.

Run:  python scripts/render_reports.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from harness.registry import REGISTRY  # noqa: E402
from modules.degree import spec as degree_spec  # noqa: E402  (registers the module)
from modules.degree.calibration.suite import SUITE  # noqa: E402
from modules.degree.prereg.derive_thresholds import render_block  # noqa: E402
from provenance import gitinfo  # noqa: E402
from provenance.prereg import load as load_prereg  # noqa: E402
from reports.lint import OUT_DIR, lint_text  # noqa: E402

assert degree_spec.SPEC.module_id in REGISTRY.ids()


def registry_report() -> str:
    lines = [f"commit={gitinfo.head_commit()}", f"modules={len(REGISTRY.ids())}"]
    for module_id in REGISTRY.ids():
        spec = REGISTRY.get(module_id)
        lines.append(spec.render())
        status = spec.suite.gate()
        lines.append("  " + status.render())
    return "\n".join(lines) + "\n"


def prereg_report() -> str:
    prereg = load_prereg(degree_spec.PREREG_PATH)
    lines = [
        f"commit={gitinfo.head_commit()}",
        f"prereg_id={prereg.prereg_id}",
        f"prereg_path={prereg.relative_path}",
        f"prereg_sha256={prereg.sha256}",
        f"prereg_introducing_commit={prereg.introducing_commit()}",
        f"runner_introducing_commit={gitinfo.introducing_commit(degree_spec.SPEC.runner_path)}",
    ]
    for key in sorted(prereg.fields):
        lines.append(f"{key}={prereg.fields[key]}")
    lines.append("")
    lines.append(render_block())
    return "\n".join(lines) + "\n"


def calibration_report() -> str:
    return f"commit={gitinfo.head_commit()}\n" + SUITE.manifest() + "\n"


REPORTS = {
    "module-registry.txt": registry_report,
    "M1-prereg.txt": prereg_report,
    "M1-calibration-manifest.txt": calibration_report,
}


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    failures = 0
    for name, builder in REPORTS.items():
        text = builder()
        hits = lint_text(text, path=f"reports/out/{name}")
        if hits:
            failures += len(hits)
            for hit in hits:
                print(hit.render())
            continue
        (OUT_DIR / name).write_text(text, encoding="utf-8")
        print(f"wrote=reports/out/{name} bytes={len(text.encode('utf-8'))}")
    if failures:
        print(f"refused_to_write={failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
