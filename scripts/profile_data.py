# ruff: noqa: E402
"""Profile the raw GA4 event export and write docs/DATA_PROFILE.md."""

from __future__ import annotations

import sys
from collections.abc import Iterable, Sequence
from datetime import date
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import RAW_DIR, REPO_ROOT

SESSION_KEY = "user_pseudo_id || '|' || CAST(ga_session_id AS VARCHAR)"
PLACEHOLDERS: tuple[str | None, ...] = (
    None,
    "",
    "(not set)",
    "<Other>",
    "(data deleted)",
    "(direct)",
    "(none)",
)
PLACEHOLDER_HEADERS: tuple[str, ...] = (
    "NULL",
    "`''`",
    "`(not set)`",
    "`<Other>`",
    "`(data deleted)`",
    "`(direct)`",
    "`(none)`",
)
REDACTION_PLACEHOLDERS: tuple[str | None, ...] = (
    None,
    "",
    "(not set)",
    "<Other>",
    "(data deleted)",
)
REDACTION_HEADERS: tuple[str, ...] = (
    "NULL",
    "`''`",
    "`(not set)`",
    "`<Other>`",
    "`(data deleted)`",
)


def _sql_literal(value: str) -> str:
    """Return a single-quoted SQL string literal."""
    return "'" + value.replace("'", "''") + "'"


def _param(key: str, value_type: str) -> str:
    """Build a DuckDB expression that extracts an event parameter."""
    return (
        "list_filter(event_params, "
        f"lambda x: x.key = {_sql_literal(key)})[1].value.{value_type}"
    )


def _fmt_int(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, int):
        return f"{value:,}"
    return str(value)


def _fmt_pct(value: object) -> str:
    if value is None:
        return ""
    return f"{float(value):.2f}%"


def _fmt_money(value: object) -> str:
    if value is None:
        return ""
    return f"{float(value):,.2f}"


def _fmt_cell(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, int):
        return f"{value:,}"
    if isinstance(value, float):
        return f"{value:,.2f}"
    return str(value).replace("|", "\\|").replace("\n", " ")


def markdown_table(headers: Sequence[str], rows: Iterable[Sequence[object]]) -> str:
    """Render rows as a Markdown table."""
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(_fmt_cell(cell) for cell in row) + " |")
    return "\n".join(lines)


def table(con: duckdb.DuckDBPyConnection, sql: str, headers: Sequence[str]) -> str:
    """Run SQL and render the result as a Markdown table."""
    return markdown_table(headers, con.execute(sql).fetchall())


def _create_ev(con: duckdb.DuckDBPyConnection) -> None:
    """Create the flattened temporary event table used by the report."""
    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE ev AS
        SELECT
            event_date,
            event_timestamp,
            event_name,
            user_pseudo_id,
            user_id,
            {_param("ga_session_id", "int_value")} AS ga_session_id,
            {_param("ga_session_number", "int_value")} AS ga_session_number,
            {_param("source", "string_value")} AS ep_source,
            {_param("medium", "string_value")} AS ep_medium,
            {_param("campaign", "string_value")} AS ep_campaign,
            traffic_source.source AS ts_source,
            traffic_source.medium AS ts_medium,
            traffic_source.name AS ts_name,
            device.category AS device_category,
            device.web_info.browser AS browser,
            device.operating_system AS os,
            geo.country AS country,
            geo.region AS region,
            geo.city AS city,
            ecommerce.transaction_id AS transaction_id,
            ecommerce.purchase_revenue_in_usd AS purchase_revenue_in_usd,
            ecommerce.total_item_quantity AS total_item_quantity,
            len(items) AS n_items,
            list_sum(list_transform(items, lambda x: x.item_revenue_in_usd))
                AS items_revenue_usd,
            platform,
            stream_id
        FROM events
        """
    )


def _overview(con: duckdb.DuckDBPyConnection) -> str:
    row = con.execute(
        """
        SELECT
            min(event_date) AS first_event_date,
            max(event_date) AS last_event_date,
            count(DISTINCT event_date) AS days,
            count(*) AS events,
            count(DISTINCT user_pseudo_id) AS users,
            (
                SELECT count(*)
                FROM (
                    SELECT DISTINCT user_pseudo_id, ga_session_id
                    FROM ev
                    WHERE ga_session_id IS NOT NULL
                )
            ) AS sessions,
            100.0 * count(user_id) / nullif(count(*), 0) AS user_id_share,
            count(DISTINCT platform) AS platforms,
            count(DISTINCT stream_id) AS streams,
            string_agg(DISTINCT platform, ', ') AS platform_values
        FROM ev
        """
    ).fetchone()
    metrics = [
        ("First event date", row[0] or ""),
        ("Last event date", row[1] or ""),
        ("Days with events", _fmt_int(row[2])),
        ("Total events", _fmt_int(row[3])),
        ("Distinct user_pseudo_id", _fmt_int(row[4])),
        ("Distinct sessions", _fmt_int(row[5])),
        ("Share of rows with user_id not null", _fmt_pct(row[6])),
        ("Distinct platform values", _fmt_int(row[7])),
        ("Platform values", row[9] or ""),
        ("Distinct stream_id count", _fmt_int(row[8])),
    ]
    return markdown_table(("Metric", "Value"), metrics)


def _daily_summary(con: duckdb.DuckDBPyConnection) -> str:
    return table(
        con,
        """
        WITH daily AS (
            SELECT event_date, count(*) AS events
            FROM ev
            GROUP BY event_date
        )
        SELECT min(events), median(events), max(events)
        FROM daily
        """,
        ["Min events/day", "Median events/day", "Max events/day"],
    )


def _busiest_days(con: duckdb.DuckDBPyConnection) -> str:
    return table(
        con,
        f"""
        SELECT
            event_date,
            count(*) AS events,
            count(DISTINCT CASE WHEN ga_session_id IS NOT NULL
                THEN {SESSION_KEY} END) AS sessions,
            count(*) FILTER (WHERE event_name = 'purchase') AS purchases
        FROM ev
        GROUP BY event_date
        ORDER BY events DESC, event_date
        LIMIT 5
        """,
        ["Event date", "Events", "Sessions", "Purchases"],
    )


def _event_names(con: duckdb.DuckDBPyConnection) -> str:
    return table(
        con,
        f"""
        SELECT
            event_name,
            count(*) AS events,
            printf('%.2f%%', 100.0 * count(*) / (SELECT count(*) FROM ev)) AS share,
            count(DISTINCT user_pseudo_id) AS users,
            count(DISTINCT CASE WHEN ga_session_id IS NOT NULL
                THEN {SESSION_KEY} END) AS sessions
        FROM ev
        GROUP BY event_name
        ORDER BY events DESC, event_name
        """,
        ["Event name", "Events", "Share of events", "Distinct users", "Distinct sessions"],
    )


def _session_coverage(con: duckdb.DuckDBPyConnection) -> str:
    overall = table(
        con,
        """
        SELECT
            count(*) AS events,
            count(*) FILTER (WHERE ga_session_id IS NULL) AS null_events,
            printf(
                '%.2f%%',
                100.0 * count(*) FILTER (WHERE ga_session_id IS NULL)
                    / nullif(count(*), 0)
            ) AS null_share
        FROM ev
        """,
        ["Events", "Events with NULL session id", "NULL share"],
    )
    by_event = table(
        con,
        """
        SELECT
            event_name,
            count(*) AS events,
            count(*) FILTER (WHERE ga_session_id IS NULL) AS null_events,
            printf(
                '%.2f%%',
                100.0 * count(*) FILTER (WHERE ga_session_id IS NULL)
                    / nullif(count(*), 0)
            ) AS null_share
        FROM ev
        GROUP BY event_name
        HAVING count(*) FILTER (WHERE ga_session_id IS NULL) > 0
        ORDER BY null_events DESC, event_name
        """,
        ["Event name", "Events", "Events with NULL session id", "NULL share"],
    )
    return "\n\n".join(
        ["### Overall", "", overall, "### By event name", "", by_event]
    )


def _sessions_per_user(con: duckdb.DuckDBPyConnection) -> str:
    distribution = table(
        con,
        """
        WITH user_sessions AS (
            SELECT
                user_pseudo_id,
                count(DISTINCT ga_session_id) AS sessions
            FROM ev
            WHERE ga_session_id IS NOT NULL
            GROUP BY user_pseudo_id
        ),
        bucketed AS (
            SELECT
                CASE
                    WHEN sessions = 1 THEN '1'
                    WHEN sessions = 2 THEN '2'
                    WHEN sessions = 3 THEN '3'
                    WHEN sessions BETWEEN 4 AND 5 THEN '4-5'
                    ELSE '6+'
                END AS bucket,
                count(*) AS users
            FROM user_sessions
            GROUP BY bucket
        )
        SELECT
            bucket,
            users,
            printf('%.2f%%', 100.0 * users / sum(users) OVER ()) AS share
        FROM bucketed
        ORDER BY CASE bucket
            WHEN '1' THEN 1
            WHEN '2' THEN 2
            WHEN '3' THEN 3
            WHEN '4-5' THEN 4
            ELSE 5
        END
        """,
        ["Sessions per user", "Users", "Share of users"],
    )
    multi_day = table(
        con,
        """
        WITH user_days AS (
            SELECT user_pseudo_id, count(DISTINCT event_date) AS active_days
            FROM ev
            GROUP BY user_pseudo_id
        )
        SELECT
            count(*) AS users,
            count(*) FILTER (WHERE active_days > 1) AS multi_day_users,
            printf(
                '%.2f%%',
                100.0 * count(*) FILTER (WHERE active_days > 1)
                    / nullif(count(*), 0)
            ) AS share
        FROM user_days
        """,
        ["Users", "Users active on >1 day", "Share of users"],
    )
    return "\n\n".join(
        [
            "Session distribution includes users with at least one non-null session id.",
            "",
            distribution,
            "",
            "### Users active on more than one event_date",
            "",
            multi_day,
        ]
    )


def _placeholder_condition(field: str, placeholder: str | None) -> str:
    if placeholder is None:
        return f"{field} IS NULL"
    return f"{field} = {_sql_literal(placeholder)}"


def _user_share_expressions(field: str) -> str:
    expressions = []
    for placeholder in PLACEHOLDERS:
        condition = _placeholder_condition(field, placeholder)
        expressions.append(
            "printf('%.2f%%', 100.0 * count(DISTINCT user_pseudo_id) "
            f"FILTER (WHERE {condition}) / nullif(max(total_users), 0))"
        )
    return ",\n                ".join(expressions)


def _null_share_expressions(field: str) -> str:
    expressions = []
    for placeholder in REDACTION_PLACEHOLDERS:
        condition = _placeholder_condition(field, placeholder)
        expressions.append(
            "printf('%.2f%%', 100.0 * count(*) "
            f"FILTER (WHERE {condition}) / nullif(count(*), 0))"
        )
    return ",\n        ".join(expressions)


def _traffic_user_level(con: duckdb.DuckDBPyConnection) -> str:
    rows = []
    for field in ("ts_source", "ts_medium", "ts_name"):
        expressions = _user_share_expressions(field)
        row = con.execute(
            f"""
            WITH totals AS (
                SELECT count(DISTINCT user_pseudo_id) AS total_users
                FROM ev
            )
            SELECT
                '{field}' AS field,
                {expressions}
            FROM ev, totals
            """
        ).fetchone()
        rows.append(row)
    placeholders = markdown_table(("Field", *PLACEHOLDER_HEADERS), rows)
    top_pairs = table(
        con,
        """
        SELECT
            ts_source,
            ts_medium,
            count(DISTINCT user_pseudo_id) AS users
        FROM ev
        GROUP BY ts_source, ts_medium
        ORDER BY users DESC
        LIMIT 15
        """,
        ["ts_source", "ts_medium", "Distinct users"],
    )
    return "\n\n".join(
        [
            "Share of users with at least one event carrying each value:",
            "",
            placeholders,
            "",
            "### Top 15 ts_source / ts_medium pairs by users",
            "",
            top_pairs,
        ]
    )


def _traffic_event_level(con: duckdb.DuckDBPyConnection) -> str:
    rows = []
    for field in ("ep_source", "ep_medium", "ep_campaign"):
        row = con.execute(
            f"""
            WITH totals AS (
                SELECT
                    count(*) AS total_events,
                    count(DISTINCT CASE WHEN ga_session_id IS NOT NULL
                        THEN {SESSION_KEY} END) AS total_sessions
                FROM ev
            )
            SELECT
                '{field}' AS field,
                count(*) FILTER (WHERE {field} IS NOT NULL) AS events,
                printf(
                    '%.2f%%',
                    100.0 * count(*) FILTER (WHERE {field} IS NOT NULL)
                        / nullif(max(total_events), 0)
                ) AS event_share,
                count(DISTINCT CASE WHEN {field} IS NOT NULL
                    AND ga_session_id IS NOT NULL THEN {SESSION_KEY} END) AS sessions,
                printf(
                    '%.2f%%',
                    100.0 * count(DISTINCT CASE WHEN {field} IS NOT NULL
                        AND ga_session_id IS NOT NULL THEN {SESSION_KEY} END)
                        / nullif(max(total_sessions), 0)
                ) AS session_share
            FROM ev, totals
            """
        ).fetchone()
        rows.append(row)
    coverage = markdown_table(
        (
            "Field",
            "Events with value",
            "Share of events",
            "Sessions with value",
            "Share of sessions",
        ),
        rows,
    )
    carriers = table(
        con,
        """
        SELECT
            event_name,
            count(*) FILTER (WHERE ep_source IS NOT NULL) AS events,
            printf(
                '%.2f%%',
                100.0 * count(*) FILTER (WHERE ep_source IS NOT NULL)
                    / nullif(count(*), 0)
            ) AS share_of_events
        FROM ev
        GROUP BY event_name
        HAVING count(*) FILTER (WHERE ep_source IS NOT NULL) > 0
        ORDER BY events DESC, event_name
        """,
        ["Event name", "Events with ep_source", "Share of event's events"],
    )
    top_pairs = table(
        con,
        f"""
        SELECT
            ep_source,
            ep_medium,
            count(DISTINCT CASE WHEN ga_session_id IS NOT NULL
                THEN {SESSION_KEY} END) AS sessions
        FROM ev
        WHERE ep_source IS NOT NULL OR ep_medium IS NOT NULL
        GROUP BY ep_source, ep_medium
        ORDER BY sessions DESC
        LIMIT 15
        """,
        ["ep_source", "ep_medium", "Distinct sessions"],
    )
    return "\n\n".join(
        [
            "Non-null event-parameter coverage:",
            "",
            coverage,
            "",
            "### Event names carrying ep_source",
            "",
            carriers,
            "",
            "### Top 15 ep_source / ep_medium pairs by sessions",
            "",
            top_pairs,
        ]
    )


def _redaction(con: duckdb.DuckDBPyConnection) -> str:
    rows = []
    for field in ("country", "region", "city", "device_category", "browser", "os"):
        expressions = _null_share_expressions(field)
        row = con.execute(
            f"""
            SELECT
                '{field}' AS field,
                {expressions}
            FROM ev
            """
        ).fetchone()
        rows.append(row)
    item_fields = (
        ("item_name", "item.item_name"),
        ("item_category", "item.item_category"),
    )
    for label, expr_field in item_fields:
        expressions = _null_share_expressions(expr_field)
        row = con.execute(
            f"""
            SELECT
                '{label}' AS field,
                {expressions}
            FROM (SELECT unnest(items) AS item FROM events)
            """
        ).fetchone()
        rows.append(row)
    return "\n\n".join(
        [
            "Shares are over events, except item fields which are over unnested item rows.",
            "",
            markdown_table(("Field", *REDACTION_HEADERS), rows),
        ]
    )


def _funnel(con: duckdb.DuckDBPyConnection) -> str:
    return table(
        con,
        f"""
        SELECT
            event_name,
            count(*) AS events,
            count(DISTINCT CASE WHEN ga_session_id IS NOT NULL
                THEN {SESSION_KEY} END) AS sessions,
            count(DISTINCT user_pseudo_id) AS users
        FROM ev
        WHERE event_name IN (
            'view_item',
            'add_to_cart',
            'begin_checkout',
            'add_shipping_info',
            'add_payment_info',
            'purchase'
        )
        GROUP BY event_name
        ORDER BY CASE event_name
            WHEN 'view_item' THEN 1
            WHEN 'add_to_cart' THEN 2
            WHEN 'begin_checkout' THEN 3
            WHEN 'add_shipping_info' THEN 4
            WHEN 'add_payment_info' THEN 5
            WHEN 'purchase' THEN 6
            ELSE 7
        END
        """,
        ["Event name", "Events", "Distinct sessions", "Distinct users"],
    )


def _purchases(con: duckdb.DuckDBPyConnection) -> str:
    row = con.execute(
        """
        SELECT
            count(*) AS purchase_events,
            count(DISTINCT transaction_id) AS distinct_transaction_ids,
            count(*) FILTER (
                WHERE transaction_id IS NULL OR transaction_id = '(not set)'
            ) AS missing_transaction_ids,
            count(DISTINCT user_pseudo_id) AS purchasing_users,
            sum(purchase_revenue_in_usd) AS purchase_revenue_sum,
            sum(items_revenue_usd) AS items_revenue_sum,
            count(*) FILTER (WHERE purchase_revenue_in_usd IS NULL) AS null_revenue,
            count(*) FILTER (WHERE purchase_revenue_in_usd = 0) AS zero_revenue,
            count(*) FILTER (WHERE purchase_revenue_in_usd > 0) AS positive_revenue
        FROM ev
        WHERE event_name = 'purchase'
        """
    ).fetchone()
    duplicate_transactions = con.execute(
        """
        SELECT count(*)
        FROM (
            SELECT transaction_id
            FROM ev
            WHERE event_name = 'purchase'
                AND transaction_id IS NOT NULL
                AND transaction_id <> '(not set)'
            GROUP BY transaction_id
            HAVING count(*) > 1
        ) AS duplicates
        """
    ).fetchone()[0]
    multi_tx = con.execute(
        """
        WITH per_user AS (
            SELECT
                user_pseudo_id,
                count(DISTINCT transaction_id) FILTER (
                    WHERE transaction_id IS NOT NULL
                        AND transaction_id <> '(not set)'
                ) AS transactions
            FROM ev
            WHERE event_name = 'purchase'
            GROUP BY user_pseudo_id
        )
        SELECT
            count(*) AS users,
            count(*) FILTER (WHERE transactions >= 2) AS multi_tx_users,
            printf(
                '%.2f%%',
                100.0 * count(*) FILTER (WHERE transactions >= 2)
                    / nullif(count(*), 0)
            ) AS share
        FROM per_user
        """
    ).fetchone()
    revenue_row = con.execute(
        """
        SELECT
            min(purchase_revenue_in_usd),
            median(purchase_revenue_in_usd),
            avg(purchase_revenue_in_usd),
            quantile_cont(purchase_revenue_in_usd, 0.95),
            max(purchase_revenue_in_usd)
        FROM ev
        WHERE event_name = 'purchase' AND purchase_revenue_in_usd > 0
        """
    ).fetchone()

    purchase_revenue_sum = row[4]
    items_revenue_sum = row[5]
    difference = None
    ratio = None
    if purchase_revenue_sum is not None and items_revenue_sum is not None:
        difference = purchase_revenue_sum - items_revenue_sum
    if purchase_revenue_sum:
        ratio = (items_revenue_sum or 0.0) / purchase_revenue_sum
    ratio_text = ""
    if ratio is not None:
        ratio_text = f"{ratio:.4f} ({ratio * 100:.2f}%)"

    metrics = [
        ("Purchase events", _fmt_int(row[0])),
        ("Distinct transaction_id", _fmt_int(row[1])),
        (
            "Purchase events with NULL or '(not set)' transaction_id",
            _fmt_int(row[2]),
        ),
        (
            "transaction_id values on more than one purchase event",
            _fmt_int(duplicate_transactions),
        ),
        ("Purchase events with purchase_revenue_in_usd NULL", _fmt_int(row[6])),
        ("Purchase events with purchase_revenue_in_usd = 0", _fmt_int(row[7])),
        ("Purchase events with purchase_revenue_in_usd > 0", _fmt_int(row[8])),
        ("Sum of purchase_revenue_in_usd", _fmt_money(purchase_revenue_sum)),
        ("Sum of items_revenue_usd", _fmt_money(items_revenue_sum)),
        ("Difference (purchase revenue - items revenue)", _fmt_money(difference)),
        ("Ratio (items revenue / purchase revenue)", ratio_text),
        ("Distinct purchasing users", _fmt_int(row[3])),
        (
            "Purchasing users with 2+ distinct transaction_ids",
            _fmt_int(multi_tx[1]),
        ),
        (
            "Share of purchasing users with 2+ distinct transaction_ids",
            multi_tx[2] or "",
        ),
    ]
    revenue_metrics = [
        ("Min purchase_revenue_in_usd (> 0)", _fmt_money(revenue_row[0])),
        ("Median purchase_revenue_in_usd (> 0)", _fmt_money(revenue_row[1])),
        ("Mean purchase_revenue_in_usd (> 0)", _fmt_money(revenue_row[2])),
        ("p95 purchase_revenue_in_usd (> 0)", _fmt_money(revenue_row[3])),
        ("Max purchase_revenue_in_usd (> 0)", _fmt_money(revenue_row[4])),
    ]
    return "\n\n".join(
        [
            markdown_table(("Metric", "Value"), metrics),
            "### Revenue distribution (purchase_revenue_in_usd > 0)",
            "",
            markdown_table(("Statistic", "Value"), revenue_metrics),
        ]
    )


def _device_geography(con: duckdb.DuckDBPyConnection) -> str:
    devices = table(
        con,
        f"""
        WITH totals AS (
            SELECT
                count(DISTINCT user_pseudo_id) AS total_users,
                count(DISTINCT CASE WHEN ga_session_id IS NOT NULL
                    THEN {SESSION_KEY} END) AS total_sessions
            FROM ev
        )
        SELECT
            coalesce(device_category, '(NULL)') AS device_category,
            count(DISTINCT user_pseudo_id) AS users,
            printf(
                '%.2f%%',
                100.0 * count(DISTINCT user_pseudo_id)
                    / nullif(max(total_users), 0)
            ) AS user_share,
            count(DISTINCT CASE WHEN ga_session_id IS NOT NULL
                THEN {SESSION_KEY} END) AS sessions,
            printf(
                '%.2f%%',
                100.0 * count(DISTINCT CASE WHEN ga_session_id IS NOT NULL
                    THEN {SESSION_KEY} END)
                    / nullif(max(total_sessions), 0)
            ) AS session_share
        FROM ev, totals
        GROUP BY device_category
        ORDER BY users DESC
        """,
        ["Device category", "Users", "Share of users", "Sessions", "Share of sessions"],
    )
    countries = table(
        con,
        """
        WITH totals AS (
            SELECT count(DISTINCT user_pseudo_id) AS total_users
            FROM ev
        )
        SELECT
            country,
            count(DISTINCT user_pseudo_id) AS users,
            printf(
                '%.2f%%',
                100.0 * count(DISTINCT user_pseudo_id)
                    / nullif(max(total_users), 0)
            ) AS share
        FROM ev, totals
        WHERE country IS NOT NULL AND country <> ''
        GROUP BY country
        ORDER BY users DESC
        LIMIT 15
        """,
        ["Country", "Distinct users", "Share of users"],
    )
    return "\n\n".join(
        [
            "### Device category",
            "",
            devices,
            "",
            "### Top 15 countries by users",
            "",
            countries,
        ]
    )


def build_report(con: duckdb.DuckDBPyConnection) -> str:
    """Build the full Markdown report."""
    parts = [
        "# Data profile",
        "",
        (
            "Generated by `scripts/profile_data.py` from the raw Parquet files "
            f"on {date.today().isoformat()}."
        ),
        "",
        f"Raw files: `{RAW_DIR / 'events_*.parquet'}`",
        "",
        "## 1. Overview",
        "",
        _overview(con),
        "",
        "## 2. Daily volume",
        "",
        "### Events per day",
        "",
        _daily_summary(con),
        "",
        "### Five busiest days",
        "",
        _busiest_days(con),
        "",
        "## 3. Event names",
        "",
        _event_names(con),
        "",
        "## 4. Session id coverage",
        "",
        _session_coverage(con),
        "",
        "## 5. Sessions per user",
        "",
        _sessions_per_user(con),
        "",
        "## 6. Traffic source, user-level",
        "",
        _traffic_user_level(con),
        "",
        "## 7. Traffic source, event-level params",
        "",
        _traffic_event_level(con),
        "",
        "## 8. Redaction and nulls",
        "",
        _redaction(con),
        "",
        "## 9. Funnel events",
        "",
        _funnel(con),
        "",
        "## 10. Purchases",
        "",
        _purchases(con),
        "",
        "## 11. Device and geography",
        "",
        _device_geography(con),
        "",
    ]
    return "\n".join(parts)


def main() -> None:
    """Profile the raw event export and write the Markdown report."""
    con = duckdb.connect()
    try:
        con.execute("SET memory_limit='4GB'")
        glob_path = str(RAW_DIR / "events_*.parquet").replace("'", "''")
        con.execute(
            "CREATE OR REPLACE VIEW events AS "
            f"SELECT * FROM read_parquet('{glob_path}')"
        )
        _create_ev(con)
        report = build_report(con)
    finally:
        con.close()

    output_path = REPO_ROOT / "docs" / "DATA_PROFILE.md"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report, encoding="utf-8")
    print(output_path)


if __name__ == "__main__":
    main()
