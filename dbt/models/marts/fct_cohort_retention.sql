{{ config(
    materialized='table',
    post_hook="COPY (SELECT * FROM {{ this }}) TO '{{ env_var('BUYER_MARTS_DIR', '../marts_out') }}/fct_cohort_retention.parquet' (FORMAT PARQUET)"
) }}

with bounds as (
    select
        min(event_date) as first_date,
        max(event_date) as last_date
    from {{ ref('stg_events') }}
),

params as (
    select
        first_date,
        last_date,
        case
            when date_trunc('week', first_date)::date < first_date
                then (date_trunc('week', first_date) + interval 7 day)::date
            else date_trunc('week', first_date)::date
        end as first_monday,
        date_trunc('week', last_date - interval 6 day)::date as last_cohort_monday
    from bounds
),

cohorts as (
    select
        u.user_pseudo_id,
        u.cohort_week
    from {{ ref('dim_users') }} u
    cross join params p
    where u.cohort_week between p.first_monday and p.last_cohort_monday
),

cohort_sizes as (
    select
        cohort_week,
        count(*)::bigint as cohort_users
    from cohorts
    group by cohort_week
),

offsets as (
    select
        c.cohort_week,
        unnest(
            range(
                0,
                (date_diff('day', c.cohort_week, p.last_date) // 7) + 1
            )
        ) as week_offset
    from cohort_sizes c
    cross join params p
),

user_week_activity as (
    select
        s.user_pseudo_id,
        date_trunc('week', s.session_date)::date as activity_week,
        sum(s.orders) > 0 as has_order
    from {{ ref('fct_sessions') }} s
    group by 1, 2
),

cohort_activity as (
    select
        c.cohort_week,
        a.user_pseudo_id,
        a.activity_week,
        a.has_order
    from cohorts c
    join user_week_activity a
        on c.user_pseudo_id = a.user_pseudo_id
),

activity_by_cohort_week as (
    select
        cohort_week,
        activity_week,
        count(*)::bigint as active_users,
        count(*) filter (where has_order)::bigint as buyers
    from cohort_activity
    group by cohort_week, activity_week
)

select
    o.cohort_week,
    o.week_offset::integer as week_offset,
    c.cohort_users,
    coalesce(a.active_users, 0)::bigint as active_users,
    coalesce(a.buyers, 0)::bigint as buyers,
    (
        o.cohort_week
        + cast(o.week_offset as integer) * interval 7 day
        + interval 6 day
    )::date <= p.last_date as is_complete
from offsets o
join cohort_sizes c on o.cohort_week = c.cohort_week
cross join params p
left join activity_by_cohort_week a
    on a.cohort_week = o.cohort_week
    and a.activity_week = (
        o.cohort_week + cast(o.week_offset as integer) * interval 7 day
    )::date
order by o.cohort_week, o.week_offset
