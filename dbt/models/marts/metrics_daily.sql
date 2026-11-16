{{ config(
    materialized='table',
    post_hook="COPY (SELECT * FROM {{ this }}) TO '{{ env_var('BUYER_MARTS_DIR', '../marts_out') }}/metrics_daily.parquet' (FORMAT PARQUET)"
) }}

with date_spine as (
    select date_day from {{ ref('dim_date') }}
),

sessions as (
    select
        session_date as date_day,
        count(*)::bigint as sessions,
        count(distinct user_pseudo_id)::bigint as active_users,
        count(*) filter (where orders > 0)::bigint as purchasing_sessions
    from {{ ref('fct_sessions') }}
    group by session_date
),

new_users as (
    select
        first_seen_date as date_day,
        count(*)::bigint as new_users
    from {{ ref('dim_users') }}
    group by first_seen_date
),

orders as (
    select
        order_date as date_day,
        count(*)::bigint as orders,
        sum(revenue_usd)::double as revenue_usd,
        sum(coalesce(items_quantity, 0))::bigint as items_quantity,
        count(*) filter (where revenue_usd = 0)::bigint as zero_revenue_orders
    from {{ ref('fct_orders') }}
    group by order_date
)

select
    d.date_day,
    coalesce(s.sessions, 0)::bigint as sessions,
    coalesce(s.active_users, 0)::bigint as active_users,
    coalesce(n.new_users, 0)::bigint as new_users,
    coalesce(o.orders, 0)::bigint as orders,
    coalesce(s.purchasing_sessions, 0)::bigint as purchasing_sessions,
    coalesce(o.revenue_usd, 0)::double as revenue_usd,
    coalesce(o.items_quantity, 0)::bigint as items_quantity,
    coalesce(o.zero_revenue_orders, 0)::bigint as zero_revenue_orders
from date_spine d
left join sessions s on d.date_day = s.date_day
left join new_users n on d.date_day = n.date_day
left join orders o on d.date_day = o.date_day
