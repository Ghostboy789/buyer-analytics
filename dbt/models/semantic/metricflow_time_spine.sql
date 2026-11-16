{{ config(materialized='table') }}

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

select date_day
from days
