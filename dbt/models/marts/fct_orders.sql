{{ config(
    materialized='table',
    post_hook="COPY (SELECT * FROM {{ this }}) TO '{{ env_var('BUYER_MARTS_DIR', '../marts_out') }}/fct_orders.parquet' (FORMAT PARQUET)"
) }}

select
    order_key,
    user_pseudo_id,
    session_key,
    order_ts,
    order_date,
    transaction_id,
    purchase_events::bigint as purchase_events,
    revenue_usd::double as revenue_usd,
    items_quantity::bigint as items_quantity,
    is_zero_revenue,
    order_seq::bigint as order_seq
from {{ ref('int_orders') }}
