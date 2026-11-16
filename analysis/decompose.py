"""Revenue decomposition across fixed periods, channels and devices."""

from __future__ import annotations

import argparse
import json
import math
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import duckdb
import numpy as np
import pandas as pd

import config
from analysis.stats_util import num

N_BOOT = 500
PERIODS = ("P1", "P2", "P3")
METRICS = ("sessions", "orders", "revenue_usd")


def _metric(metrics: Mapping[str, Any], name: str) -> float:
    """Read one additive metric from a period or segment mapping."""
    if name == "revenue_usd" and name not in metrics and "revenue" in metrics:
        name = "revenue"
    return float(metrics[name])


def _date_key(value: Any) -> str:
    """Return a YYYY-MM-DD string for a date or timestamp."""
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    return str(value)


def log_decompose(
    p_from: Mapping[str, Any],
    p_to: Mapping[str, Any],
) -> dict[str, float]:
    """Split the log revenue change into sessions, conversion and AOV changes."""
    sessions_from = _metric(p_from, "sessions")
    sessions_to = _metric(p_to, "sessions")
    orders_from = _metric(p_from, "orders")
    orders_to = _metric(p_to, "orders")
    revenue_from = _metric(p_from, "revenue_usd")
    revenue_to = _metric(p_to, "revenue_usd")

    sessions = math.log(sessions_to / sessions_from)
    conversion = math.log(
        (orders_to / sessions_to) / (orders_from / sessions_from)
    )
    aov = math.log(
        (revenue_to / orders_to) / (revenue_from / orders_from)
    )
    total = math.log(revenue_to / revenue_from)
    return {
        "total": float(total),
        "sessions": float(sessions),
        "conversion": float(conversion),
        "aov": float(aov),
    }


def _log_mean(a: float, b: float) -> float:
    """Return the logarithmic mean of two non-negative values, with L(a, a) = a."""
    if a == b:
        return float(a)
    if a <= 0.0 or b <= 0.0:
        # The limiting value of the logarithmic mean when one side is zero.
        return 0.0
    return float((a - b) / (math.log(a) - math.log(b)))


def _add_totals(target: dict[str, float], source: Mapping[str, Any]) -> None:
    """Add one segment's additive metrics to an accumulator."""
    for name in METRICS:
        target[name] += _metric(source, name)


def _empty_totals() -> dict[str, float]:
    return {name: 0.0 for name in METRICS}


def lmdi(
    segments_from: Mapping[str, Mapping[str, Any]],
    segments_to: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Split each segment's revenue change with the log-mean Divisia index.

    Segments with zero orders in either period are merged into ``other`` before
    the split. If that merged segment still has zero orders in a period, its
    whole dollar change is reported as a sessions effect and a note is added.
    """
    from_totals = {
        segment: {name: _metric(values, name) for name in METRICS}
        for segment, values in segments_from.items()
    }
    to_totals = {
        segment: {name: _metric(values, name) for name in METRICS}
        for segment, values in segments_to.items()
    }

    other_from = from_totals.pop("other", _empty_totals())
    other_to = to_totals.pop("other", _empty_totals())
    other_had_input = "other" in segments_from or "other" in segments_to

    kept: list[str] = []
    for segment in sorted(set(from_totals) | set(to_totals)):
        left = from_totals.get(segment, _empty_totals())
        right = to_totals.get(segment, _empty_totals())
        if left["orders"] == 0.0 or right["orders"] == 0.0:
            _add_totals(other_from, left)
            _add_totals(other_to, right)
        else:
            kept.append(segment)

    active = {name: other_from[name] or other_to[name] for name in METRICS}
    has_other = other_had_input or any(active.values())
    if has_other:
        from_totals["other"] = other_from
        to_totals["other"] = other_to
        kept.append("other")

    rows: list[dict[str, Any]] = []
    for segment in sorted(kept, key=lambda value: (value == "other", value)):
        left = from_totals[segment]
        right = to_totals[segment]
        delta = right["revenue_usd"] - left["revenue_usd"]

        if (
            left["orders"] == 0.0
            or right["orders"] == 0.0
            or left["revenue_usd"] == 0.0
            or right["revenue_usd"] == 0.0
        ):
            row = {
                "segment": segment,
                "delta_revenue_usd": float(delta),
                "sessions_effect": float(delta),
                "conversion_effect": 0.0,
                "aov_effect": 0.0,
                "note": (
                    "zero orders or zero revenue in at least one period; "
                    "the whole revenue change is reported as the sessions effect"
                ),
            }
            rows.append(row)
            continue

        weight = _log_mean(right["revenue_usd"], left["revenue_usd"])
        sessions_effect = weight * math.log(right["sessions"] / left["sessions"])
        conversion_effect = weight * math.log(
            (right["orders"] / right["sessions"])
            / (left["orders"] / left["sessions"])
        )
        aov_effect = weight * math.log(
            (right["revenue_usd"] / right["orders"])
            / (left["revenue_usd"] / left["orders"])
        )
        rows.append(
            {
                "segment": segment,
                "delta_revenue_usd": float(delta),
                "sessions_effect": float(sessions_effect),
                "conversion_effect": float(conversion_effect),
                "aov_effect": float(aov_effect),
            }
        )
    return rows


def _sql_path(path: Path) -> str:
    """Quote a local path for a DuckDB SQL literal."""
    return "'" + str(path).replace("'", "''") + "'"


def _connect() -> duckdb.DuckDBPyConnection:
    """Open a DuckDB connection with the marts registered as views."""
    con = duckdb.connect()
    con.execute(
        "CREATE TEMP VIEW sessions AS SELECT * FROM read_parquet("
        + _sql_path(config.MARTS_DIR / "fct_sessions.parquet")
        + ")"
    )
    con.execute(
        "CREATE TEMP VIEW dates AS SELECT * FROM read_parquet("
        + _sql_path(config.MARTS_DIR / "dim_date.parquet")
        + ")"
    )
    return con


def _period_totals(con: duckdb.DuckDBPyConnection) -> dict[str, dict[str, Any]]:
    """Return sessions, orders and revenue for each fixed period."""
    frame = con.execute(
        """
        SELECT d.period,
               min(d.date_day) AS start_date,
               max(d.date_day) AS end_date,
               count(*) AS sessions,
               sum(s.orders) AS orders,
               sum(s.revenue_usd) AS revenue_usd
        FROM sessions s
        JOIN dates d ON s.session_date = d.date_day
        WHERE d.period <> 'none'
        GROUP BY d.period
        ORDER BY d.period
        """
    ).fetchdf()

    periods: dict[str, dict[str, Any]] = {}
    for row in frame.itertuples(index=False):
        sessions = int(row.sessions)
        orders = int(row.orders)
        revenue = float(row.revenue_usd)
        periods[str(row.period)] = {
            "start": _date_key(row.start_date),
            "end": _date_key(row.end_date),
            "sessions": sessions,
            "orders": orders,
            "revenue_usd": revenue,
            "conversion": float(orders / sessions),
            "aov": float(revenue / orders),
        }
    return periods


def _segment_totals(
    con: duckdb.DuckDBPyConnection, column: str
) -> dict[str, dict[str, Mapping[str, float]]]:
    """Return per-period segment totals for a session attribute."""
    if column not in {"channel", "device_category"}:
        raise ValueError(f"unsupported segment column: {column}")
    frame = con.execute(
        f"""
        SELECT d.period,
               s.{column} AS segment,
               count(*) AS sessions,
               sum(s.orders) AS orders,
               sum(s.revenue_usd) AS revenue_usd
        FROM sessions s
        JOIN dates d ON s.session_date = d.date_day
        WHERE d.period <> 'none'
        GROUP BY d.period, s.{column}
        ORDER BY d.period, s.{column}
        """
    ).fetchdf()

    totals: dict[str, dict[str, dict[str, float]]] = {period: {} for period in PERIODS}
    for row in frame.itertuples(index=False):
        totals[str(row.period)][str(row.segment)] = {
            "sessions": float(row.sessions),
            "orders": float(row.orders),
            "revenue_usd": float(row.revenue_usd),
        }
    return totals


def _user_totals(
    con: duckdb.DuckDBPyConnection, from_period: str, to_period: str
) -> pd.DataFrame:
    """Return per-user per-period totals for the bootstrap."""
    return con.execute(
        """
        SELECT d.period,
               s.user_pseudo_id,
               count(*) AS sessions,
               sum(s.orders) AS orders,
               sum(s.revenue_usd) AS revenue_usd
        FROM sessions s
        JOIN dates d ON s.session_date = d.date_day
        WHERE d.period IN (?, ?)
        GROUP BY d.period, s.user_pseudo_id
        ORDER BY d.period, s.user_pseudo_id
        """,
        [from_period, to_period],
    ).fetchdf()


def _percentile_interval(values: np.ndarray) -> tuple[float | None, float | None]:
    """Return the 2.5th and 97.5th percentiles of the finite values."""
    valid = values[np.isfinite(values)]
    if valid.size == 0:
        return None, None
    low, high = np.percentile(valid, [2.5, 97.5])
    return float(low), float(high)


def _bootstrap_log_changes(
    user_totals: pd.DataFrame,
    from_period: str,
    to_period: str,
    n_boot: int = N_BOOT,
    seed: int = 0,
) -> tuple[dict[str, tuple[float | None, float | None]], int]:
    """Bootstrap the four log changes by resampling users in the two periods."""
    left = user_totals[user_totals["period"] == from_period].set_index("user_pseudo_id")
    right = user_totals[user_totals["period"] == to_period].set_index("user_pseudo_id")
    users = left.index.union(right.index)

    sessions_from = left.reindex(users)["sessions"].fillna(0).to_numpy(dtype=float)
    sessions_to = right.reindex(users)["sessions"].fillna(0).to_numpy(dtype=float)
    orders_from = left.reindex(users)["orders"].fillna(0).to_numpy(dtype=float)
    orders_to = right.reindex(users)["orders"].fillna(0).to_numpy(dtype=float)
    revenue_from = left.reindex(users)["revenue_usd"].fillna(0).to_numpy(dtype=float)
    revenue_to = right.reindex(users)["revenue_usd"].fillna(0).to_numpy(dtype=float)

    size = users.size
    rng = np.random.default_rng(seed)
    draws = {name: np.full(n_boot, np.nan, dtype=float) for name in
             ("total", "sessions", "conversion", "aov")}

    for b in range(n_boot):
        index = rng.integers(0, size, size)
        s_from = float(sessions_from[index].sum())
        s_to = float(sessions_to[index].sum())
        o_from = float(orders_from[index].sum())
        o_to = float(orders_to[index].sum())
        r_from = float(revenue_from[index].sum())
        r_to = float(revenue_to[index].sum())
        if min(s_from, s_to, o_from, o_to, r_from, r_to) <= 0.0:
            continue

        draws["total"][b] = math.log(r_to / r_from)
        draws["sessions"][b] = math.log(s_to / s_from)
        draws["conversion"][b] = math.log(
            (o_to / s_to) / (o_from / s_from)
        )
        draws["aov"][b] = math.log((r_to / o_to) / (r_from / o_from))

    intervals = {name: _percentile_interval(values) for name, values in draws.items()}
    return intervals, int(size)


def _comparison(
    con: duckdb.DuckDBPyConnection,
    periods: dict[str, dict[str, Any]],
    from_period: str,
    to_period: str,
    seed: int,
) -> dict[str, Any]:
    """Build one period comparison with its LMDI splits and intervals."""
    point = log_decompose(periods[from_period], periods[to_period])
    intervals, n_users = _bootstrap_log_changes(
        _user_totals(con, from_period, to_period),
        from_period,
        to_period,
        seed=seed,
    )
    log_change = {
        name: num(point[name], intervals[name][0], intervals[name][1], n_users)
        for name in ("total", "sessions", "conversion", "aov")
    }

    channel_totals = _segment_totals(con, "channel")
    device_totals = _segment_totals(con, "device_category")
    by_channel = lmdi(
        channel_totals[from_period], channel_totals[to_period]
    )
    by_device = lmdi(
        device_totals[from_period], device_totals[to_period]
    )

    delta_revenue = float(
        periods[to_period]["revenue_usd"] - periods[from_period]["revenue_usd"]
    )
    channel_effects = sum(
        row["sessions_effect"] + row["conversion_effect"] + row["aov_effect"]
        for row in by_channel
    )
    device_effects = sum(
        row["sessions_effect"] + row["conversion_effect"] + row["aov_effect"]
        for row in by_device
    )
    segment_delta = sum(row["delta_revenue_usd"] for row in by_channel)
    sum_check = max(
        abs(channel_effects - delta_revenue),
        abs(device_effects - delta_revenue),
        abs(segment_delta - delta_revenue),
    )
    if sum_check >= 1e-6:
        raise ValueError(f"decomposition does not reconcile: {sum_check}")

    return {
        "from": from_period,
        "to": to_period,
        "delta_revenue_usd": delta_revenue,
        "log_change": log_change,
        "by_channel": by_channel,
        "by_device": by_device,
        "sum_check_abs_error": float(sum_check),
    }


def build_artefact() -> dict[str, Any]:
    """Build the published revenue-decomposition artefact from the marts."""
    con = _connect()
    try:
        periods = _period_totals(con)
        comparisons = [
            _comparison(con, periods, "P1", "P2", seed=41),
            _comparison(con, periods, "P2", "P3", seed=42),
        ]
    finally:
        con.close()

    return {
        "meta": {"synthetic": False, "n_boot": int(N_BOOT)},
        "periods": periods,
        "comparisons": comparisons,
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
    """Write the decomposition artefact and print its path."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args(argv)

    artefact = build_artefact()
    destination = config.ARTEFACTS_DIR / "decomposition.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(_jsonable(artefact), indent=1),
        encoding="utf-8",
    )
    print(destination)


if __name__ == "__main__":
    main()
