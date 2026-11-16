"""Check that MetricFlow queries agree with the metrics_daily mart."""

from __future__ import annotations

import csv
import os
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

import duckdb
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
DBT_DIR = REPO_ROOT / "dbt"
DBT_DB = DBT_DIR / "buyer.duckdb"
METRICS_DAILY = REPO_ROOT / "marts_out" / "metrics_daily.parquet"

pytestmark = [
    pytest.mark.fulldata,
    pytest.mark.skipif(
        not METRICS_DAILY.is_file() or not DBT_DB.is_file(),
        reason="needs the built metrics_daily mart and dbt/buyer.duckdb",
    ),
]


def _mf_executable() -> str:
    candidate = Path(sys.executable).with_name("mf")
    if candidate.is_file():
        return str(candidate)
    found = shutil.which("mf")
    if found:
        return found
    raise RuntimeError("mf executable not found")


def _run_mf(args: list[str], csv_path: Path) -> None:
    env = os.environ.copy()
    env["DBT_PROFILES_DIR"] = "."
    result = subprocess.run(
        [_mf_executable(), "query", *args, "--csv", str(csv_path)],
        cwd=DBT_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert result.returncode == 0, (
        "mf query failed\n"
        f"--- stdout ---\n{result.stdout}\n"
        f"--- stderr ---\n{result.stderr}"
    )


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def _as_date(value: str) -> date:
    return date.fromisoformat(value.split("T", 1)[0].split(" ", 1)[0])


def _metrics_daily_rows() -> dict[date, tuple]:
    con = duckdb.connect()
    rows = con.execute(
        """
        select
            date_day,
            sessions,
            orders,
            revenue_usd,
            purchasing_sessions,
            items_quantity,
            zero_revenue_orders
        from read_parquet(?)
        order by date_day
        """,
        [str(METRICS_DAILY)],
    ).fetchall()
    con.close()
    return {row[0]: row[1:] for row in rows}


def _monthly_ratio_rows() -> dict[date, tuple]:
    con = duckdb.connect()
    rows = con.execute(
        """
        select
            date_trunc('month', date_day)::date as month,
            sum(purchasing_sessions)::double / nullif(sum(sessions), 0)
                as session_conversion,
            sum(revenue_usd)::double / nullif(sum(orders), 0) as aov,
            sum(items_quantity)::double / nullif(sum(orders), 0)
                as items_per_order,
            sum(zero_revenue_orders)::double / nullif(sum(orders), 0)
                as zero_revenue_order_share
        from read_parquet(?)
        group by 1
        order by 1
        """,
        [str(METRICS_DAILY)],
    ).fetchall()
    con.close()
    return {row[0]: row[1:] for row in rows}


def test_daily_counts_and_revenue_match_metrics_daily(tmp_path: Path) -> None:
    csv_path = tmp_path / "daily.csv"
    _run_mf(
        ["--metrics", "sessions,orders,revenue", "--group-by", "metric_time__day"],
        csv_path,
    )

    actual = {_as_date(row["metric_time__day"]): row for row in _read_csv(csv_path)}
    expected = _metrics_daily_rows()

    assert set(actual) == set(expected)
    for day, (
        sessions,
        orders,
        revenue_usd,
        _purchasing_sessions,
        _items_quantity,
        _zero_revenue_orders,
    ) in expected.items():
        row = actual[day]
        assert int(float(row["sessions"])) == sessions
        assert int(float(row["orders"])) == orders
        assert float(row["revenue"]) == pytest.approx(revenue_usd, abs=1e-6)


def test_monthly_ratios_match_metrics_daily_sums(tmp_path: Path) -> None:
    metric_names = [
        "session_conversion",
        "aov",
        "items_per_order",
        "zero_revenue_order_share",
    ]
    csv_path = tmp_path / "monthly.csv"
    _run_mf(
        [
            "--metrics",
            ",".join(metric_names),
            "--group-by",
            "metric_time__month",
        ],
        csv_path,
    )

    actual = {_as_date(row["metric_time__month"]): row for row in _read_csv(csv_path)}
    expected = _monthly_ratio_rows()

    assert set(actual) == set(expected)
    for month, values in expected.items():
        row = actual[month]
        for metric_name, value in zip(metric_names, values, strict=True):
            assert float(row[metric_name]) == pytest.approx(value, abs=1e-9)
