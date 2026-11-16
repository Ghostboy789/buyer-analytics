with raw as (
    select count(*)::bigint as raw_purchase_events
    from read_parquet(
        '{{ env_var("BUYER_RAW_GLOB", "../data/raw/events_*.parquet") }}',
        union_by_name = true
    )
    where event_name = 'purchase'
),

orders as (
    select coalesce(sum(purchase_events), 0)::bigint as mart_purchase_events
    from {{ ref('fct_orders') }}
)

select raw.raw_purchase_events, orders.mart_purchase_events
from raw, orders
where raw.raw_purchase_events <> orders.mart_purchase_events
