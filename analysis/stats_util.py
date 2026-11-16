"""Small statistics helpers shared by the descriptive analysis and decomposition."""

from __future__ import annotations

import math

import numpy as np
from scipy import stats


def num(
    value: float,
    ci_low: float | None = None,
    ci_high: float | None = None,
    n: int = 0,
) -> dict:
    """Return a published number as a plain-Python NUM object."""
    return {
        "value": float(value),
        "ci_low": None if ci_low is None else float(ci_low),
        "ci_high": None if ci_high is None else float(ci_high),
        "n": int(n),
    }


def wilson(k: float, n: float, alpha: float = 0.05) -> tuple[float | None, float | None]:
    """Return the Wilson score interval for k successes out of n trials."""
    if n <= 0:
        return None, None
    z = float(stats.norm.ppf(1.0 - alpha / 2.0))
    p = float(k) / float(n)
    denominator = 1.0 + z * z / n
    centre = (p + z * z / (2.0 * n)) / denominator
    half = z * math.sqrt(p * (1.0 - p) / n + z * z / (4.0 * n * n)) / denominator
    return float(centre - half), float(centre + half)


def rate_num(k: float, n: float, alpha: float = 0.05) -> dict:
    """Return a rate with its Wilson interval."""
    if n <= 0:
        return num(0.0, None, None, 0)
    low, high = wilson(k, n, alpha)
    return num(float(k) / float(n), low, high, n)


def bootstrap_ratio(
    numer: np.ndarray,
    denom: np.ndarray,
    n_boot: int = 500,
    seed: int = 0,
) -> tuple[float | None, float | None]:
    """Percentile interval for sum(numer) / sum(denom), resampling rows (users)."""
    numer = np.asarray(numer, dtype=float)
    denom = np.asarray(denom, dtype=float)
    if numer.size == 0 or numer.size != denom.size or n_boot <= 0:
        return None, None

    # Sort the rows so the interval does not depend on the order they arrive in.
    order = np.lexsort((denom, numer))
    numer, denom = numer[order], denom[order]

    size = numer.size
    rng = np.random.default_rng(seed)
    ratios = np.empty(n_boot, dtype=float)
    for b in range(n_boot):
        index = rng.integers(0, size, size)
        total_denom = float(denom[index].sum())
        ratios[b] = (
            float(numer[index].sum()) / total_denom if total_denom != 0.0 else np.nan
        )

    valid = ratios[np.isfinite(ratios)]
    if valid.size == 0:
        return None, None
    low, high = np.percentile(valid, [2.5, 97.5])
    return float(low), float(high)


def holm(p_values: list[float] | np.ndarray) -> list[float]:
    """Return Holm step-down adjusted p-values, monotone and capped at one."""
    pvals = np.asarray(p_values, dtype=float)
    if pvals.size == 0:
        return []

    order = np.argsort(pvals)
    sorted_p = pvals[order]
    m = pvals.size
    adjusted_sorted = np.maximum.accumulate(sorted_p * np.arange(m, 0, -1, dtype=float))
    adjusted_sorted = np.minimum(adjusted_sorted, 1.0)

    adjusted = np.empty(m, dtype=float)
    adjusted[order] = adjusted_sorted
    return [float(value) for value in adjusted]
