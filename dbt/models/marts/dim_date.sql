{{ config(
    materialized='table',
    post_hook="COPY (SELECT * FROM {{ this }}) TO '{{ env_var('BUYER_MARTS_DIR', '../marts_out') }}/dim_date.parquet' (FORMAT PARQUET)"
) }}

with days as (
    select
        cast(
            unnest(
                range(
                    date '2020-11-01',
                    date '2021-02-01',
                    interval 1 day
                )
            ) as date
        ) as date_day
)

select
    date_day,
    date_trunc('week', date_day)::date as week_start,
    isodow(date_day)::integer as day_of_week,
    case
        when date_day between date '2020-11-02' and date '2020-11-29' then 'P1'
        when date_day between date '2020-11-30' and date '2020-12-27' then 'P2'
        when date_day between date '2021-01-04' and date '2021-01-31' then 'P3'
        else 'none'
    end as period
from days
