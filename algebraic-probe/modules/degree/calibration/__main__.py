"""Print the calibration manifest: what the suite will assert, before it runs.

    python -m modules.degree.calibration

A ``__main__.py`` rather than running ``suite.py`` with ``-m``. Importing the
package pulls in ``modules.degree.__init__`` -> ``spec`` -> ``calibration.suite``,
so ``python -m modules.degree.calibration.suite`` would find ``suite`` already in
``sys.modules`` and execute it a second time as ``__main__`` -- CPython warns
that this may behave unpredictably, and it built the suite twice. This entry
point is imported once, as ``__main__``, and never as anything else.
"""

from __future__ import annotations

from .suite import SUITE


def main() -> int:
    print(SUITE.manifest())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
