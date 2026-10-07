"""Module 1's blindness classes.

No measurement code is imported here, and none may be: ``modules/`` must not
import ``verify/`` (D-006, enforced by ``scripts/ci_checks.py``). Each class
takes its measures as arguments, and whoever runs it supplies them -- the tests,
or the readiness gate's wiring table in ``scripts/readiness_report.py``, both of
which may import from either side.

An earlier attempt put a zero-argument ``readiness_check()`` here so the gate
would not need to know a class name. It imported ``verify.anf`` to build the
measure, which is exactly the coupling the rule forbids, and the CI check caught
it. The wiring belongs outside; see D-044.
"""
