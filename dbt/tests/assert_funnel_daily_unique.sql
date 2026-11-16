select *
from (
    select
        session_date,
        device_category,
        channel,
        country_group,
        count(*) as row_count
    from {{ ref('fct_funnel_daily') }}
    group by session_date, device_category, channel, country_group
) grouped
where row_count > 1
