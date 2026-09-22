"""Algebraic degree of the SHA-256 compression function. GENERATED.

Regenerate with:

    python scripts/sha256_degree.py --emit-module > modules/degree/calibration/sha256_truth.py

Computation M1-SHA256-001. The upper bounds are Tier P (propagated through
core.sha256.compress). The lower bounds are Tier E over a restricted input
window, which makes them Tier P lower bounds on the unrestricted target because a
restriction's degree never exceeds the function's. The witness rows are Tier P
wherever they witnessed.

No published anchor is claimed for any value here; E-04 still blocks the
literature comparison.
"""

from __future__ import annotations

COMPUTATION_ID = "M1-SHA256-001"
BLOCK_BITS = 512
FULL_ROUNDS = 64
FREE_OFFSET = 480
WITNESS_SEEDS = (20260922, 20260923, 20260924)

UPPER_BOUNDS: tuple[dict, ...] = (
    {'rounds': 0, 'free_bits': 512, 'naive_bound': 0, 'support_bound': 0, 'improvement': 0, 'saturated': False},
    {'rounds': 1, 'free_bits': 512, 'naive_bound': 512, 'support_bound': 31, 'improvement': 481, 'saturated': False},
    {'rounds': 2, 'free_bits': 512, 'naive_bound': 512, 'support_bound': 63, 'improvement': 449, 'saturated': False},
    {'rounds': 3, 'free_bits': 512, 'naive_bound': 512, 'support_bound': 95, 'improvement': 417, 'saturated': False},
    {'rounds': 4, 'free_bits': 512, 'naive_bound': 512, 'support_bound': 127, 'improvement': 385, 'saturated': False},
    {'rounds': 5, 'free_bits': 512, 'naive_bound': 512, 'support_bound': 159, 'improvement': 353, 'saturated': False},
    {'rounds': 6, 'free_bits': 512, 'naive_bound': 512, 'support_bound': 191, 'improvement': 321, 'saturated': False},
    {'rounds': 8, 'free_bits': 512, 'naive_bound': 512, 'support_bound': 255, 'improvement': 257, 'saturated': False},
    {'rounds': 12, 'free_bits': 512, 'naive_bound': 512, 'support_bound': 383, 'improvement': 129, 'saturated': False},
    {'rounds': 16, 'free_bits': 512, 'naive_bound': 512, 'support_bound': 511, 'improvement': 1, 'saturated': False},
    {'rounds': 17, 'free_bits': 512, 'naive_bound': 512, 'support_bound': 512, 'improvement': 0, 'saturated': True},
    {'rounds': 24, 'free_bits': 512, 'naive_bound': 512, 'support_bound': 512, 'improvement': 0, 'saturated': True},
    {'rounds': 32, 'free_bits': 512, 'naive_bound': 512, 'support_bound': 512, 'improvement': 0, 'saturated': True},
    {'rounds': 48, 'free_bits': 512, 'naive_bound': 512, 'support_bound': 512, 'improvement': 0, 'saturated': True},
    {'rounds': 64, 'free_bits': 512, 'naive_bound': 512, 'support_bound': 512, 'improvement': 0, 'saturated': True},
)

LOWER_BOUNDS: tuple[dict, ...] = (
    {'free_bits': 10, 'rounds': 1, 'exact_degree': 10, 'profile_min': -1, 'support_bound': 10, 'naive_bound': 10, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -502},
    {'free_bits': 10, 'rounds': 2, 'exact_degree': 10, 'profile_min': -1, 'support_bound': 10, 'naive_bound': 10, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -502},
    {'free_bits': 10, 'rounds': 4, 'exact_degree': 10, 'profile_min': -1, 'support_bound': 10, 'naive_bound': 10, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -502},
    {'free_bits': 10, 'rounds': 8, 'exact_degree': 10, 'profile_min': 9, 'support_bound': 10, 'naive_bound': 10, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -502},
    {'free_bits': 10, 'rounds': 16, 'exact_degree': 10, 'profile_min': 9, 'support_bound': 10, 'naive_bound': 10, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -502},
    {'free_bits': 10, 'rounds': 64, 'exact_degree': 10, 'profile_min': 9, 'support_bound': 10, 'naive_bound': 10, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -502},
    {'free_bits': 14, 'rounds': 1, 'exact_degree': 14, 'profile_min': -1, 'support_bound': 14, 'naive_bound': 14, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -498},
    {'free_bits': 14, 'rounds': 2, 'exact_degree': 14, 'profile_min': -1, 'support_bound': 14, 'naive_bound': 14, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -498},
    {'free_bits': 14, 'rounds': 4, 'exact_degree': 14, 'profile_min': -1, 'support_bound': 14, 'naive_bound': 14, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -498},
    {'free_bits': 14, 'rounds': 8, 'exact_degree': 14, 'profile_min': 13, 'support_bound': 14, 'naive_bound': 14, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -498},
    {'free_bits': 14, 'rounds': 16, 'exact_degree': 14, 'profile_min': 13, 'support_bound': 14, 'naive_bound': 14, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -498},
    {'free_bits': 14, 'rounds': 64, 'exact_degree': 14, 'profile_min': 13, 'support_bound': 14, 'naive_bound': 14, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -498},
    {'free_bits': 16, 'rounds': 1, 'exact_degree': 16, 'profile_min': -1, 'support_bound': 16, 'naive_bound': 16, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -496},
    {'free_bits': 16, 'rounds': 2, 'exact_degree': 16, 'profile_min': -1, 'support_bound': 16, 'naive_bound': 16, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -496},
    {'free_bits': 16, 'rounds': 4, 'exact_degree': 16, 'profile_min': -1, 'support_bound': 16, 'naive_bound': 16, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -496},
    {'free_bits': 16, 'rounds': 8, 'exact_degree': 16, 'profile_min': 15, 'support_bound': 16, 'naive_bound': 16, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -496},
    {'free_bits': 16, 'rounds': 16, 'exact_degree': 16, 'profile_min': 15, 'support_bound': 16, 'naive_bound': 16, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -496},
    {'free_bits': 16, 'rounds': 64, 'exact_degree': 16, 'profile_min': 15, 'support_bound': 16, 'naive_bound': 16, 'sound': True, 'saturated_at_free_bits': True, 'space_fraction_log2': -496},
)

WITNESS_ROWS: tuple[dict, ...] = (
    {'rounds': 1, 'probe_dim': 8, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 31},
    {'rounds': 1, 'probe_dim': 12, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 31},
    {'rounds': 1, 'probe_dim': 16, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 31},
    {'rounds': 2, 'probe_dim': 8, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 63},
    {'rounds': 2, 'probe_dim': 12, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 63},
    {'rounds': 2, 'probe_dim': 16, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 63},
    {'rounds': 4, 'probe_dim': 8, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 127},
    {'rounds': 4, 'probe_dim': 12, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 127},
    {'rounds': 4, 'probe_dim': 16, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 127},
    {'rounds': 8, 'probe_dim': 8, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 255},
    {'rounds': 8, 'probe_dim': 12, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 255},
    {'rounds': 8, 'probe_dim': 16, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 255},
    {'rounds': 16, 'probe_dim': 8, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 511},
    {'rounds': 16, 'probe_dim': 12, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 511},
    {'rounds': 16, 'probe_dim': 16, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 511},
    {'rounds': 64, 'probe_dim': 8, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 512},
    {'rounds': 64, 'probe_dim': 12, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 512},
    {'rounds': 64, 'probe_dim': 16, 'witnessed': True, 'seeds_drawn': 1, 'witness_seed': 20260922, 'upper_bound': 512},
)


def support_bound(rounds: int) -> int:
    for row in UPPER_BOUNDS:
        if row["rounds"] == rounds:
            return int(row["support_bound"])  # type: ignore[arg-type]
    raise KeyError(f"no SHA-256 upper-bound row for rounds={rounds}")


def proven_lower_bound() -> int:
    """The largest degree proven by exhausting a restricted window."""
    return max(
        int(r["exact_degree"]) for r in LOWER_BOUNDS if "exact_degree" in r
    )

