"""Measurement modules. One subpackage per module of section 4 of the brief.

``verify/`` must never import from this package; that separation is what keeps a
verification path from restating the thing it verifies. The reverse import is
also refused, so a module cannot quietly use its own verifier. Both directions
are checked by ``scripts/ci_checks.py``.
"""
