{{ config(
    materialized='table',
    post_hook="COPY (SELECT * FROM {{ this }}) TO '{{ env_var('BUYER_MARTS_DIR', '../marts_out') }}/fct_funnel_daily.parquet' (FORMAT PARQUET)"
) }}

select
    session_date,
    device_category,
    channel,
    country_group,
    count(*)::bigint as sessions,
    count(*) filter (where funnel_step >= 1)::bigint as s_view_item,
    count(*) filter (where funnel_step >= 2)::bigint as s_add_to_cart,
    count(*) filter (where funnel_step >= 3)::bigint as s_begin_checkout,
    count(*) filter (where funnel_step >= 4)::bigint as s_add_shipping_info,
    count(*) filter (where funnel_step >= 5)::bigint as s_add_payment_info,
    count(*) filter (where funnel_step >= 6)::bigint as s_purchase,
    count(*) filter (where has_purchase)::bigint as purchase_sessions_open
from {{ ref('fct_sessions') }}
group by session_date, device_category, channel, country_group
