"""Calibration cases for Module 1.

Deliberately empty of imports. ``suite`` is the documented entry point --
``python -m modules.degree.calibration.suite`` prints the manifest -- and a
package that eagerly imports its own ``__main__`` module makes CPython import
``suite`` twice: once as ``modules.degree.calibration.suite`` while loading the
package, then again as ``__main__``. That emits a RuntimeWarning about
unpredictable behaviour, constructs the suite twice, and would fail outright
under this project's ``filterwarnings = ["error"]``.

Import what you need from ``modules.degree.calibration.suite`` directly; every
caller in this repository already does.
"""
