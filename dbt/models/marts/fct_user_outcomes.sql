{{ config(
    materialized='table',
    post_hook="COPY (SELECT * FROM {{ this }}) TO '{{ env_var('BUYER_MARTS_DIR', '../marts_out') }}/fct_user_outcomes.parquet' (FORMAT PARQUET)"
) }}

with p3_sessions as (
    select *
    from {{ ref('fct_sessions') }}
    where session_date between date '2021-01-04' and date '2021-01-31'
),

entry as (
    select
        user_pseudo_id,
        min(session_date) as entry_date,
        arg_min(device_category, session_start_ts) as device_category
    from p3_sessions
    group by user_pseudo_id
),

p3_activity as (
    select
        user_pseudo_id,
        sum(orders)::bigint as orders,
        sum(revenue_usd)::double as revenue_usd,
        min(case when orders > 0 then session_date end) as first_purchase_date
    from p3_sessions
    group by user_pseudo_id
),

pre_activity as (
    select
        user_pseudo_id,
        count(*)::bigint as pre_sessions,
        sum(orders)::bigint as pre_orders,
        sum(revenue_usd)::double as pre_revenue_usd
    from {{ ref('fct_sessions') }}
    where session_date < date '2021-01-04'
    group by user_pseudo_id
)

select
    e.user_pseudo_id,
    date_diff('day', date '2021-01-04', e.entry_date)::integer as entry_day_index,
    coalesce(p.orders, 0) > 0 as converted,
    case
        when p.first_purchase_date is not null then
            date_diff('day', date '2021-01-04', p.first_purchase_date)::integer
        else null
    end as first_purchase_day_index,
    coalesce(p.orders, 0)::bigint as orders,
    coalesce(p.revenue_usd, 0)::double as revenue_usd,
    pre.user_pseudo_id is not null as has_pre_period,
    coalesce(pre.pre_sessions, 0)::bigint as pre_sessions,
    coalesce(pre.pre_orders, 0)::bigint as pre_orders,
    coalesce(pre.pre_revenue_usd, 0)::double as pre_revenue_usd,
    e.device_category,
    u.channel
from entry e
left join p3_activity p on e.user_pseudo_id = p.user_pseudo_id
left join pre_activity pre on e.user_pseudo_id = pre.user_pseudo_id
join {{ ref('dim_users') }} u on e.user_pseudo_id = u.user_pseudo_id
