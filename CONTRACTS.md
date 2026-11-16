# Contracts

The exact shape of every table the dbt project writes and every JSON file the analysis writes.
Definitions are in `ANALYSIS_PLAN.md`; this file fixes names and types.
`tests/contracts.py` reads the tables below, so this file is the single source of truth.

## Marts

Written to `marts_out/<name>.parquet`. Types are DuckDB types. No column is null unless marked
`nullable`.

### `fct_sessions`
Grain: one row per session. Key: `session_key`.

| column | type | notes |
|---|---|---|
| session_key | VARCHAR | `user_pseudo_id || '-' || ga_session_id` |
| user_pseudo_id | VARCHAR | |
| ga_session_id | BIGINT | |
| session_number | BIGINT | nullable; `ga_session_number` |
| session_start_ts | TIMESTAMP | UTC |
| session_end_ts | TIMESTAMP | UTC |
| session_date | DATE | UTC date of the first event |
| events | BIGINT | |
| page_views | BIGINT | |
| device_category | VARCHAR | from the first event |
| country | VARCHAR | from the first event |
| country_group | VARCHAR | top five countries by sessions, else `Other` |
| channel | VARCHAR | the user's first-touch channel group |
| has_view_item | BOOLEAN | |
| has_add_to_cart | BOOLEAN | |
| has_begin_checkout | BOOLEAN | |
| has_add_shipping_info | BOOLEAN | |
| has_add_payment_info | BOOLEAN | |
| has_purchase | BOOLEAN | a purchase event exists in the session |
| funnel_step | INTEGER | 0 to 6, deepest closed-funnel step reached |
| orders | BIGINT | orders attributed to this session |
| revenue_usd | DOUBLE | |

### `fct_orders`
Grain: one row per order after collapsing purchase events. Key: `order_key`.

| column | type | notes |
|---|---|---|
| order_key | VARCHAR | |
| user_pseudo_id | VARCHAR | |
| session_key | VARCHAR | session of the earliest collapsed event |
| order_ts | TIMESTAMP | UTC |
| order_date | DATE | |
| transaction_id | VARCHAR | nullable; null when the raw id is `(not set)` |
| purchase_events | BIGINT | raw purchase events collapsed into this order |
| revenue_usd | DOUBLE | largest revenue among the collapsed events |
| items_quantity | BIGINT | nullable |
| is_zero_revenue | BOOLEAN | |
| order_seq | BIGINT | 1 for the user's first order |

### `fct_funnel_daily`
Grain: `session_date` × `device_category` × `channel` × `country_group`. Closed-funnel counts.

| column | type | notes |
|---|---|---|
| session_date | DATE | |
| device_category | VARCHAR | |
| channel | VARCHAR | |
| country_group | VARCHAR | |
| sessions | BIGINT | |
| s_view_item | BIGINT | |
| s_add_to_cart | BIGINT | |
| s_begin_checkout | BIGINT | |
| s_add_shipping_info | BIGINT | |
| s_add_payment_info | BIGINT | |
| s_purchase | BIGINT | |
| purchase_sessions_open | BIGINT | sessions with a purchase event, earlier steps ignored |

### `fct_cohort_retention`
Grain: `cohort_week` × `week_offset`. Only cohorts whose first week is fully inside the data.

| column | type | notes |
|---|---|---|
| cohort_week | DATE | Monday |
| week_offset | INTEGER | 0 is the cohort week |
| cohort_users | BIGINT | |
| active_users | BIGINT | users with a session in that week |
| buyers | BIGINT | users with an order in that week |
| is_complete | BOOLEAN | the offset week ends on or before the last date in the data |

### `fct_user_outcomes`
Grain: one row per user with a session in P3 (2021-01-04 to 2021-01-31). Key: `user_pseudo_id`.

| column | type | notes |
|---|---|---|
| user_pseudo_id | VARCHAR | |
| entry_day_index | INTEGER | 0 to 27, day of the first P3 session |
| converted | BOOLEAN | at least one order in P3 |
| first_purchase_day_index | INTEGER | nullable; 0 to 27 |
| orders | BIGINT | in P3 |
| revenue_usd | DOUBLE | in P3, 0 for non-buyers |
| has_pre_period | BOOLEAN | any session before 2021-01-04 |
| pre_sessions | BIGINT | |
| pre_orders | BIGINT | |
| pre_revenue_usd | DOUBLE | |
| device_category | VARCHAR | of the first P3 session |
| channel | VARCHAR | |

### `dim_users`
Grain: one row per user. Key: `user_pseudo_id`.

| column | type | notes |
|---|---|---|
| user_pseudo_id | VARCHAR | |
| first_seen_ts | TIMESTAMP | first event in the data |
| first_seen_date | DATE | |
| cohort_week | DATE | Monday of `first_seen_date` |
| first_source | VARCHAR | raw `traffic_source.source` |
| first_medium | VARCHAR | raw `traffic_source.medium` |
| channel | VARCHAR | |
| device_category | VARCHAR | of the first session |
| country | VARCHAR | of the first session |
| sessions | BIGINT | |
| orders | BIGINT | |
| revenue_usd | DOUBLE | |
| first_order_ts | TIMESTAMP | nullable |
| second_order_ts | TIMESTAMP | nullable |

### `dim_channel`
Grain: one row per channel group. Key: `channel`.

| column | type | notes |
|---|---|---|
| channel | VARCHAR | direct, organic_search, paid_search, referral, undisclosed, other |
| label | VARCHAR | display name |
| sort_order | INTEGER | |

### `dim_date`
Grain: one row per day from 2020-11-01 to 2021-01-31. Key: `date_day`.

| column | type | notes |
|---|---|---|
| date_day | DATE | |
| week_start | DATE | Monday |
| day_of_week | INTEGER | 1 Monday to 7 Sunday |
| period | VARCHAR | `P1`, `P2`, `P3` or `none` |

### `metrics_daily`
Grain: one row per day. Key: `date_day`. Additive counts only; ratios are computed from sums.

| column | type | notes |
|---|---|---|
| date_day | DATE | |
| sessions | BIGINT | by `session_date` |
| active_users | BIGINT | users with a session that day |
| new_users | BIGINT | users first seen that day |
| orders | BIGINT | by `order_date` |
| purchasing_sessions | BIGINT | sessions with at least one order, by `session_date` |
| revenue_usd | DOUBLE | by `order_date` |
| items_quantity | BIGINT | by `order_date` |
| zero_revenue_orders | BIGINT | by `order_date` |

## Artefacts

JSON in `artefacts/`. A published estimate is always a `NUM` object:
`{"value": number, "ci_low": number|null, "ci_high": number|null, "n": integer}`.
Exact counts of the whole dataset are plain integers; they are a full count, not an estimate.
Every file has `meta.synthetic` (false for anything published).

### `artefacts/descriptive.json`
```
{"meta": {"date_min": "2020-11-01", "date_max": "2021-01-31", "synthetic": false},
 "kpis": {"sessions": int, "users": int, "orders": int, "revenue_usd": number,
          "session_conversion": NUM, "user_conversion": NUM, "aov": NUM,
          "revenue_per_user": NUM, "items_per_order": NUM,
          "zero_revenue_order_share": NUM},
 "weekly": [{"week_start": "YYYY-MM-DD", "sessions": int, "users": int, "orders": int,
             "revenue_usd": number, "session_conversion": NUM, "aov": NUM}],
 "funnel": {"steps": ["view_item", "add_to_cart", "begin_checkout", "add_shipping_info",
                      "add_payment_info", "purchase"],
            "overall": {"sessions": int, "reached": [int x6],
                        "open_reached": [int x6],
                        "rate_from_sessions": [NUM x6], "rate_from_prev": [NUM x6]},
            "by_device": {"<device>": same shape as overall},
            "by_channel": {"<channel>": same shape},
            "by_country": {"<country_group>": same shape},
            "skipped_step_share": NUM},
 "cohorts": [{"cohort_week": "YYYY-MM-DD", "cohort_users": int,
              "retention": [{"week_offset": int, "rate": NUM}]}],
 "repeat": {"repeat_28d": NUM, "median_days_to_second": NUM},
 "channels": [{"channel": str, "users": int, "sessions": int, "orders": int,
               "revenue_usd": number, "user_conversion": NUM, "revenue_per_user": NUM}],
 "segment_tests": [{"page": str, "a": str, "b": str, "metric": str, "diff": number,
                    "p_raw": number, "p_holm": number}],
 "data_quality": {"raw_events": int, "mart_events": int, "raw_purchase_events": int,
                  "orders": int, "raw_purchase_revenue_usd": number, "order_revenue_usd": number,
                  "not_set_transaction_events": int, "session_source_param_coverage": number,
                  "zero_revenue_by_period": {"P1": {"orders": int, "zero_revenue_orders": int,
                                                    "share": NUM, "aov_paid_orders": number},
                                             "P2": same, "P3": same}}}
```
`open_reached` counts sessions whose step flag is set, earlier steps ignored. The zero-revenue
table assigns an order to a period by the `session_date` of its session; `aov_paid_orders` is
revenue over orders with revenue above zero.

Intervals: Wilson for rates; bootstrap over users (500 draws) for AOV, revenue per user, items
per order and the median.

### `artefacts/decomposition.json`
```
{"meta": {"synthetic": false, "n_boot": 500},
 "periods": {"P1": {"start": "2020-11-02", "end": "2020-11-29", "sessions": int, "orders": int,
                    "revenue_usd": number, "conversion": number, "aov": number}, "P2": ..., "P3": ...},
 "comparisons": [{"from": "P1", "to": "P2", "delta_revenue_usd": number,
                  "log_change": {"total": NUM, "sessions": NUM, "conversion": NUM, "aov": NUM},
                  "by_channel": [{"segment": str, "delta_revenue_usd": number,
                                  "sessions_effect": number, "conversion_effect": number,
                                  "aov_effect": number}],
                  "by_device": [same shape],
                  "sum_check_abs_error": number}]}
```
Here `conversion` is orders / sessions.

### `artefacts/experiments.json`
```
{"meta": {"n_users": int, "window_days": 28, "n_sims": int, "alpha": 0.05, "synthetic": false,
          "note": "No real experiment exists in this data. Every effect was planted."},
 "baseline": {"conversion_rate": NUM, "revenue_per_user": NUM},
 "power": [{"rel_lift": number, "n_per_arm_needed": int, "power_at_actual_n": number}],
 "mde_at_actual_n": number,
 "cross_checks": {"split_salt": str,
                  "conversion": {"z_test_p": number, "permutation_p": number, "n_perm": int},
                  "revenue": {"diff": number, "welch_ci": [number, number],
                              "bootstrap_ci": [number, number], "n_boot": int}},
 "aa": {"fpr_conversion": NUM, "fpr_revenue": NUM, "band_low": number, "band_high": number,
        "ks_p_conversion": number, "pass_conversion": bool, "pass_revenue": bool},
 "planted": [{"rel_lift": number, "true_diff": number, "bias": number, "power": NUM,
              "coverage": NUM, "pass": bool}],
 "cuped": {"share_with_pre_period": NUM,
           "conversion": {"variance_reduction": NUM, "theta": number},
           "revenue": {"variance_reduction": NUM, "theta": number}},
 "peeking": {"fpr_fixed_horizon": NUM, "fpr_naive_peeking": NUM, "fpr_sequential": NUM,
             "obf_constant": number, "n_looks": 28, "band_low": number, "band_high": number,
             "pass_sequential": bool}}
```
