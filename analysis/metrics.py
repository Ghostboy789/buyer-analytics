"""Descriptive analysis of the store marts and the raw event files."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import duckdb
import numpy as np
from scipy import stats

import config
from analysis.stats_util import bootstrap_ratio, holm, num, rate_num, wilson

N_BOOT = 500
STEPS = (
    "view_item",
    "add_to_cart",
    "begin_checkout",
    "add_shipping_info",
    "add_payment_info",
    "purchase",
)
OPEN_FLAGS = ", ".join(f"count(*) FILTER (WHERE has_{step}) AS o_{step}" for step in STEPS)


def _sql_path(path: Path) -> str:
    """Quote a local path for a DuckDB SQL literal."""
    return "'" + str(path).replace("'", "''") + "'"


def _connect() -> duckdb.DuckDBPyConnection:
    """Open DuckDB with every mart and the raw events exposed as views."""
    con = duckdb.connect()
    marts = {
        "v_sessions": "fct_sessions.parquet",
        "v_orders": "fct_orders.parquet",
        "v_users": "dim_users.parquet",
        "v_channels": "dim_channel.parquet",
        "v_dates": "dim_date.parquet",
        "v_funnel": "fct_funnel_daily.parquet",
        "v_cohorts": "fct_cohort_retention.parquet",
    }
    for view, filename in marts.items():
        con.execute(
            f"CREATE TEMP VIEW {view} AS SELECT * FROM read_parquet("
            + _sql_path(config.MARTS_DIR / filename)
            + ")"
        )
    raw_glob = _sql_path(config.RAW_DIR / "events_*.parquet")
    con.execute(
        "CREATE TEMP VIEW v_raw AS SELECT * FROM read_parquet("
        + raw_glob
        + ", union_by_name = true)"
    )
    return con


def _date_key(value: Any) -> str:
    """Return a YYYY-MM-DD string for a date, timestamp or date-like value."""
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    return str(value)


def _open_counts(row: Any) -> list[int]:
    """Return the open counts (step flag present, earlier steps ignored)."""
    return [int(row[f"o_{step}"]) for step in STEPS]


def _funnel_block(values: dict[str, Any]) -> dict[str, Any]:
    """Build one funnel block (overall or a split) from additive counts."""
    sessions = int(values["sessions"])
    reached = [int(values[f"s_{step}"]) for step in STEPS]

    from_sessions = [rate_num(count, sessions) for count in reached]
    from_prev = [rate_num(reached[0], sessions)]
    for index in range(1, len(reached)):
        from_prev.append(rate_num(reached[index], reached[index - 1]))

    return {
        "sessions": sessions,
        "reached": reached,
        "open_reached": _open_counts(values),
        "rate_from_sessions": from_sessions,
        "rate_from_prev": from_prev,
    }


def _two_proportion(x_a: float, n_a: float, x_b: float, n_b: float) -> tuple[float, float]:
    """Return a pooled two-proportion z-test difference and two-sided p-value."""
    if n_a <= 0 or n_b <= 0:
        return float("nan"), float("nan")
    p_a = float(x_a) / float(n_a)
    p_b = float(x_b) / float(n_b)
    diff = p_a - p_b
    pooled = (float(x_a) + float(x_b)) / (float(n_a) + float(n_b))
    se = math.sqrt(pooled * (1.0 - pooled) * (1.0 / n_a + 1.0 / n_b))
    if se <= 0.0:
        return float(diff), 1.0 if diff == 0.0 else 0.0
    z = diff / se
    return float(diff), float(2.0 * stats.norm.sf(abs(z)))


def _kpis(con: duckdb.DuckDBPyConnection) -> dict[str, Any]:
    """Return whole-dataset KPIs with their intervals."""
    sessions = con.execute(
        """
        SELECT count(*) AS sessions,
               count(*) FILTER (WHERE orders > 0) AS purchasing_sessions,
               coalesce(sum(orders), 0) AS orders,
               coalesce(sum(revenue_usd), 0) AS revenue_usd
        FROM v_sessions
        """
    ).fetchone()
    users = con.execute(
        """
        SELECT count(*) AS users,
               count(*) FILTER (WHERE orders > 0) AS buyers
        FROM v_users
        """
    ).fetchone()
    orders = con.execute(
        """
        SELECT count(*) AS orders,
               count(*) FILTER (WHERE is_zero_revenue) AS zero_revenue_orders,
               coalesce(sum(items_quantity), 0) AS items_quantity
        FROM v_orders
        """
    ).fetchone()

    n_sessions, purchasing_sessions, _, revenue = (
        int(sessions[0]),
        int(sessions[1]),
        int(sessions[2]),
        float(sessions[3]),
    )
    n_users, buyers = int(users[0]), int(users[1])
    n_orders, zero_orders, items = int(orders[0]), int(orders[1]), float(orders[2])

    per_user = con.execute(
        """
        SELECT u.user_pseudo_id,
               u.orders,
               u.revenue_usd,
               coalesce(o.items_quantity, 0) AS items_quantity
        FROM v_users u
        LEFT JOIN (
            SELECT user_pseudo_id,
                   coalesce(sum(items_quantity), 0) AS items_quantity
            FROM v_orders
            GROUP BY user_pseudo_id
        ) o USING (user_pseudo_id)
        ORDER BY u.user_pseudo_id
        """
    ).fetchdf()
    user_orders = per_user["orders"].to_numpy(dtype=float)
    user_revenue = per_user["revenue_usd"].to_numpy(dtype=float)
    user_items = per_user["items_quantity"].to_numpy(dtype=float)
    buyer_mask = user_orders > 0

    aov_low, aov_high = bootstrap_ratio(
        user_revenue[buyer_mask], user_orders[buyer_mask], N_BOOT, seed=101
    )
    rpu_low, rpu_high = bootstrap_ratio(
        user_revenue, np.ones(n_users, dtype=float), N_BOOT, seed=102
    )
    ipo_low, ipo_high = bootstrap_ratio(
        user_items[buyer_mask], user_orders[buyer_mask], N_BOOT, seed=103
    )

    return {
        "sessions": n_sessions,
        "users": n_users,
        "orders": n_orders,
        "revenue_usd": revenue,
        "session_conversion": rate_num(purchasing_sessions, n_sessions),
        "user_conversion": rate_num(buyers, n_users),
        "aov": num(
            revenue / n_orders if n_orders else 0.0,
            aov_low,
            aov_high,
            int(buyer_mask.sum()),
        ),
        "revenue_per_user": num(revenue / n_users if n_users else 0.0, rpu_low, rpu_high, n_users),
        "items_per_order": num(
            items / n_orders if n_orders else 0.0,
            ipo_low,
            ipo_high,
            int(buyer_mask.sum()),
        ),
        "zero_revenue_order_share": rate_num(zero_orders, n_orders),
    }


def _weekly(con: duckdb.DuckDBPyConnection) -> list[dict[str, Any]]:
    """Return metrics for Monday-start weeks that are fully inside the data."""
    frame = con.execute(
        """
        SELECT d.week_start,
               count(*) AS sessions,
               count(DISTINCT s.user_pseudo_id) AS users,
               count(*) FILTER (WHERE s.orders > 0) AS purchasing_sessions,
               coalesce(sum(s.orders), 0) AS orders,
               coalesce(sum(s.revenue_usd), 0) AS revenue_usd
        FROM v_sessions s
        JOIN v_dates d ON s.session_date = d.date_day
        WHERE d.week_start IN (
            SELECT week_start FROM v_dates GROUP BY week_start HAVING count(*) = 7
        )
        GROUP BY d.week_start
        ORDER BY d.week_start
        """
    ).fetchdf()

    per_user = con.execute(
        """
        SELECT d.week_start,
               s.user_pseudo_id,
               coalesce(sum(s.orders), 0) AS orders,
               coalesce(sum(s.revenue_usd), 0) AS revenue_usd
        FROM v_sessions s
        JOIN v_dates d ON s.session_date = d.date_day
        WHERE d.week_start IN (
            SELECT week_start FROM v_dates GROUP BY week_start HAVING count(*) = 7
        )
        GROUP BY d.week_start, s.user_pseudo_id
        ORDER BY d.week_start, s.user_pseudo_id
        """
    ).fetchdf()
    per_user["week_key"] = per_user["week_start"].map(_date_key)
    groups = {key: value for key, value in per_user.groupby("week_key")}

    rows: list[dict[str, Any]] = []
    for index, row in enumerate(frame.itertuples(index=False)):
        sessions = int(row.sessions)
        orders = int(row.orders)
        revenue = float(row.revenue_usd)
        week_key = _date_key(row.week_start)
        group = groups.get(week_key)
        if group is None:
            buyer_orders = np.array([], dtype=float)
            buyer_revenue = np.array([], dtype=float)
        else:
            buyer_orders = group["orders"].to_numpy(dtype=float)
            buyer_revenue = group["revenue_usd"].to_numpy(dtype=float)
            buyer_mask = buyer_orders > 0
            buyer_orders = buyer_orders[buyer_mask]
            buyer_revenue = buyer_revenue[buyer_mask]

        aov_low, aov_high = bootstrap_ratio(buyer_revenue, buyer_orders, N_BOOT, seed=200 + index)
        rows.append(
            {
                "week_start": _date_key(row.week_start),
                "sessions": sessions,
                "users": int(row.users),
                "orders": orders,
                "revenue_usd": revenue,
                "session_conversion": rate_num(int(row.purchasing_sessions), sessions),
                "aov": num(
                    revenue / orders if orders else 0.0,
                    aov_low,
                    aov_high,
                    int(buyer_orders.size),
                ),
            }
        )
    return rows


def _funnel(con: duckdb.DuckDBPyConnection) -> dict[str, Any]:
    """Return the closed funnel, its splits and the skipped-step share."""
    columns = ", ".join(f"sum(s_{step}) AS s_{step}" for step in STEPS)
    overall = con.execute(
        f"""
        SELECT sum(sessions) AS sessions,
               {columns},
               sum(purchase_sessions_open) AS purchase_sessions_open
        FROM v_funnel
        """
    ).fetchone()
    open_overall = con.execute(f"SELECT {OPEN_FLAGS} FROM v_sessions").fetchdf()
    overall_values = {
        **open_overall.iloc[0].to_dict(),
        "sessions": overall[0],
        "purchase_sessions_open": overall[-1],
        **{f"s_{step}": overall[index + 1] for index, step in enumerate(STEPS)},
    }

    def split(column: str) -> dict[str, Any]:
        frame = con.execute(
            f"""
            SELECT {column} AS segment,
                   sum(sessions) AS sessions,
                   {columns},
                   sum(purchase_sessions_open) AS purchase_sessions_open
            FROM v_funnel
            GROUP BY {column}
            ORDER BY {column}
            """
        ).fetchdf()
        opened = (
            con.execute(
                f"""
            SELECT {column} AS segment, {OPEN_FLAGS}
            FROM v_sessions
            GROUP BY {column}
            """
            )
            .fetchdf()
            .set_index("segment")
        )
        return {
            str(row.segment): _funnel_block({**row._asdict(), **opened.loc[row.segment].to_dict()})
            for row in frame.itertuples(index=False)
        }

    open_purchases = int(overall[-1])
    closed_purchases = int(overall[-2])
    skipped_low, skipped_high = wilson(open_purchases - closed_purchases, open_purchases)

    return {
        "steps": list(STEPS),
        "overall": _funnel_block(overall_values),
        "by_device": split("device_category"),
        "by_channel": split("channel"),
        "by_country": split("country_group"),
        "skipped_step_share": num(
            (open_purchases - closed_purchases) / open_purchases if open_purchases else 0.0,
            skipped_low,
            skipped_high,
            open_purchases,
        ),
    }


def _cohorts(con: duckdb.DuckDBPyConnection) -> list[dict[str, Any]]:
    """Return retention for complete cohorts with at least 1,000 users."""
    frame = con.execute(
        """
        SELECT cohort_week, week_offset, cohort_users, active_users
        FROM v_cohorts
        WHERE is_complete AND cohort_users >= 1000
        ORDER BY cohort_week, week_offset
        """
    ).fetchdf()

    cohorts: list[dict[str, Any]] = []
    current_week: str | None = None
    for row in frame.itertuples(index=False):
        week = _date_key(row.cohort_week)
        if week != current_week:
            cohorts.append(
                {
                    "cohort_week": week,
                    "cohort_users": int(row.cohort_users),
                    "retention": [],
                }
            )
            current_week = week
        cohorts[-1]["retention"].append(
            {
                "week_offset": int(row.week_offset),
                "rate": rate_num(int(row.active_users), int(row.cohort_users)),
            }
        )
    return cohorts


def _repeat(con: duckdb.DuckDBPyConnection) -> dict[str, Any]:
    """Return the 28-day repeat-purchase rate and days to the second order."""
    row = con.execute(
        """
        SELECT count(*) AS eligible,
               count(*) FILTER (
                   WHERE second_order_ts IS NOT NULL
                     AND cast(second_order_ts AS DATE)
                         - cast(first_order_ts AS DATE) <= 28
               ) AS repeat_n
        FROM v_users
        WHERE first_order_ts IS NOT NULL
          AND cast(first_order_ts AS DATE)
              <= (SELECT max(date_day) FROM v_dates) - INTERVAL 28 DAY
        """
    ).fetchone()
    eligible, repeat_n = int(row[0]), int(row[1])

    days_frame = con.execute(
        """
        SELECT date_diff(
                   'day',
                   cast(first_order_ts AS DATE),
                   cast(second_order_ts AS DATE)
               ) AS days
        FROM v_users
        WHERE first_order_ts IS NOT NULL
          AND cast(first_order_ts AS DATE)
              <= (SELECT max(date_day) FROM v_dates) - INTERVAL 28 DAY
          AND second_order_ts IS NOT NULL
          AND date_diff(
                  'day',
                  cast(first_order_ts AS DATE),
                  cast(second_order_ts AS DATE)
              ) BETWEEN 0 AND 28
        ORDER BY user_pseudo_id
        """
    ).fetchdf()
    days = days_frame["days"].to_numpy(dtype=float)

    if days.size:
        median = float(np.median(days))
        rng = np.random.default_rng(301)
        draws = np.empty(N_BOOT, dtype=float)
        for b in range(N_BOOT):
            sample = days[rng.integers(0, days.size, days.size)]
            draws[b] = float(np.median(sample))
        low, high = np.percentile(draws, [2.5, 97.5])
        median_num = num(median, float(low), float(high), int(days.size))
    else:
        median_num = num(0.0, None, None, 0)

    return {
        "repeat_28d": rate_num(repeat_n, eligible),
        "median_days_to_second": median_num,
    }


def _channels(
    con: duckdb.DuckDBPyConnection,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, int]]]:
    """Return per-channel metrics, merging channels with fewer than 30 orders."""
    stats_frame = con.execute(
        """
        SELECT channel,
               count(*) AS users,
               count(*) FILTER (WHERE orders > 0) AS buyers,
               coalesce(sum(orders), 0) AS orders,
               coalesce(sum(revenue_usd), 0) AS revenue_usd
        FROM v_users
        GROUP BY channel
        ORDER BY channel
        """
    ).fetchdf()
    sessions_frame = con.execute(
        "SELECT channel, count(*) AS sessions FROM v_sessions GROUP BY channel"
    ).fetchdf()
    sessions_by_channel = {
        str(row.channel): int(row.sessions) for row in sessions_frame.itertuples(index=False)
    }

    mapping = {
        str(row.channel): ("other" if int(row.orders) < 30 else str(row.channel))
        for row in stats_frame.itertuples(index=False)
    }

    merged: dict[str, dict[str, Any]] = {}
    for row in stats_frame.itertuples(index=False):
        target = mapping[str(row.channel)]
        entry = merged.setdefault(
            target,
            {
                "users": 0,
                "buyers": 0,
                "sessions": 0,
                "orders": 0,
                "revenue_usd": 0.0,
            },
        )
        entry["users"] += int(row.users)
        entry["buyers"] += int(row.buyers)
        entry["sessions"] += sessions_by_channel.get(str(row.channel), 0)
        entry["orders"] += int(row.orders)
        entry["revenue_usd"] += float(row.revenue_usd)

    user_frame = con.execute(
        """
        SELECT user_pseudo_id, channel, revenue_usd
        FROM v_users
        ORDER BY user_pseudo_id
        """
    ).fetchdf()
    user_frame["channel"] = user_frame["channel"].map(mapping)
    user_groups = {
        key: value["revenue_usd"].to_numpy(dtype=float)
        for key, value in user_frame.groupby("channel")
    }

    channel_order = [
        str(row[0])
        for row in con.execute("SELECT channel FROM v_channels ORDER BY sort_order").fetchall()
    ]
    ordered = [channel for channel in channel_order if channel in merged]
    ordered += sorted(set(merged) - set(ordered))

    rows: list[dict[str, Any]] = []
    for index, channel in enumerate(ordered):
        values = merged[channel]
        revenue_values = user_groups.get(channel, np.array([], dtype=float))
        low, high = bootstrap_ratio(
            revenue_values,
            np.ones(revenue_values.size, dtype=float),
            N_BOOT,
            seed=500 + index,
        )
        rows.append(
            {
                "channel": channel,
                "users": int(values["users"]),
                "sessions": int(values["sessions"]),
                "orders": int(values["orders"]),
                "revenue_usd": float(values["revenue_usd"]),
                "user_conversion": rate_num(values["buyers"], values["users"]),
                "revenue_per_user": num(
                    values["revenue_usd"] / values["users"] if values["users"] else 0.0,
                    low,
                    high,
                    int(values["users"]),
                ),
            }
        )
    return rows, merged


def _segment_tests(
    funnel: dict[str, Any],
    channel_rows: list[dict[str, Any]],
    channel_stats: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Run pooled two-proportion tests with Holm correction within each page."""
    rows: list[dict[str, Any]] = []

    device_pairs = [
        ("desktop", "mobile"),
        ("desktop", "tablet"),
        ("mobile", "tablet"),
    ]
    tested_pairs: list[tuple[str, str]] = []
    device_raw: list[float] = []
    device_diffs: list[float] = []
    for a, b in device_pairs:
        block_a = funnel["by_device"].get(a)
        block_b = funnel["by_device"].get(b)
        if block_a is None or block_b is None:
            continue
        diff, p_value = _two_proportion(
            block_a["reached"][-1],
            block_a["sessions"],
            block_b["reached"][-1],
            block_b["sessions"],
        )
        tested_pairs.append((a, b))
        device_raw.append(p_value)
        device_diffs.append(diff)

    for (a, b), diff, p_raw, p_holm in zip(
        tested_pairs, device_diffs, device_raw, holm(device_raw), strict=True
    ):
        rows.append(
            {
                "page": "funnel",
                "a": a,
                "b": b,
                "metric": "session_conversion",
                "diff": float(diff),
                "p_raw": float(p_raw),
                "p_holm": float(p_holm),
            }
        )

    reference = channel_stats.get("organic_search")
    channel_raw: list[float] = []
    channel_rows_tests: list[dict[str, Any]] = []
    if reference is not None:
        for row in channel_rows:
            if row["channel"] == "organic_search":
                continue
            values = channel_stats[row["channel"]]
            diff, p_value = _two_proportion(
                values["buyers"],
                values["users"],
                reference["buyers"],
                reference["users"],
            )
            channel_raw.append(p_value)
            channel_rows_tests.append(
                {
                    "page": "channels",
                    "a": row["channel"],
                    "b": "organic_search",
                    "metric": "user_conversion",
                    "diff": float(diff),
                    "p_raw": float(p_value),
                }
            )

    for row, p_holm in zip(channel_rows_tests, holm(channel_raw), strict=True):
        row["p_holm"] = float(p_holm)
        rows.append(row)

    return rows


def _zero_revenue_by_period(con: duckdb.DuckDBPyConnection) -> dict[str, Any]:
    """Zero-revenue orders per period, by the session date of the order's session."""
    rows = con.execute(
        """
        SELECT d.period AS period,
               count(*) AS orders,
               count(*) FILTER (WHERE o.is_zero_revenue) AS zero_orders,
               coalesce(sum(o.revenue_usd) FILTER (WHERE o.revenue_usd > 0), 0)
                   AS paid_revenue,
               count(*) FILTER (WHERE o.revenue_usd > 0) AS paid_orders
        FROM v_orders o
        JOIN v_sessions s ON s.session_key = o.session_key
        JOIN v_dates d ON d.date_day = s.session_date
        WHERE d.period IN ('P1', 'P2', 'P3')
        GROUP BY d.period
        ORDER BY d.period
        """
    ).fetchall()
    result: dict[str, Any] = {}
    for period, orders, zero_orders, paid_revenue, paid_orders in rows:
        result[str(period)] = {
            "orders": int(orders),
            "zero_revenue_orders": int(zero_orders),
            "share": rate_num(int(zero_orders), int(orders)),
            "aov_paid_orders": float(paid_revenue) / int(paid_orders) if paid_orders else 0.0,
        }
    return result


def _data_quality(con: duckdb.DuckDBPyConnection) -> dict[str, Any]:
    """Reconcile the raw files with the marts and report source-param coverage."""
    raw = con.execute(
        """
        SELECT count(*) AS raw_events,
               count(*) FILTER (WHERE event_name = 'purchase')
                   AS raw_purchase_events,
               coalesce(
                   sum(ecommerce.purchase_revenue_in_usd)
                       FILTER (WHERE event_name = 'purchase'),
                   0
               ) AS raw_purchase_revenue_usd,
               count(*) FILTER (
                   WHERE event_name = 'purchase'
                     AND (
                         ecommerce.transaction_id IS NULL
                         OR ecommerce.transaction_id = '(not set)'
                     )
               ) AS not_set_transaction_events
        FROM v_raw
        """
    ).fetchone()

    mart = con.execute(
        """
        SELECT (SELECT sum(events) FROM v_sessions) AS mart_events,
               (SELECT count(*) FROM v_orders) AS orders,
               (SELECT coalesce(sum(revenue_usd), 0) FROM v_orders)
                   AS order_revenue_usd,
               (SELECT count(*) FROM v_sessions) AS sessions
        """
    ).fetchone()

    with_source = con.execute(
        """
        WITH per_session AS (
            SELECT user_pseudo_id,
                   list_filter(
                       event_params, lambda x: x.key = 'ga_session_id'
                   )[1].value.int_value::bigint AS ga_session_id,
                   coalesce(
                       bool_or(
                           list_filter(
                               event_params, lambda x: x.key = 'source'
                           )[1].value.string_value IS NOT NULL
                       ),
                       false
                   ) AS has_source
            FROM v_raw
            GROUP BY 1, 2
        )
        SELECT count(*) FILTER (WHERE has_source) AS with_source
        FROM per_session
        """
    ).fetchone()

    sessions = int(mart[3])
    sources = int(with_source[0])
    zero_by_period = _zero_revenue_by_period(con)

    return {
        "raw_events": int(raw[0]),
        "mart_events": int(mart[0]),
        "raw_purchase_events": int(raw[1]),
        "orders": int(mart[1]),
        "raw_purchase_revenue_usd": float(raw[2]),
        "order_revenue_usd": float(mart[2]),
        "not_set_transaction_events": int(raw[3]),
        "session_source_param_coverage": float(sources / sessions) if sessions else 0.0,
        "zero_revenue_by_period": zero_by_period,
    }


def build_artefact() -> dict[str, Any]:
    """Build the published descriptive artefact from the marts."""
    con = _connect()
    try:
        bounds = con.execute(
            "SELECT min(date_day) AS date_min, max(date_day) AS date_max FROM v_dates"
        ).fetchone()

        kpis = _kpis(con)
        weekly = _weekly(con)
        funnel = _funnel(con)
        cohorts = _cohorts(con)
        repeat = _repeat(con)
        channels, channel_stats = _channels(con)
        segment_tests = _segment_tests(funnel, channels, channel_stats)
        data_quality = _data_quality(con)
    finally:
        con.close()

    return {
        "meta": {
            "date_min": _date_key(bounds[0]),
            "date_max": _date_key(bounds[1]),
            "synthetic": False,
        },
        "kpis": kpis,
        "weekly": weekly,
        "funnel": funnel,
        "cohorts": cohorts,
        "repeat": repeat,
        "channels": channels,
        "segment_tests": segment_tests,
        "data_quality": data_quality,
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
    """Write the descriptive artefact and print its path."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args(argv)

    artefact = build_artefact()
    destination = config.ARTEFACTS_DIR / "descriptive.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(_jsonable(artefact), indent=1),
        encoding="utf-8",
    )
    print(destination)


if __name__ == "__main__":
    main()
