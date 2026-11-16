{{ config(materialized='table') }}

with first_events as (
    select
        user_pseudo_id,
        event_ts,
        event_date,
        ts_source,
        ts_medium,
        row_number() over (
            partition by user_pseudo_id
            order by event_ts, event_date
        ) as row_num
    from {{ ref('stg_events') }}
),

first_touch as (
    select
        user_pseudo_id,
        event_ts as first_seen_ts,
        ts_source as first_source,
        ts_medium as first_medium
    from first_events
    where row_num = 1
)

select
    user_pseudo_id,
    first_seen_ts,
    first_source,
    first_medium,
    case
        when first_source = '(direct)' and first_medium = '(none)' then 'direct'
        when first_medium = 'organic' then 'organic_search'
        when first_medium = 'cpc' then 'paid_search'
        when first_medium = 'referral' then 'referral'
        when first_source in ('<Other>', '(data deleted)')
            or first_medium in ('<Other>', '(data deleted)') then 'undisclosed'
        else 'other'
    end as channel
from first_touch
