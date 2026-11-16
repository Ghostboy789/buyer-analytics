"""A/B-testing engine validated on real traffic that contains no real experiment.

The module makes random A/A splits of real users, plants known effects, and checks
that the resulting statistics behave the way theory says they should.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

ALPHA = 0.05
WINDOW_DAYS = 28
NOTE = "No real experiment exists in this data. Every effect was planted."
MASK64 = np.uint64(0xFFFFFFFFFFFFFFFF)


def user_hash(user_ids: Any) -> np.ndarray:
    """Return the first eight sha256 bytes of each user id as a uint64 array."""
    if isinstance(user_ids, pd.Series):
        ids = user_ids.to_numpy(dtype=object)
    else:
        ids = np.asarray(user_ids, dtype=object)
    hashes = np.empty(ids.size, dtype=np.uint64)
    for i, user_id in enumerate(ids):
        digest = hashlib.sha256(str(user_id).encode("utf-8")).digest()
        hashes[i] = int.from_bytes(digest[:8], "little")
    return hashes


def _salt_hash(salt: str) -> np.uint64:
    """Return the first eight sha256 bytes of a salt as a uint64."""
    digest = hashlib.sha256(salt.encode("utf-8")).digest()
    return np.uint64(int.from_bytes(digest[:8], "little"))


def _splitmix64(values: np.ndarray) -> np.ndarray:
    """Apply the splitmix64 finaliser with uint64 wraparound."""
    with np.errstate(over="ignore"):
        z = np.asarray(values, dtype=np.uint64) + np.uint64(0x9E3779B97F4A7C15)
        z = (z ^ (z >> np.uint64(30))) * np.uint64(0xBF58476D1CE4E5B9)
        z = (z ^ (z >> np.uint64(27))) * np.uint64(0x94D049BB133111EB)
        z = z ^ (z >> np.uint64(31))
    return z


def assign(user_hashes: np.ndarray, salt: str) -> np.ndarray:
    """Deterministically assign hashed users to one of two balanced arms."""
    hashes = np.asarray(user_hashes, dtype=np.uint64)
    mixed = _splitmix64(hashes ^ _salt_hash(salt))
    return (mixed & np.uint64(1)).astype(np.int8)


def two_proportion_test(
    x_c: float, n_c: float, x_t: float, n_t: float, alpha: float = 0.05
) -> dict:
    """Run a two-sided two-proportion z-test with pooled and unpooled errors."""
    if n_c <= 0 or n_t <= 0:
        nan = float("nan")
        return {
            "diff": nan,
            "z": nan,
            "p_value": nan,
            "ci_low": nan,
            "ci_high": nan,
            "rel_lift": nan,
        }

    p_c = float(x_c) / float(n_c)
    p_t = float(x_t) / float(n_t)
    diff = p_t - p_c
    pooled = (float(x_c) + float(x_t)) / (float(n_c) + float(n_t))
    se_pooled = math.sqrt(pooled * (1.0 - pooled) * (1.0 / n_c + 1.0 / n_t))
    if se_pooled > 0:
        z = diff / se_pooled
        p_value = float(2.0 * stats.norm.sf(abs(z)))
    else:
        z = 0.0 if diff == 0 else math.copysign(math.inf, diff)
        p_value = 1.0 if diff == 0 else 0.0

    se_unpooled = math.sqrt(
        p_c * (1.0 - p_c) / n_c + p_t * (1.0 - p_t) / n_t
    )
    crit = float(stats.norm.ppf(1.0 - alpha / 2.0))
    ci_low = diff - crit * se_unpooled
    ci_high = diff + crit * se_unpooled
    rel_lift = diff / p_c if p_c > 0 else float("nan")

    return {
        "diff": float(diff),
        "z": float(z),
        "p_value": float(p_value),
        "ci_low": float(ci_low),
        "ci_high": float(ci_high),
        "rel_lift": float(rel_lift),
    }


def permutation_test(y: Any, group: Any, n_perm: int = 2000, seed: int = 0) -> float:
    """Return a two-sided permutation p-value for a difference in means."""
    y = np.asarray(y, dtype=float)
    group = np.asarray(group)
    treated = group == 1
    observed = y[treated].mean() - y[~treated].mean()
    rng = np.random.default_rng(seed)
    count = 0
    for _ in range(n_perm):
        permuted = rng.permutation(group)
        mask = permuted == 1
        diff = y[mask].mean() - y[~mask].mean()
        if abs(diff) >= abs(observed):
            count += 1
    return float((count + 1) / (n_perm + 1))


def welch_test(y_c: Any, y_t: Any, alpha: float = 0.05) -> dict:
    """Run Welch's two-sample t-test and a t-based interval on the mean difference."""
    y_c = np.asarray(y_c, dtype=float)
    y_t = np.asarray(y_t, dtype=float)
    n_c = y_c.size
    n_t = y_t.size
    diff = float(y_t.mean() - y_c.mean())
    v_c = float(y_c.var(ddof=1))
    v_t = float(y_t.var(ddof=1))
    se2 = v_c / n_c + v_t / n_t
    df = float(
        se2**2
        / (
            (v_c / n_c) ** 2 / (n_c - 1)
            + (v_t / n_t) ** 2 / (n_t - 1)
        )
    )
    if se2 > 0:
        t = diff / math.sqrt(se2)
        p_value = float(2.0 * stats.t.sf(abs(t), df))
    else:
        t = 0.0 if diff == 0 else math.copysign(math.inf, diff)
        p_value = 1.0 if diff == 0 else 0.0
    crit = float(stats.t.ppf(1.0 - alpha / 2.0, df))
    se = math.sqrt(se2) if se2 > 0 else 0.0

    return {
        "diff": float(diff),
        "t": float(t),
        "df": float(df),
        "p_value": float(p_value),
        "ci_low": float(diff - crit * se),
        "ci_high": float(diff + crit * se),
    }


def bootstrap_diff_ci(
    y_c: Any,
    y_t: Any,
    n_boot: int = 2000,
    alpha: float = 0.05,
    seed: int = 0,
) -> tuple[float, float]:
    """Return a percentile bootstrap interval for the difference in means."""
    y_c = np.asarray(y_c, dtype=float)
    y_t = np.asarray(y_t, dtype=float)
    rng = np.random.default_rng(seed)
    diffs = np.empty(n_boot, dtype=float)
    for b in range(n_boot):
        sample_c = y_c[rng.integers(0, y_c.size, y_c.size)]
        sample_t = y_t[rng.integers(0, y_t.size, y_t.size)]
        diffs[b] = sample_t.mean() - sample_c.mean()
    low, high = np.percentile(diffs, [100.0 * alpha / 2.0, 100.0 * (1.0 - alpha / 2.0)])
    return float(low), float(high)


def sample_size_per_arm(
    p_base: float, rel_lift: float, alpha: float = 0.05, power: float = 0.8
) -> int:
    """Return the required sample size per arm for a two-sided two-proportion test."""
    if not 0.0 < p_base < 1.0:
        raise ValueError("p_base must be strictly between 0 and 1")
    if rel_lift <= 0.0:
        raise ValueError("rel_lift must be positive")
    p1 = float(p_base)
    p2 = p1 * (1.0 + float(rel_lift))
    if p2 >= 1.0:
        raise ValueError("p_base * (1 + rel_lift) must be below 1")
    pbar = 0.5 * (p1 + p2)
    z_alpha = float(stats.norm.ppf(1.0 - alpha / 2.0))
    z_power = float(stats.norm.ppf(power))
    numerator = (
        z_alpha * math.sqrt(2.0 * pbar * (1.0 - pbar))
        + z_power * math.sqrt(p1 * (1.0 - p1) + p2 * (1.0 - p2))
    ) ** 2
    denominator = (p2 - p1) ** 2
    return int(math.ceil(numerator / denominator))


def power_two_proportions(
    p_base: float, rel_lift: float, n_per_arm: int, alpha: float = 0.05
) -> float:
    """Return power under the normal approximation for two proportions."""
    if n_per_arm <= 0:
        return float("nan")
    p1 = float(p_base)
    p2 = p1 * (1.0 + float(rel_lift))
    delta = abs(p2 - p1)
    pbar = 0.5 * (p1 + p2)
    se_null = math.sqrt(2.0 * pbar * (1.0 - pbar) / n_per_arm)
    se_alt = math.sqrt(
        (p1 * (1.0 - p1) + p2 * (1.0 - p2)) / n_per_arm
    )
    if se_alt <= 0:
        return float("nan")
    z_alpha = float(stats.norm.ppf(1.0 - alpha / 2.0))
    return float(stats.norm.cdf((delta - z_alpha * se_null) / se_alt))


def mde_rel(
    p_base: float, n_per_arm: int, alpha: float = 0.05, power: float = 0.8
) -> float:
    """Return the smallest relative lift detectable with the given power."""
    if n_per_arm <= 0 or not 0.0 < p_base < 1.0:
        return float("nan")
    # Sample size falls monotonically as the lift grows, so bisect on the lift.
    lo = 1e-9
    hi = 1.0
    max_hi = 0.999 / p_base - 1.0
    if hi > max_hi:
        hi = max_hi
    while (
        sample_size_per_arm(p_base, hi, alpha=alpha, power=power) > n_per_arm
        and hi < max_hi
    ):
        hi = min(hi * 2.0, max_hi)
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if sample_size_per_arm(p_base, mid, alpha=alpha, power=power) > n_per_arm:
            lo = mid
        else:
            hi = mid
        if hi - lo < 1e-12:
            break
    return float(0.5 * (lo + hi))


def run_aa(
    df: pd.DataFrame, n_sims: int = 1000, alpha: float = 0.05, seed_salt: str = "aa"
) -> dict:
    """Run repeated A/A splits and return false-positive rates and p-value diagnostics."""
    hashes = user_hash(df["user_pseudo_id"])
    converted = df["converted"].to_numpy(dtype=bool)
    revenue = df["revenue_usd"].to_numpy(dtype=float)

    p_values_conversion: list[float] = []
    p_values_revenue: list[float] = []
    for s in range(n_sims):
        group = assign(hashes, f"{seed_salt}-{s}")
        control = group == 0
        treatment = group == 1
        conversion = two_proportion_test(
            converted[control].sum(),
            control.sum(),
            converted[treatment].sum(),
            treatment.sum(),
            alpha,
        )
        p_values_conversion.append(conversion["p_value"])
        p_values_revenue.append(welch_test(revenue[control], revenue[treatment], alpha)["p_value"])

    conv = np.asarray(p_values_conversion, dtype=float)
    rev = np.asarray(p_values_revenue, dtype=float)
    finite_conv = conv[np.isfinite(conv)]
    if finite_conv.size:
        ks_p = float(stats.kstest(finite_conv, "uniform").pvalue)
    else:
        ks_p = float("nan")
    band_low, band_high = stats.binom.ppf([0.025, 0.975], n_sims, alpha) / n_sims

    return {
        "fpr_conversion": float(np.mean(conv < alpha)),
        "fpr_revenue": float(np.mean(rev < alpha)),
        "p_values_conversion": [float(p) for p in p_values_conversion],
        "ks_p_conversion": ks_p,
        "band_low": float(band_low),
        "band_high": float(band_high),
        "n_sims": int(n_sims),
        "n_users": int(df.shape[0]),
    }


def run_planted(
    df: pd.DataFrame,
    rel_lifts: tuple[float, ...] = (0.05, 0.10, 0.20),
    n_sims: int = 1000,
    alpha: float = 0.05,
    seed: int = 0,
) -> list[dict]:
    """Plant known relative lifts in the treatment arm and summarise the tests."""
    hashes = user_hash(df["user_pseudo_id"])
    converted = df["converted"].to_numpy(dtype=bool)
    p = float(converted.mean())
    results = []

    for lift_index, rel_lift in enumerate(rel_lifts):
        lift = float(rel_lift)
        true_diff = p * lift
        q = p * lift / (1.0 - p) if p < 1.0 else 0.0
        q = min(max(q, 0.0), 1.0)
        estimates: list[float] = []
        rejections = 0
        covered = 0
        for s in range(n_sims):
            group = assign(hashes, f"planted-{lift}-{s}")
            treatment = group == 1
            planted = converted.copy()
            eligible = treatment & ~converted
            n_eligible = int(eligible.sum())
            if n_eligible and q > 0.0:
                rng = np.random.default_rng([seed, lift_index, s])
                planted[eligible] = rng.random(n_eligible) < q
            control_mask = ~treatment
            result = two_proportion_test(
                planted[control_mask].sum(),
                control_mask.sum(),
                planted[treatment].sum(),
                treatment.sum(),
                alpha,
            )
            estimates.append(result["diff"])
            if result["p_value"] < alpha:
                rejections += 1
            if result["ci_low"] <= true_diff <= result["ci_high"]:
                covered += 1

        mean_estimate = float(np.mean(estimates))
        results.append(
            {
                "rel_lift": lift,
                "true_diff": float(true_diff),
                "mean_estimate": mean_estimate,
                "bias": float(mean_estimate - true_diff),
                "power": float(rejections / n_sims),
                "coverage": float(covered / n_sims),
                "n_sims": int(n_sims),
            }
        )
    return results


def cuped(y: Any, x: Any) -> dict:
    """Apply CUPED using a pre-period covariate and report the variance reduction."""
    y = np.asarray(y, dtype=float)
    x = np.asarray(x, dtype=float)
    var_x = float(x.var())
    if var_x == 0.0:
        return {
            "theta": 0.0,
            "y_adj": y.copy(),
            "variance_reduction": 0.0,
        }
    theta = float(np.cov(y, x, ddof=1)[0, 1] / x.var(ddof=1))
    y_adj = y - theta * (x - x.mean())
    var_y = float(y.var())
    reduction = 0.0 if var_y == 0.0 else float(1.0 - y_adj.var() / var_y)
    return {
        "theta": theta,
        "y_adj": y_adj,
        "variance_reduction": reduction,
    }


def cuped_report(df: pd.DataFrame, n_boot: int = 500, seed: int = 0) -> dict:
    """Report CUPED variance reduction for conversion and revenue."""
    n_users = int(df.shape[0])
    rng = np.random.default_rng(seed)

    def summary(y: np.ndarray, x: np.ndarray) -> dict:
        full = cuped(y, x)
        boots = np.empty(n_boot, dtype=float)
        for b in range(n_boot):
            idx = rng.integers(0, n_users, n_users)
            boots[b] = cuped(y[idx], x[idx])["variance_reduction"]
        low, high = np.percentile(boots, [2.5, 97.5])
        return {
            "variance_reduction": float(full["variance_reduction"]),
            "ci_low": float(low),
            "ci_high": float(high),
            "theta": float(full["theta"]),
        }

    conversion = summary(
        df["converted"].to_numpy(dtype=float),
        df["pre_sessions"].to_numpy(dtype=float),
    )
    revenue = summary(
        df["revenue_usd"].to_numpy(dtype=float),
        df["pre_revenue_usd"].to_numpy(dtype=float),
    )
    return {
        "share_with_pre_period": float(df["has_pre_period"].mean()),
        "n_users": n_users,
        "conversion": conversion,
        "revenue": revenue,
    }


def obf_constant(
    info_fractions: Any,
    alpha: float = 0.05,
    n_paths: int = 200_000,
    seed: int = 0,
) -> float:
    """Return a Monte-Carlo calibrated O'Brien-Fleming-shaped two-sided boundary."""
    times = np.asarray(info_fractions, dtype=float)
    increments = np.diff(np.concatenate(([0.0], times)))
    rng = np.random.default_rng(seed)
    shocks = rng.standard_normal((n_paths, times.size)) * np.sqrt(increments)
    brownian = np.cumsum(shocks, axis=1)
    # |Z_k| >= c / sqrt(t_k) is exactly |B(t_k)| >= c, so only the running
    # maximum absolute Brownian path matters.
    maxima = np.sort(np.abs(brownian).max(axis=1))
    n = maxima.size

    def tail(c: float) -> float:
        exceeded = n - int(np.searchsorted(maxima, c, side="left"))
        return exceeded / n

    lo = 0.0
    hi = float(maxima[-1]) if n else 1.0
    hi = max(hi, 1.0) + 1.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if tail(mid) > alpha:
            lo = mid
        else:
            hi = mid
        if hi - lo < 1e-12:
            break
    return float(0.5 * (lo + hi))


def run_peeking(
    df: pd.DataFrame,
    n_sims: int = 1000,
    alpha: float = 0.05,
    n_days: int = 28,
    seed_salt: str = "peek",
) -> dict:
    """Compare fixed-horizon, naive peeking, and sequential false-positive rates."""
    n_users = int(df.shape[0])
    hashes = user_hash(df["user_pseudo_id"])
    entry = df["entry_day_index"].to_numpy(dtype=int)
    converted = df["converted"].to_numpy(dtype=bool)
    purchase_day = df["first_purchase_day_index"].to_numpy(dtype=float)
    conv_day = np.full(n_users, -1, dtype=int)
    conv_day[converted] = np.nan_to_num(purchase_day[converted], nan=-1.0).astype(int)

    daily_users = np.bincount(entry, minlength=n_days)[:n_days]
    info = np.cumsum(daily_users.astype(float)) / max(n_users, 1)
    positive = info[info > 0.0]
    if positive.size == 0:
        positive = np.array([1.0])
    constant = obf_constant(positive, alpha=alpha)
    z_alpha = float(stats.norm.ppf(1.0 - alpha / 2.0))

    fixed = 0
    naive = 0
    sequential = 0
    for s in range(n_sims):
        group = assign(hashes, f"{seed_salt}-{s}")
        arms = []
        for arm in (0, 1):
            mask = group == arm
            users_day = np.bincount(entry[mask], minlength=n_days)[:n_days]
            conv_mask = mask & (conv_day >= 0)
            conv_counts = np.bincount(
                conv_day[conv_mask], minlength=n_days
            )[:n_days]
            arms.append(
                (np.cumsum(users_day), np.cumsum(conv_counts))
            )
        users_c, conv_c = arms[0]
        users_t, conv_t = arms[1]

        any_naive = False
        any_sequential = False
        final_fixed = False
        for d in range(n_days):
            n_c = int(users_c[d])
            n_t = int(users_t[d])
            x_c = int(conv_c[d])
            x_t = int(conv_t[d])
            if n_c == 0 or n_t == 0:
                continue
            pooled = (x_c + x_t) / (n_c + n_t)
            if pooled <= 0.0 or pooled >= 1.0:
                continue
            se = math.sqrt(pooled * (1.0 - pooled) * (1.0 / n_c + 1.0 / n_t))
            if se <= 0.0:
                continue
            z = (x_t / n_t - x_c / n_c) / se
            t_d = (n_c + n_t) / max(n_users, 1)
            if abs(z) >= z_alpha:
                any_naive = True
                if d == n_days - 1:
                    final_fixed = True
            if t_d > 0.0 and abs(z) >= constant / math.sqrt(t_d):
                any_sequential = True

        fixed += int(final_fixed)
        naive += int(any_naive)
        sequential += int(any_sequential)

    band_low, band_high = stats.binom.ppf([0.025, 0.975], n_sims, alpha) / n_sims
    return {
        "fpr_fixed_horizon": float(fixed / n_sims),
        "fpr_naive_peeking": float(naive / n_sims),
        "fpr_sequential": float(sequential / n_sims),
        "obf_constant": float(constant),
        "n_looks": int(n_days),
        "n_sims": int(n_sims),
        "band_low": float(band_low),
        "band_high": float(band_high),
    }


def wilson(k: float, n: float, alpha: float = 0.05) -> tuple[float, float]:
    """Return the Wilson score interval for a binomial proportion."""
    if n <= 0:
        return float("nan"), float("nan")
    z = float(stats.norm.ppf(1.0 - alpha / 2.0))
    p = float(k) / float(n)
    denominator = 1.0 + z * z / n
    centre = (p + z * z / (2.0 * n)) / denominator
    half = z * math.sqrt(p * (1.0 - p) / n + z * z / (4.0 * n * n))
    half /= denominator
    return float(centre - half), float(centre + half)


def _num(
    value: float,
    ci_low: float | None = None,
    ci_high: float | None = None,
    n: int = 0,
) -> dict:
    """Build a published number with optional interval and denominator."""
    return {
        "value": float(value),
        "ci_low": None if ci_low is None else float(ci_low),
        "ci_high": None if ci_high is None else float(ci_high),
        "n": int(n),
    }


def _rate_num(rate: float, n_sims: int, alpha: float = 0.05) -> dict:
    """Build a simulated-rate number with a Wilson interval."""
    k = int(round(float(rate) * n_sims))
    low, high = wilson(k, n_sims, alpha)
    return _num(rate, low, high, n_sims)


def _bootstrap_mean_ci(
    values: Any, n_boot: int = 500, alpha: float = 0.05, seed: int = 0
) -> tuple[float, float]:
    """Return a percentile bootstrap interval for a mean."""
    values = np.asarray(values, dtype=float)
    n = values.size
    if n == 0:
        return float("nan"), float("nan")
    rng = np.random.default_rng(seed)
    boots = np.empty(n_boot, dtype=float)
    for b in range(n_boot):
        boots[b] = values[rng.integers(0, n, n)].mean()
    low, high = np.percentile(boots, [100.0 * alpha / 2.0, 100.0 * (1.0 - alpha / 2.0)])
    return float(low), float(high)


def build_artefact(df: pd.DataFrame, n_sims: int = 1000) -> dict:
    """Build the complete set of published experiment-validity numbers."""
    n_users = int(df.shape[0])
    alpha = ALPHA
    converted = df["converted"].to_numpy(dtype=bool)
    p = float(converted.mean())
    n_per_arm = n_users // 2

    conv_low, conv_high = wilson(int(converted.sum()), n_users, alpha)
    rev_mean = float(df["revenue_usd"].mean())
    rev_low, rev_high = _bootstrap_mean_ci(df["revenue_usd"], seed=101)

    power_rows = []
    for rel_lift in (0.02, 0.05, 0.10, 0.20):
        needed = sample_size_per_arm(p, rel_lift, alpha=alpha)
        power_rows.append(
            {
                "rel_lift": float(rel_lift),
                "n_per_arm_needed": int(needed),
                "power_at_actual_n": float(
                    power_two_proportions(p, rel_lift, n_per_arm, alpha=alpha)
                ),
            }
        )

    aa = run_aa(df, n_sims=n_sims, alpha=alpha)
    planted_raw = run_planted(df, n_sims=n_sims, alpha=alpha)
    planted = []
    for row in planted_raw:
        planted.append(
            {
                "rel_lift": float(row["rel_lift"]),
                "true_diff": float(row["true_diff"]),
                "bias": float(row["bias"]),
                "power": _rate_num(row["power"], n_sims, alpha),
                "coverage": _rate_num(row["coverage"], n_sims, alpha),
                "pass": bool(0.93 <= row["coverage"] <= 0.97),
            }
        )

    cuped_raw = cuped_report(df)
    share_low, share_high = wilson(
        int(df["has_pre_period"].sum()), n_users, alpha
    )
    peek = run_peeking(df, n_sims=n_sims, alpha=alpha)

    # One fixed A/A split tested two ways per metric: the plan's cross-check of each method.
    arm = assign(user_hash(df["user_pseudo_id"]), "crosscheck")
    revenue = df["revenue_usd"].to_numpy(dtype=float)
    control, treated = arm == 0, arm == 1
    z_check = two_proportion_test(
        int(converted[control].sum()), int(control.sum()),
        int(converted[treated].sum()), int(treated.sum()), alpha=alpha,
    )
    welch_check = welch_test(revenue[control], revenue[treated], alpha=alpha)
    boot_low, boot_high = bootstrap_diff_ci(revenue[control], revenue[treated], alpha=alpha)
    cross_checks = {
        "split_salt": "crosscheck",
        "conversion": {
            "z_test_p": float(z_check["p_value"]),
            "permutation_p": float(permutation_test(converted.astype(float), arm)),
            "n_perm": 2000,
        },
        "revenue": {
            "diff": float(welch_check["diff"]),
            "welch_ci": [float(welch_check["ci_low"]), float(welch_check["ci_high"])],
            "bootstrap_ci": [float(boot_low), float(boot_high)],
            "n_boot": 2000,
        },
    }

    return {
        "cross_checks": cross_checks,
        "meta": {
            "n_users": n_users,
            "window_days": WINDOW_DAYS,
            "n_sims": int(n_sims),
            "alpha": float(alpha),
            "synthetic": False,
            "note": NOTE,
        },
        "baseline": {
            "conversion_rate": _num(p, conv_low, conv_high, n_users),
            "revenue_per_user": _num(rev_mean, rev_low, rev_high, n_users),
        },
        "power": power_rows,
        "mde_at_actual_n": float(mde_rel(p, n_per_arm, alpha=alpha)),
        "aa": {
            "fpr_conversion": _rate_num(aa["fpr_conversion"], n_sims, alpha),
            "fpr_revenue": _rate_num(aa["fpr_revenue"], n_sims, alpha),
            "band_low": float(aa["band_low"]),
            "band_high": float(aa["band_high"]),
            "ks_p_conversion": float(aa["ks_p_conversion"]),
            "pass_conversion": bool(
                aa["band_low"] <= aa["fpr_conversion"] <= aa["band_high"]
            ),
            "pass_revenue": bool(
                aa["band_low"] <= aa["fpr_revenue"] <= aa["band_high"]
            ),
        },
        "planted": planted,
        "cuped": {
            "share_with_pre_period": _num(
                cuped_raw["share_with_pre_period"], share_low, share_high, n_users
            ),
            "conversion": {
                "variance_reduction": _num(
                    cuped_raw["conversion"]["variance_reduction"],
                    cuped_raw["conversion"]["ci_low"],
                    cuped_raw["conversion"]["ci_high"],
                    n_users,
                ),
                "theta": float(cuped_raw["conversion"]["theta"]),
            },
            "revenue": {
                "variance_reduction": _num(
                    cuped_raw["revenue"]["variance_reduction"],
                    cuped_raw["revenue"]["ci_low"],
                    cuped_raw["revenue"]["ci_high"],
                    n_users,
                ),
                "theta": float(cuped_raw["revenue"]["theta"]),
            },
        },
        "peeking": {
            "fpr_fixed_horizon": _rate_num(
                peek["fpr_fixed_horizon"], n_sims, alpha
            ),
            "fpr_naive_peeking": _rate_num(
                peek["fpr_naive_peeking"], n_sims, alpha
            ),
            "fpr_sequential": _rate_num(peek["fpr_sequential"], n_sims, alpha),
            "obf_constant": float(peek["obf_constant"]),
            "n_looks": int(peek["n_looks"]),
            "band_low": float(peek["band_low"]),
            "band_high": float(peek["band_high"]),
            "pass_sequential": bool(
                peek["fpr_sequential"] <= peek["band_high"]
            ),
        },
    }


def _jsonable(value: Any) -> Any:
    """Recursively convert numpy and pandas scalars to plain Python values."""
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, np.ndarray):
        return [_jsonable(item) for item in value.tolist()]
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    return value


def main(argv: list[str] | None = None) -> None:
    """Run the experiment-validity build from the command line."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--outcomes", required=True, help="Parquet file with user outcomes")
    parser.add_argument("--out", required=True, help="Destination JSON file")
    parser.add_argument("--sims", type=int, default=1000, help="Monte-Carlo simulations")
    parser.add_argument(
        "--synthetic",
        action="store_true",
        help="Mark the outcomes as synthetic rather than real traffic",
    )
    args = parser.parse_args(argv)

    outcomes = pd.read_parquet(args.outcomes)
    # Resampling must not depend on the row order of the file.
    outcomes = outcomes.sort_values("user_pseudo_id").reset_index(drop=True)
    artefact = build_artefact(outcomes, n_sims=args.sims)
    artefact["meta"]["synthetic"] = bool(args.synthetic)

    destination = Path(args.out)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(_jsonable(artefact), indent=1),
        encoding="utf-8",
    )
    print(destination)


if __name__ == "__main__":
    main()
