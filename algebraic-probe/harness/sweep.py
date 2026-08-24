"""Resumable sweeps backed by SQLite.

A sweep is a fixed set of cells declared up front (so the family size used by
the BH correction is the family that was planned, not the family that happened
to finish). Cells are claimed, completed, or recorded as censored; a resumed
sweep returns only the cells still pending.

Time-budget censoring is recorded per cell here and consumed by
``stats.censored`` at analysis time.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from tiers.errors import ProbeError

SCHEMA = """
CREATE TABLE IF NOT EXISTS sweep (
    prereg_id   TEXT NOT NULL,
    cell_key    TEXT NOT NULL,
    seed        INTEGER NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('pending','running','done','censored','failed')),
    value       TEXT,
    censored    INTEGER NOT NULL DEFAULT 0,
    run_id      TEXT,
    record_hash TEXT,
    PRIMARY KEY (prereg_id, cell_key, seed)
);
CREATE TABLE IF NOT EXISTS plan (
    prereg_id     TEXT PRIMARY KEY,
    family_size   INTEGER NOT NULL,
    seeds_per_cell INTEGER NOT NULL,
    declared_cells TEXT NOT NULL
);
"""


@dataclass(frozen=True, slots=True)
class Cell:
    cell_key: str
    seed: int


class SweepStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path))
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> "SweepStore":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # -- planning -----------------------------------------------------------

    def declare_plan(
        self, prereg_id: str, *, cell_keys: list[str], seeds: list[int], family_size: int
    ) -> None:
        """Declare the full sweep up front. Re-declaring differently is refused."""
        if len(set(cell_keys)) != len(cell_keys):
            raise ProbeError("cell keys must be distinct")
        if len(set(seeds)) != len(seeds):
            raise ProbeError("seeds must be distinct")
        if family_size != len(cell_keys):
            raise ProbeError(
                f"family_size {family_size} does not match the {len(cell_keys)} declared "
                "cells; the BH family is the planned family (section 3)"
            )
        declared = json.dumps({"cell_keys": cell_keys, "seeds": seeds}, sort_keys=True)
        row = self._conn.execute(
            "SELECT family_size, seeds_per_cell, declared_cells FROM plan WHERE prereg_id=?",
            (prereg_id,),
        ).fetchone()
        if row is not None:
            if (row[0], row[1], row[2]) != (family_size, len(seeds), declared):
                raise ProbeError(
                    f"sweep plan for {prereg_id} is already declared with different "
                    "cells; a plan is fixed before data collection"
                )
            return
        self._conn.execute(
            "INSERT INTO plan (prereg_id, family_size, seeds_per_cell, declared_cells) "
            "VALUES (?,?,?,?)",
            (prereg_id, family_size, len(seeds), declared),
        )
        self._conn.executemany(
            "INSERT OR IGNORE INTO sweep (prereg_id, cell_key, seed, status) VALUES (?,?,?, 'pending')",
            [(prereg_id, key, seed) for key in cell_keys for seed in seeds],
        )
        self._conn.commit()

    def plan(self, prereg_id: str) -> dict:
        row = self._conn.execute(
            "SELECT family_size, seeds_per_cell, declared_cells FROM plan WHERE prereg_id=?",
            (prereg_id,),
        ).fetchone()
        if row is None:
            raise ProbeError(f"no sweep plan declared for {prereg_id}")
        return {
            "family_size": row[0],
            "seeds_per_cell": row[1],
            **json.loads(row[2]),
        }

    # -- execution ----------------------------------------------------------

    def pending(self, prereg_id: str) -> list[Cell]:
        rows = self._conn.execute(
            "SELECT cell_key, seed FROM sweep WHERE prereg_id=? AND status IN ('pending','running') "
            "ORDER BY cell_key, seed",
            (prereg_id,),
        ).fetchall()
        return [Cell(cell_key=r[0], seed=r[1]) for r in rows]

    def claim(self, prereg_id: str, cell: Cell) -> None:
        self._conn.execute(
            "UPDATE sweep SET status='running' WHERE prereg_id=? AND cell_key=? AND seed=?",
            (prereg_id, cell.cell_key, cell.seed),
        )
        self._conn.commit()

    def complete(
        self,
        prereg_id: str,
        cell: Cell,
        *,
        value: float,
        censored: bool = False,
        run_id: str | None = None,
        record_hash: str | None = None,
    ) -> None:
        existing = self._conn.execute(
            "SELECT status, value FROM sweep WHERE prereg_id=? AND cell_key=? AND seed=?",
            (prereg_id, cell.cell_key, cell.seed),
        ).fetchone()
        if existing is None:
            raise ProbeError(f"cell {cell} is not part of the declared plan for {prereg_id}")
        if existing[0] in ("done", "censored"):
            raise ProbeError(
                f"cell {cell} is already recorded for {prereg_id}; results are append-only"
            )
        self._conn.execute(
            "UPDATE sweep SET status=?, value=?, censored=?, run_id=?, record_hash=? "
            "WHERE prereg_id=? AND cell_key=? AND seed=?",
            (
                "censored" if censored else "done",
                json.dumps(value),
                1 if censored else 0,
                run_id,
                record_hash,
                prereg_id,
                cell.cell_key,
                cell.seed,
            ),
        )
        self._conn.commit()

    def results(self, prereg_id: str, cell_key: str) -> tuple[list[int], list[float], list[bool]]:
        rows = self._conn.execute(
            "SELECT seed, value, censored FROM sweep WHERE prereg_id=? AND cell_key=? "
            "AND status IN ('done','censored') ORDER BY seed",
            (prereg_id, cell_key),
        ).fetchall()
        seeds = [r[0] for r in rows]
        values = [json.loads(r[1]) for r in rows]
        censored = [bool(r[2]) for r in rows]
        return seeds, values, censored

    def progress(self, prereg_id: str) -> dict[str, int]:
        rows = self._conn.execute(
            "SELECT status, COUNT(*) FROM sweep WHERE prereg_id=? GROUP BY status",
            (prereg_id,),
        ).fetchall()
        return {row[0]: row[1] for row in rows}
