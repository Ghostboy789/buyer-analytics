"""Tests for the experiment-validity engine."""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from scipy import stats

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from analysis.experiments import (  # noqa: E402
    assign,
    build_artefact,
    cuped,
    mde_rel,
    obf_constant,
    permutation_test,
    power_two_proportions,
    run_aa,
    run_peeking,
    run_planted,
    sample_size_per_arm,
    two_proportion_test,
    user_hash,
    welch_test,
)


def make_users(n: int = 20_000, p: float = 0.05, seed: int = 1) -> pd.DataFrame:
    """Build a synthetic user-outcomes frame with every input column."""
    rng = np.random.default_rng(seed)
    entry = rng.integers(0, 28, n)
    converted = rng.random(n) < p

    first_purchase = np.full(n, np.nan)
    buying = np.flatnonzero(converted)
    first_purchase[buying] = rng.integers(entry[buying], 28, buying.size)

    orders = np.zeros(n, dtype=int)
    orders[converted] = 1 + rng.integers(0, 3, int(converted.sum()))

    revenue = np.zeros(n)
    revenue[converted] = rng.lognormal(3.0, 0.8, int(converted.sum()))

    pre_sessions = rng.poisson(0.5, n)
    pre_orders = rng.poisson(0.1, n)
    pre_revenue = np.where(pre_orders > 0, rng.lognormal(3.0, 0.8, n), 0.0)

    return pd.DataFrame(
        {
            "user_pseudo_id": [f"user-{i}" for i in range(n)],
            "entry_day_index": entry,
            "converted": converted,
            "first_purchase_day_index": first_purchase,
            "orders": orders,
            "revenue_usd": revenue,
            "has_pre_period": pre_sessions > 0,
            "pre_sessions": pre_sessions,
            "pre_orders": pre_orders,
            "pre_revenue_usd": pre_revenue,
            "device_category": rng.choice(["desktop", "mobile", "tablet"], n),
            "channel": rng.choice(["organic", "paid", "email"], n),
        }
    )


def test_make_users_columns():
    df = make_users(n=500)
    assert list(df.columns) == [
        "user_pseudo_id",
        "entry_day_index",
        "converted",
        "first_purchase_day_index",
        "orders",
        "revenue_usd",
        "has_pre_period",
        "pre_sessions",
        "pre_orders",
        "pre_revenue_usd",
        "device_category",
        "channel",
    ]
    buyers = df[df["converted"]]
    assert (buyers["first_purchase_day_index"] >= buyers["entry_day_index"]).all()
    assert (buyers["revenue_usd"] > 0).all()
    assert (df.loc[~df["converted"], "revenue_usd"] == 0).all()


def test_sample_size_known_answer():
    assert sample_size_per_arm(0.10, 0.20) == 3841


def test_two_proportion_test_known_answer():
    result = two_proportion_test(100, 1000, 120, 1000)
    assert result["diff"] == pytest.approx(0.02, abs=1e-12)
    assert result["z"] == pytest.approx(1.4293, abs=1e-3)
    assert result["p_value"] == pytest.approx(0.1529, abs=1e-3)
    assert result["ci_low"] < 0.02 < result["ci_high"]
    assert result["ci_low"] == pytest.approx(-0.0074, abs=1e-3)
    assert result["ci_high"] == pytest.approx(0.0474, abs=1e-3)
    assert result["rel_lift"] == pytest.approx(0.2, abs=1e-12)


def test_power_and_mde():
    n = sample_size_per_arm(0.10, 0.20)
    power = power_two_proportions(0.10, 0.20, n)
    assert 0.80 <= power < 0.81
    assert mde_rel(0.10, 3841) == pytest.approx(0.20, abs=0.001)


def test_assign_is_deterministic_and_balanced():
    ids = np.array([f"id-{i}" for i in range(100_000)])
    hashes = user_hash(ids)
    first = assign(hashes, "salt-a")
    second = assign(hashes, "salt-a")
    assert np.array_equal(first, second)
    assert first.dtype == np.int8
    assert set(np.unique(first)) == {0, 1}
    assert 0.49 < first.mean() < 0.51

    other = assign(hashes, "salt-b")
    agreement = float(np.mean(first == other))
    assert 0.49 < agreement < 0.51


def test_welch_matches_scipy():
    rng = np.random.default_rng(11)
    y_c = rng.normal(1.0, 2.0, 300)
    y_t = rng.normal(1.4, 2.5, 240)
    result = welch_test(y_c, y_t)
    reference = stats.ttest_ind(y_t, y_c, equal_var=False)
    assert result["diff"] == pytest.approx(float(y_t.mean() - y_c.mean()), abs=1e-12)
    assert result["t"] == pytest.approx(float(reference.statistic), abs=1e-9)
    assert result["p_value"] == pytest.approx(float(reference.pvalue), abs=1e-9)


def test_permutation_test_clear_and_null():
    rng = np.random.default_rng(5)
    y_c = rng.normal(0.0, 1.0, 200)
    y_t = rng.normal(1.0, 1.0, 200)
    group = np.concatenate([np.zeros(200, dtype=int), np.ones(200, dtype=int)])
    clear = permutation_test(np.concatenate([y_c, y_t]), group, n_perm=2000, seed=3)
    assert clear < 0.01

    y = rng.normal(0.0, 1.0, 400)
    null = permutation_test(y, rng.permutation(group), n_perm=2000, seed=9)
    assert null > 0.05


def test_run_aa_false_positive_rate():
    df = make_users()
    result = run_aa(df, n_sims=400)
    assert 0.025 < result["fpr_conversion"] < 0.08
    assert len(result["p_values_conversion"]) == 400
    assert result["band_low"] < result["band_high"]


def test_run_planted_recovery():
    df = make_users()
    result = run_planted(df, rel_lifts=(0.20,), n_sims=300)
    assert len(result) == 1
    row = result[0]
    expected = float(df["converted"].mean()) * 0.20
    assert row["true_diff"] == pytest.approx(expected, abs=1e-12)
    assert row["coverage"] >= 0.90
    assert abs(row["bias"]) < 0.002


def test_cuped_known_variance_reduction():
    rng = np.random.default_rng(7)
    x = rng.standard_normal(50_000)
    noise = rng.standard_normal(50_000)
    y = 0.6 * x + np.sqrt(1.0 - 0.36) * noise
    result = cuped(y, x)
    assert result["variance_reduction"] == pytest.approx(0.36, abs=0.03)
    assert result["theta"] == pytest.approx(0.6, abs=0.03)
    assert float(np.mean(result["y_adj"])) == pytest.approx(float(np.mean(y)), abs=1e-9)


def test_obf_constant_known_answer():
    constant = obf_constant(np.linspace(0.2, 1.0, 5))
    assert constant == pytest.approx(2.04, abs=0.03)


def test_run_peeking_calibration():
    df = make_users(seed=2)
    result = run_peeking(df, n_sims=300)
    assert result["fpr_naive_peeking"] > 0.12
    assert result["fpr_sequential"] < 0.09
    assert result["fpr_sequential"] < result["fpr_naive_peeking"]


def test_build_artefact_layout():
    artefact = build_artefact(make_users(), n_sims=100)
    assert {
        "meta",
        "baseline",
        "power",
        "mde_at_actual_n",
        "aa",
        "planted",
        "cuped",
        "peeking",
    } <= set(artefact)

    numbers = [
        artefact["baseline"]["conversion_rate"],
        artefact["baseline"]["revenue_per_user"],
        artefact["aa"]["fpr_conversion"],
        artefact["aa"]["fpr_revenue"],
        artefact["cuped"]["share_with_pre_period"],
        artefact["cuped"]["conversion"]["variance_reduction"],
        artefact["cuped"]["revenue"]["variance_reduction"],
        artefact["peeking"]["fpr_fixed_horizon"],
        artefact["peeking"]["fpr_naive_peeking"],
        artefact["peeking"]["fpr_sequential"],
    ]
    for row in artefact["planted"]:
        numbers.extend([row["power"], row["coverage"]])

    for number in numbers:
        assert set(number) == {"value", "ci_low", "ci_high", "n"}
        assert isinstance(number["value"], float)
        assert isinstance(number["n"], int)

    assert artefact["meta"]["window_days"] == 28
    assert artefact["meta"]["synthetic"] is False
    assert len(artefact["power"]) == 4
    assert len(artefact["planted"]) == 3
    assert artefact["peeking"]["n_looks"] == 28
