{{ config(
    materialized='table',
    post_hook="COPY (SELECT * FROM {{ this }}) TO '{{ env_var('BUYER_MARTS_DIR', '../marts_out') }}/dim_channel.parquet' (FORMAT PARQUET)"
) }}

select
    cast(channel as varchar) as channel,
    cast(label as varchar) as label,
    cast(sort_order as integer) as sort_order
from (
    values
        ('direct', 'Direct', 1),
        ('organic_search', 'Organic search', 2),
        ('paid_search', 'Paid search', 3),
        ('referral', 'Referral', 4),
        ('undisclosed', 'Undisclosed', 5),
        ('other', 'Other', 6)
) as channels(channel, label, sort_order)
