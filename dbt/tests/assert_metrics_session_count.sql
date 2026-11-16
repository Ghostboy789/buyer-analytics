with daily as (
    select coalesce(sum(sessions), 0)::bigint as daily_sessions
    from {{ ref('metrics_daily') }}
),

sessions as (
    select count(*)::bigint as mart_sessions
    from {{ ref('fct_sessions') }}
)

select daily.daily_sessions, sessions.mart_sessions
from daily, sessions
where daily.daily_sessions <> sessions.mart_sessions
