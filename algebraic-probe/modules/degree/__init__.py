"""Module 1 -- algebraic degree growth versus round count.

Declared, pre-registered and calibrated. No measurement path is implemented:
``spec.SPEC.measure`` is ``None`` and the calibration suite raises
``NotAuthorised`` if asked to run.
"""

from .citations import CITATIONS
from .spec import PREREG_PATH, SPEC

__all__ = ["CITATIONS", "PREREG_PATH", "SPEC"]
