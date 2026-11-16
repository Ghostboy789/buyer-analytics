"""Tests for the descriptive statistics and the revenue decomposition."""

import math
import sys
from pathlib import Path

import numpy as np
import pytest
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.proportion import proportion_confint

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from analysis.decompose import lmdi, log_decompose  # noqa: E402
from analysis.stats_util import bootstrap_ratio, holm, wilson  # noqa: E402


def test_wilson_matches_statsmodels():
    low, high = wilson(50, 1000)
    expected_low, expected_high = proportion_confint(50, 1000, method="wilson")
    assert low == pytest.approx(float(expected_low), abs=1e-9)
    assert high == pytest.approx(float(expected_high), abs=1e-9)
    assert wilson(0, 0) == (None, None)


def test_holm_matches_statsmodels():
    p_values = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06]
    expected = multipletests(p_values, method="holm")[1]
    actual = holm(p_values)
    assert np.allclose(actual, expected, atol=1e-12, rtol=0.0)


def test_log_decompose_sums_to_total():
    rng = np.random.default_rng(7)
    for _ in range(20):
        sessions_from = float(rng.uniform(1000.0, 10_000.0))
        sessions_to = float(rng.uniform(1000.0, 10_000.0))
        orders_from = float(rng.uniform(10.0, sessions_from / 10.0))
        orders_to = float(rng.uniform(10.0, sessions_to / 10.0))
        revenue_from = float(rng.uniform(orders_from * 10.0, orders_from * 100.0))
        revenue_to = float(rng.uniform(orders_to * 10.0, orders_to * 100.0))

        parts = log_decompose(
            {
                "sessions": sessions_from,
                "orders": orders_from,
                "revenue_usd": revenue_from,
            },
            {
                "sessions": sessions_to,
                "orders": orders_to,
                "revenue_usd": revenue_to,
            },
        )
        component_sum = (
            parts["sessions"] + parts["conversion"] + parts["aov"]
        )
        assert parts["total"] == pytest.approx(component_sum, abs=1e-12)


def test_log_decompose_doubled_sessions():
    parts = log_decompose(
        {"sessions": 1000.0, "orders": 50.0, "revenue_usd": 5000.0},
        {"sessions": 2000.0, "orders": 100.0, "revenue_usd": 10000.0},
    )
    assert parts["sessions"] == pytest.approx(math.log(2.0), abs=1e-12)
    assert parts["conversion"] == pytest.approx(0.0, abs=1e-12)
    assert parts["aov"] == pytest.approx(0.0, abs=1e-12)
    assert parts["total"] == pytest.approx(math.log(2.0), abs=1e-12)


def test_lmdi_effects_sum_to_segment_and_total_deltas():
    rng = np.random.default_rng(11)
    names = ["alpha", "beta", "gamma", "delta"]
    segments_from = {}
    segments_to = {}
    for name in names:
        for target in (segments_from, segments_to):
            sessions = float(rng.uniform(2000.0, 20_000.0))
            orders = float(rng.uniform(20.0, sessions / 20.0))
            revenue = float(rng.uniform(orders * 20.0, orders * 200.0))
            target[name] = {
                "sessions": sessions,
                "orders": orders,
                "revenue_usd": revenue,
            }

    rows = lmdi(segments_from, segments_to)
    assert len(rows) == 4

    total_delta = 0.0
    for row in rows:
        effect_sum = (
            row["sessions_effect"]
            + row["conversion_effect"]
            + row["aov_effect"]
        )
        assert effect_sum == pytest.approx(row["delta_revenue_usd"], abs=1e-9)
        total_delta += row["delta_revenue_usd"]

    expected_delta = sum(
        segments_to[name]["revenue_usd"] - segments_from[name]["revenue_usd"]
        for name in names
    )
    assert total_delta == pytest.approx(expected_delta, abs=1e-9)


def test_lmdi_merges_zero_order_segment_into_other():
    segments_from = {
        "alpha": {"sessions": 1000.0, "orders": 40.0, "revenue_usd": 4000.0},
        "beta": {"sessions": 2000.0, "orders": 80.0, "revenue_usd": 8000.0},
        "gamma": {"sessions": 500.0, "orders": 10.0, "revenue_usd": 1250.0},
    }
    segments_to = {
        "alpha": {"sessions": 1100.0, "orders": 44.0, "revenue_usd": 4400.0},
        "beta": {"sessions": 1900.0, "orders": 76.0, "revenue_usd": 7600.0},
        "gamma": {"sessions": 550.0, "orders": 0.0, "revenue_usd": 0.0},
    }

    rows = lmdi(segments_from, segments_to)
    by_segment = {row["segment"]: row for row in rows}
    assert "gamma" not in by_segment
    assert "other" in by_segment

    other = by_segment["other"]
    assert other["delta_revenue_usd"] == pytest.approx(-1250.0, abs=1e-9)
    assert other["sessions_effect"] == pytest.approx(-1250.0, abs=1e-9)
    assert other["conversion_effect"] == pytest.approx(0.0, abs=1e-12)
    assert other["aov_effect"] == pytest.approx(0.0, abs=1e-12)
    assert "note" in other

    effect_sum = sum(
        row["sessions_effect"] + row["conversion_effect"] + row["aov_effect"]
        for row in rows
    )
    segment_sum = sum(
        by_segment[name]["delta_revenue_usd"] for name in by_segment
    )
    assert effect_sum == pytest.approx(segment_sum, abs=1e-9)


def test_bootstrap_ratio_contains_point_and_is_deterministic():
    numer = np.array([10.0, 20.0, 30.0, 40.0, 50.0])
    denom = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    point = float(numer.sum() / denom.sum())

    low, high = bootstrap_ratio(numer, denom, n_boot=500, seed=7)
    assert low is not None
    assert high is not None
    assert low <= point <= high

    again = bootstrap_ratio(numer, denom, n_boot=500, seed=7)
    assert again == (low, high)
