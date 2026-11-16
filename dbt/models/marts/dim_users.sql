{{ config(
    materialized='table',
    post_hook="COPY (SELECT * FROM {{ this }}) TO '{{ env_var('BUYER_MARTS_DIR', '../marts_out') }}/dim_users.parquet' (FORMAT PARQUET)"
) }}

with users as (
    select * from {{ ref('int_user_first_touch') }}
),

session_rank as (
    select
        user_pseudo_id,
        session_key,
        session_start_ts,
        device_category,
        country,
        row_number() over (
            partition by user_pseudo_id
            order by session_start_ts, session_key
        ) as row_num
    from {{ ref('int_sessions') }}
),

first_session as (
    select
        user_pseudo_id,
        device_category,
        country
    from session_rank
    where row_num = 1
),

session_counts as (
    select
        user_pseudo_id,
        count(*)::bigint as sessions
    from {{ ref('int_sessions') }}
    group by user_pseudo_id
),

order_counts as (
    select
        user_pseudo_id,
        count(*)::bigint as orders,
        sum(revenue_usd)::double as revenue_usd,
        min(order_ts) as first_order_ts,
        max(case when order_seq = 2 then order_ts end) as second_order_ts
    from {{ ref('int_orders') }}
    group by user_pseudo_id
)

select
    u.user_pseudo_id,
    u.first_seen_ts,
    cast(u.first_seen_ts as date) as first_seen_date,
    date_trunc('week', cast(u.first_seen_ts as date))::date as cohort_week,
    u.first_source,
    u.first_medium,
    u.channel,
    fs.device_category,
    fs.country,
    coalesce(sc.sessions, 0)::bigint as sessions,
    coalesce(oc.orders, 0)::bigint as orders,
    coalesce(oc.revenue_usd, 0)::double as revenue_usd,
    oc.first_order_ts,
    oc.second_order_ts
from users u
left join first_session fs on u.user_pseudo_id = fs.user_pseudo_id
left join session_counts sc on u.user_pseudo_id = sc.user_pseudo_id
left join order_counts oc on u.user_pseudo_id = oc.user_pseudo_id
