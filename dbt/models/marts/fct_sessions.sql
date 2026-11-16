{{ config(
    materialized='table',
    post_hook="COPY (SELECT * FROM {{ this }}) TO '{{ env_var('BUYER_MARTS_DIR', '../marts_out') }}/fct_sessions.parquet' (FORMAT PARQUET)"
) }}

with session_base as (
    select * from {{ ref('int_sessions') }}
),

country_totals as (
    select
        country,
        count(*)::bigint as sessions
    from session_base
    group by country
),

top_countries as (
    select country
    from country_totals
    order by sessions desc, country
    limit 5
),

orders as (
    select
        session_key,
        count(*)::bigint as orders,
        sum(revenue_usd)::double as revenue_usd
    from {{ ref('int_orders') }}
    group by session_key
),

funnel as (
    select
        *,
        case
            when has_purchase
                and has_add_payment_info
                and has_add_shipping_info
                and has_begin_checkout
                and has_add_to_cart
                and has_view_item then 6
            when has_add_payment_info
                and has_add_shipping_info
                and has_begin_checkout
                and has_add_to_cart
                and has_view_item then 5
            when has_add_shipping_info
                and has_begin_checkout
                and has_add_to_cart
                and has_view_item then 4
            when has_begin_checkout
                and has_add_to_cart
                and has_view_item then 3
            when has_add_to_cart
                and has_view_item then 2
            when has_view_item then 1
            else 0
        end::integer as funnel_step
    from session_base
)

select
    f.session_key,
    f.user_pseudo_id,
    f.ga_session_id::bigint as ga_session_id,
    f.session_number::bigint as session_number,
    f.session_start_ts,
    f.session_end_ts,
    f.session_date,
    f.events,
    f.page_views,
    f.device_category,
    f.country,
    case
        when t.country is not null then f.country
        else 'Other'
    end as country_group,
    f.channel,
    f.has_view_item,
    f.has_add_to_cart,
    f.has_begin_checkout,
    f.has_add_shipping_info,
    f.has_add_payment_info,
    f.has_purchase,
    f.funnel_step,
    coalesce(o.orders, 0)::bigint as orders,
    coalesce(o.revenue_usd, 0)::double as revenue_usd
from funnel f
left join top_countries t on f.country = t.country
left join orders o on f.session_key = o.session_key
