# ruff: noqa: E402
"""Reconcile the raw GA4 export with the dbt marts and write docs/RECONCILIATION.md."""

from __future__ import annotations

import sys
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import MARTS_DIR, RAW_DIR, REPO_ROOT

GA_SESSION_ID = (
    "list_filter(event_params, lambda x: x.key = 'ga_session_id')[1].value.int_value"
)


def _sql_string(value: str | Path) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _scalar(con: duckdb.DuckDBPyConnection, sql: str) -> object:
    return con.execute(sql).fetchone()[0]


def _fmt_int(value: object) -> str:
    if value is None:
        return ""
    return f"{int(value):,}"


def _fmt_money(value: object) -> str:
    if value is None:
        return ""
    return f"{float(value):,.2f}"


def _fmt_pct(value: object) -> str:
    if value is None:
        return ""
    return f"{float(value):+.4f}%"


def _fmt_signed_money(value: object) -> str:
    if value is None:
        return ""
    return f"{float(value):+,.2f}"


def _status(raw: object, mart: object) -> str:
    return "MATCH" if raw == mart else "MISMATCH"


def _row(
    metric: str,
    raw: object,
    mart: object,
    gap: object = None,
    gap_pct: object = None,
    status: str = "",
) -> tuple[str, str, str, str, str, str]:
    return (
        metric,
        _fmt_int(raw) if isinstance(raw, int) else str(raw),
        _fmt_int(mart) if isinstance(mart, int) else str(mart),
        "" if gap is None else _fmt_signed_money(gap),
        "" if gap_pct is None else _fmt_pct(gap_pct),
        status,
    )


def _markdown_table(rows: list[tuple[str, ...]], headers: tuple[str, ...]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(cell for cell in row) + " |")
    return "\n".join(lines)


def build_reconciliation(con: duckdb.DuckDBPyConnection) -> str:
    """Compute the reconciliation table and render the Markdown report."""
    raw_events = _scalar(con, "SELECT count(*) FROM raw")
    mart_events = _scalar(con, "SELECT coalesce(sum(events), 0) FROM fct_sessions")

    raw_users = _scalar(con, "SELECT count(DISTINCT user_pseudo_id) FROM raw")
    mart_users = _scalar(con, "SELECT count(*) FROM dim_users")

    raw_sessions = _scalar(
        con,
        f"""
        SELECT count(*)
        FROM (
            SELECT DISTINCT user_pseudo_id, {GA_SESSION_ID} AS ga_session_id
            FROM raw
            WHERE {GA_SESSION_ID} IS NOT NULL
        )
        """,
    )
    mart_sessions = _scalar(con, "SELECT count(*) FROM fct_sessions")

    raw_purchase_events = _scalar(
        con,
        "SELECT count(*) FROM raw WHERE event_name = 'purchase'",
    )
    mart_purchase_events = _scalar(
        con,
        "SELECT coalesce(sum(purchase_events), 0) FROM fct_orders",
    )

    match_days, total_days = con.execute(
        """
        WITH raw_daily AS (
            SELECT
                strptime(event_date, '%Y%m%d')::date AS date_day,
                count(*)::bigint AS purchase_events
            FROM raw
            WHERE event_name = 'purchase'
            GROUP BY 1
        ),
        mart_daily AS (
            SELECT
                order_date AS date_day,
                sum(purchase_events)::bigint AS purchase_events
            FROM fct_orders
            GROUP BY 1
        )
        SELECT
            count(*) FILTER (
                WHERE coalesce(r.purchase_events, 0) = coalesce(m.purchase_events, 0)
            )::bigint,
            count(*)::bigint
        FROM raw_daily r
        FULL OUTER JOIN mart_daily m ON r.date_day = m.date_day
        """
    ).fetchone()

    orders = _scalar(con, "SELECT count(*) FROM fct_orders")

    raw_purchase_revenue = _scalar(
        con,
        """
        SELECT coalesce(sum(ecommerce.purchase_revenue_in_usd), 0)
        FROM raw
        WHERE event_name = 'purchase'
        """,
    )
    order_revenue = _scalar(
        con,
        "SELECT coalesce(sum(revenue_usd), 0) FROM fct_orders",
    )
    item_revenue = _scalar(
        con,
        """
        SELECT coalesce(sum(item.item_revenue_in_usd), 0)
        FROM (
            SELECT unnest(items) AS item
            FROM raw
            WHERE event_name = 'purchase'
        )
        """,
    )

    order_gap = float(order_revenue) - float(raw_purchase_revenue)
    order_gap_pct = (
        None
        if not raw_purchase_revenue
        else 100.0 * order_gap / float(raw_purchase_revenue)
    )
    item_gap = float(item_revenue) - float(raw_purchase_revenue)
    item_gap_pct = (
        None
        if not raw_purchase_revenue
        else 100.0 * item_gap / float(raw_purchase_revenue)
    )

    rows = [
        (
            "Events",
            _fmt_int(raw_events),
            _fmt_int(mart_events),
            "",
            "",
            _status(raw_events, mart_events),
        ),
        (
            "Users",
            _fmt_int(raw_users),
            _fmt_int(mart_users),
            "",
            "",
            _status(raw_users, mart_users),
        ),
        (
            "Sessions",
            _fmt_int(raw_sessions),
            _fmt_int(mart_sessions),
            "",
            "",
            _status(raw_sessions, mart_sessions),
        ),
        (
            "Purchase events",
            _fmt_int(raw_purchase_events),
            _fmt_int(mart_purchase_events),
            "",
            "",
            _status(raw_purchase_events, mart_purchase_events),
        ),
        (
            "Purchase events per day (days matching)",
            f"{_fmt_int(match_days)} / {_fmt_int(total_days)} days",
            f"{_fmt_int(match_days)} / {_fmt_int(total_days)} days",
            "",
            "",
            _status(match_days, total_days),
        ),
        (
            "Orders after collapsing",
            f"{_fmt_int(raw_purchase_events)} purchase events",
            f"{_fmt_int(orders)} orders",
            _fmt_signed_money(int(orders) - int(raw_purchase_events)),
            "",
            "n/a",
        ),
        (
            "Purchase revenue vs order revenue",
            _fmt_money(raw_purchase_revenue),
            _fmt_money(order_revenue),
            _fmt_signed_money(order_gap),
            _fmt_pct(order_gap_pct),
            "n/a",
        ),
        (
            "Purchase revenue vs sum of item revenue",
            _fmt_money(raw_purchase_revenue),
            _fmt_money(item_revenue),
            _fmt_signed_money(item_gap),
            _fmt_pct(item_gap_pct),
            "n/a",
        ),
    ]

    table = _markdown_table(
        rows,
        (
            "Metric",
            "Raw",
            "Mart",
            "Gap (Mart - Raw)",
            "Gap %",
            "Status",
        ),
    )

    return "\n".join(
        [
            "# Reconciliation",
            "",
            (
                "Generated by `scripts/reconcile.py` from "
                f"`{RAW_DIR / 'events_*.parquet'}` and `{MARTS_DIR}`."
            ),
            "",
            (
                "Exact-match checks compare the raw files with the marts and are marked "
                "MATCH or MISMATCH. The collapsing and revenue rows report the gap as a "
                "number; they are not forced to match."
            ),
            "",
            table,
            "",
        ]
    )


def main() -> None:
    """Build the reconciliation report."""
    con = duckdb.connect()
    try:
        con.execute("SET memory_limit='4GB'")
        raw_glob = _sql_string(RAW_DIR / "events_*.parquet")
        con.execute(
            "CREATE OR REPLACE VIEW raw AS "
            f"SELECT * FROM read_parquet({raw_glob}, union_by_name = true)"
        )
        for name in ("fct_sessions", "fct_orders", "dim_users"):
            path = _sql_string(MARTS_DIR / f"{name}.parquet")
            con.execute(
                f"CREATE OR REPLACE VIEW {name} AS "
                f"SELECT * FROM read_parquet({path})"
            )
        report = build_reconciliation(con)
    finally:
        con.close()

    output_path = REPO_ROOT / "docs" / "RECONCILIATION.md"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report, encoding="utf-8")
    print(output_path)


if __name__ == "__main__":
    main()
