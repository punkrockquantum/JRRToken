"""Landscape geometry against algebraic degree. GENERATED.

Regenerate with:

    python scripts/landscape.py --emit-module > modules/degree/calibration/landscape_truth.py

Computation M1-LANDSCAPE-001; the i.i.d. local-minimum prediction is derived
in-repo as M1-LAND-DERIVE-001 (verify.landscape.expected_local_minima_iid). Every
row exhausts the whole hypercube; nothing is sampled.

These rows record what the degree measure cannot see. They are not a finding
about any named target and they promote nothing. See ESCALATIONS.md E-11.
"""

from __future__ import annotations

COMPUTATION_ID = "M1-LANDSCAPE-001"
DERIVATION_ID = "M1-LAND-DERIVE-001"
SEED = 20260920
OUTER_WEIGHT = 0.7
OUTER_BITS = (0, 2, 4, 6, 8, 10)
N_LOWEST = 64
OVERLAP_THRESHOLD = 0.5

LANDSCAPE_ROWS: tuple[dict, ...] = (
    {'n': 14, 'n_outer': 0, 'n_clusters': 1, 'hierarchical': False, 'degree_max': 14, 'degree_min': 13, 'local_minima': 1071, 'local_minima_predicted_iid': 1092.2667, 'local_minima_ratio': 0.98053, 'mean_overlap': 0.002197, 'var_overlap': 0.072811, 'overlap_mass_above_threshold': 0.030754, 'dos_mean': 0.013028, 'dos_variance': 0.998452, 'dos_skewness': 0.006647, 'dos_excess_kurtosis': -0.034578, 'dos_mean_fluctuation_predicted': 0.0},
    {'n': 14, 'n_outer': 2, 'n_clusters': 4, 'hierarchical': True, 'degree_max': 14, 'degree_min': 13, 'local_minima': 747, 'local_minima_predicted_iid': 1092.2667, 'local_minima_ratio': 0.683899, 'mean_overlap': 0.129819, 'var_overlap': 0.060528, 'overlap_mass_above_threshold': 0.06746, 'dos_mean': -0.032472, 'dos_variance': 1.607247, 'dos_skewness': 0.564453, 'dos_excess_kurtosis': -0.641405, 'dos_mean_fluctuation_predicted': 0.41833},
    {'n': 14, 'n_outer': 4, 'n_clusters': 16, 'hierarchical': True, 'degree_max': 14, 'degree_min': 13, 'local_minima': 746, 'local_minima_predicted_iid': 1092.2667, 'local_minima_ratio': 0.682983, 'mean_overlap': 0.130244, 'var_overlap': 0.079975, 'overlap_mass_above_threshold': 0.084821, 'dos_mean': 0.271088, 'dos_variance': 0.835743, 'dos_skewness': 0.155318, 'dos_excess_kurtosis': -0.53999, 'dos_mean_fluctuation_predicted': 0.209165},
    {'n': 14, 'n_outer': 6, 'n_clusters': 64, 'hierarchical': True, 'degree_max': 14, 'degree_min': 13, 'local_minima': 583, 'local_minima_predicted_iid': 1092.2667, 'local_minima_ratio': 0.533752, 'mean_overlap': 0.244756, 'var_overlap': 0.092062, 'overlap_mass_above_threshold': 0.219246, 'dos_mean': 0.03006, 'dos_variance': 1.114584, 'dos_skewness': 0.03289, 'dos_excess_kurtosis': -0.222025, 'dos_mean_fluctuation_predicted': 0.104583},
    {'n': 14, 'n_outer': 8, 'n_clusters': 256, 'hierarchical': True, 'degree_max': 14, 'degree_min': 13, 'local_minima': 622, 'local_minima_predicted_iid': 1092.2667, 'local_minima_ratio': 0.569458, 'mean_overlap': 0.151998, 'var_overlap': 0.111949, 'overlap_mass_above_threshold': 0.165675, 'dos_mean': -0.064776, 'dos_variance': 1.01043, 'dos_skewness': -0.021513, 'dos_excess_kurtosis': -0.048301, 'dos_mean_fluctuation_predicted': 0.052291},
    {'n': 14, 'n_outer': 10, 'n_clusters': 1024, 'hierarchical': True, 'degree_max': 14, 'degree_min': 13, 'local_minima': 662, 'local_minima_predicted_iid': 1092.2667, 'local_minima_ratio': 0.606079, 'mean_overlap': 0.011267, 'var_overlap': 0.087063, 'overlap_mass_above_threshold': 0.068452, 'dos_mean': 0.025629, 'dos_variance': 1.106167, 'dos_skewness': -0.00011, 'dos_excess_kurtosis': 0.024452, 'dos_mean_fluctuation_predicted': 0.026146},
)


def degree_profiles() -> set[tuple[int, int]]:
    """The distinct (max, min) degree profiles across the sweep.

    A single element means the degree measure returned the same answer for every
    landscape geometry in the sweep -- which is the blindness this file records.
    """
    return {(int(r["degree_max"]), int(r["degree_min"])) for r in LANDSCAPE_ROWS}

