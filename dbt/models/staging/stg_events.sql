{{ config(materialized='table') }}

with source as (
    select *
    from read_parquet(
        '{{ env_var("BUYER_RAW_GLOB", "../data/raw/events_*.parquet") }}',
        union_by_name = true
    )
),

flattened as (
    select
        make_timestamp(event_timestamp) as event_ts,
        strptime(event_date, '%Y%m%d')::date as event_date,
        event_name,
        user_pseudo_id,
        list_filter(event_params, lambda x: x.key = 'ga_session_id')[1]
            .value.int_value::bigint as ga_session_id,
        list_filter(event_params, lambda x: x.key = 'ga_session_number')[1]
            .value.int_value::bigint as session_number,
        user_pseudo_id || '-' || cast(
            list_filter(event_params, lambda x: x.key = 'ga_session_id')[1]
                .value.int_value as varchar
        ) as session_key,
        device.category as device_category,
        geo.country as country,
        traffic_source.source as ts_source,
        traffic_source.medium as ts_medium,
        ecommerce.transaction_id as transaction_id,
        ecommerce.purchase_revenue_in_usd as purchase_revenue_usd,
        ecommerce.total_item_quantity as total_item_quantity,
        list_filter(event_params, lambda x: x.key = 'source')[1]
            .value.string_value as ep_source
    from source
)

select * from flattened
