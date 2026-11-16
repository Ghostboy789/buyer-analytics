{{ config(materialized='table') }}

with purchases as (
    select
        user_pseudo_id,
        session_key,
        event_ts,
        event_date,
        case
            when transaction_id is null or transaction_id = '(not set)' then null
            else transaction_id
        end as transaction_id,
        purchase_revenue_usd,
        total_item_quantity
    from {{ ref('stg_events') }}
    where event_name = 'purchase'
),

keyed as (
    select
        *,
        coalesce(transaction_id, 'ns:' || session_key) as order_group
    from purchases
),

collapsed as (
    select
        user_pseudo_id,
        order_group,
        transaction_id,
        min(event_ts) as order_ts,
        arg_min(session_key, event_ts) as session_key,
        max(coalesce(purchase_revenue_usd, 0))::double as revenue_usd,
        max(total_item_quantity)::bigint as items_quantity,
        count(*)::bigint as purchase_events
    from keyed
    group by user_pseudo_id, order_group, transaction_id
)

select
    md5(user_pseudo_id || '|' || order_group) as order_key,
    user_pseudo_id,
    session_key,
    order_ts,
    cast(order_ts as date) as order_date,
    transaction_id,
    purchase_events,
    revenue_usd,
    items_quantity,
    revenue_usd = 0 as is_zero_revenue,
    row_number() over (
        partition by user_pseudo_id
        order by order_ts, md5(user_pseudo_id || '|' || order_group)
    )::bigint as order_seq
from collapsed
