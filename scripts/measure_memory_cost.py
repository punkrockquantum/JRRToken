"""Measure the memory-access cost ratio on the run host.

Section 7.3 requires cost comparisons that include memory-access cost, on the
grounds that naive operation counts overstate attack advantage. The ratio used
by ``harness.promotion.CostComparison`` is therefore measured here rather than
assumed: it is the cost of one random access into a table larger than the host's
last-level cache, expressed in units of one compression-function evaluation.

The number is host-specific. It is recorded with the host description and the
commit, and a cost comparison must be evaluated with a ratio measured on the
machine whose cost is being claimed.

Run:  python scripts/measure_memory_cost.py [--table-mib 256] [--samples 200000]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import random
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

COMPUTATION_ID = "COST-MEM-001"


def time_compressions(samples: int) -> float:
    """Seconds per SHA-256 compression, one block per call (55-byte message)."""
    message = b"\x5a" * 55
    start = time.perf_counter()
    for _ in range(samples):
        hashlib.sha256(message).digest()
    return (time.perf_counter() - start) / samples


def time_random_accesses(table_mib: int, samples: int, seed: int) -> float:
    """Seconds per uncached random read from a table of ``table_mib`` MiB."""
    size = table_mib * (1 << 20)
    table = bytearray(size)
    rng = random.Random(seed)
    indices = [rng.randrange(size) for _ in range(samples)]
    total = 0
    start = time.perf_counter()
    for index in indices:
        total += table[index]
    elapsed = time.perf_counter() - start
    assert total == 0  # keeps the loop from being optimised away conceptually
    return elapsed / samples


def measure(table_mib: int, samples: int, seed: int) -> dict:
    per_compression = time_compressions(samples)
    per_access = time_random_accesses(table_mib, samples, seed)
    return {
        "computation_id": COMPUTATION_ID,
        "host": platform.platform(),
        "processor": platform.processor(),
        "python": sys.version.split()[0],
        "table_mib": table_mib,
        "samples": samples,
        "seed": seed,
        "seconds_per_compression": per_compression,
        "seconds_per_random_access": per_access,
        "access_cost_in_compressions": per_access / per_compression,
        "note": (
            "the access loop is written in Python, so both figures carry interpreter "
            "overhead; the ratio is an upper bound on the relative cost of an access "
            "against a compression only insofar as that overhead is common to both. "
            "A cost comparison quoting this ratio must state the host it was measured on"
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--table-mib", type=int, default=256)
    parser.add_argument("--samples", type=int, default=200_000)
    parser.add_argument("--seed", type=int, default=20260824)
    args = parser.parse_args()
    print(json.dumps(measure(args.table_mib, args.samples, args.seed), sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
