select *
from (
    select
        cohort_week,
        week_offset,
        count(*) as row_count
    from {{ ref('fct_cohort_retention') }}
    group by cohort_week, week_offset
) grouped
where row_count > 1
