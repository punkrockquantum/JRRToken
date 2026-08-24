"""Exception types for the tier and provenance integrity layer.

Every one of these is raised, never warned. Section 3 of the project brief:
"attempting to do so raises an error rather than emitting a warning".
"""


class ProbeError(Exception):
    """Base class for every error raised by this instrument."""


class TierViolation(ProbeError):
    """An operation that would mix, upgrade, or hand-set a tier label."""


class ProvenanceError(ProbeError):
    """A result was constructed without a computation id or a citation key."""


class SpaceError(ProbeError):
    """A Tier E result was constructed without a well-formed enumerated space."""


class SamplingError(ProbeError):
    """A Tier S result violates the sampling requirements of section 3."""


class RegimeViolation(ProbeError):
    """A module was routed to an execution regime its declared tier forbids."""


class AppendOnlyViolation(ProbeError):
    """An attempt to mutate or overwrite a committed results record."""


class CalibrationBlocked(ProbeError):
    """A module refused to run because its calibration suite is not satisfied.

    Section 5: "This is not a warning; it is a hard block."
    """


class NotAuthorised(ProbeError):
    """Execution requested for a stage the operator has not yet authorised."""
