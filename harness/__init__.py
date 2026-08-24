"""Run orchestration: registration, regime routing, calibration gates, sweeps."""

from .calibration import (
    PENDING_PRIMARY_SOURCE,
    CalibrationCase,
    CalibrationReport,
    CalibrationSuite,
    CaseKind,
    CaseOutcome,
    Comparator,
    GateStatus,
)
from .promotion import (
    CostComparison,
    CostRow,
    Direction,
    FalsificationCheck,
    PromotionDecision,
    ThresholdCheck,
    VerificationCheck,
)
from .registry import REGISTRY, ModuleSpec, Registry
from .runner import REPRODUCIBLE_FACTORS, RUNNER_RELPATH, ProvenanceRunner, RunReceipt
from .sweep import Cell, SweepStore

__all__ = [
    "CalibrationCase",
    "CalibrationReport",
    "CalibrationSuite",
    "CaseKind",
    "CaseOutcome",
    "Cell",
    "Comparator",
    "CostComparison",
    "CostRow",
    "Direction",
    "FalsificationCheck",
    "GateStatus",
    "ModuleSpec",
    "PENDING_PRIMARY_SOURCE",
    "PromotionDecision",
    "REGISTRY",
    "REPRODUCIBLE_FACTORS",
    "RUNNER_RELPATH",
    "Registry",
    "ProvenanceRunner",
    "RunReceipt",
    "SweepStore",
    "ThresholdCheck",
    "VerificationCheck",
]
