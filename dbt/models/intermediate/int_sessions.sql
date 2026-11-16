{{ config(materialized='table') }}

with events as (
    select * from {{ ref('stg_events') }}
),

session_first as (
    select
        session_key,
        user_pseudo_id,
        ga_session_id,
        session_number,
        event_ts,
        event_date,
        device_category,
        country,
        row_number() over (
            partition by session_key
            order by event_ts, event_date, event_name
        ) as row_num
    from events
),

session_attrs as (
    select
        session_key,
        user_pseudo_id,
        ga_session_id,
        session_number,
        event_ts as first_event_ts,
        event_date as first_event_date,
        device_category,
        country
    from session_first
    where row_num = 1
),

session_agg as (
    select
        session_key,
        min(event_ts) as session_start_ts,
        max(event_ts) as session_end_ts,
        count(*)::bigint as events,
        count(*) filter (where event_name = 'page_view')::bigint as page_views,
        bool_or(event_name = 'view_item') as has_view_item,
        bool_or(event_name = 'add_to_cart') as has_add_to_cart,
        bool_or(event_name = 'begin_checkout') as has_begin_checkout,
        bool_or(event_name = 'add_shipping_info') as has_add_shipping_info,
        bool_or(event_name = 'add_payment_info') as has_add_payment_info,
        bool_or(event_name = 'purchase') as has_purchase
    from events
    group by session_key
)

select
    a.session_key,
    a.user_pseudo_id,
    a.ga_session_id,
    a.session_number,
    s.session_start_ts,
    s.session_end_ts,
    a.first_event_date as session_date,
    s.events,
    s.page_views,
    a.device_category,
    a.country,
    u.channel,
    s.has_view_item,
    s.has_add_to_cart,
    s.has_begin_checkout,
    s.has_add_shipping_info,
    s.has_add_payment_info,
    s.has_purchase
from session_attrs a
join session_agg s on a.session_key = s.session_key
join {{ ref('int_user_first_touch') }} u on a.user_pseudo_id = u.user_pseudo_id
