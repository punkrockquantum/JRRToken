"""Parametrised primitives and control targets, plus their validation."""

from .gf2 import GF2n, is_irreducible, lowest_irreducible
from .targets import InverseMap, LinearMapGF2, PowerMap, RandomFunction, VectorialFunction

__all__ = [
    "GF2n",
    "InverseMap",
    "LinearMapGF2",
    "PowerMap",
    "RandomFunction",
    "VectorialFunction",
    "is_irreducible",
    "lowest_irreducible",
]
